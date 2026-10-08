# kiss-translator 个人定制改造实施文档

> 本文档交给执行 AI 使用。包含全部所需的代码库调研结论、精确到行号的修改点、以及要写入的完整配置内容(术语表、prompt 文本)。按章节顺序执行即可,不需要再做代码库探索。

## 0. 任务概述

在 kiss-translator v2.1.0 的 fork 上实现两个定制功能:

- **功能 1(小改)**:站点规则增加 `aiPrompt` 字段,允许按站点覆盖 AI 翻译的 system prompt;并预置三套站点规则 + 术语表(编程/AI、政治金融、成人内容日英)。
- **功能 2(新模块)**:漫画图片翻译模式。识别网页中的漫画大图,发给视觉模型(默认阿里千问 Qwen-VL,OpenAI 兼容协议)获取气泡坐标与译文,在页面上用覆盖层渲染译文(支持竖排)。

**硬约束**:
- 不改破坏现有功能的逻辑;所有现有测试(`pnpm test`)必须保持通过。
- 项目使用 pnpm;构建 Chrome 扩展用 `pnpm build:chrome`,产物在 `build/chrome/`。
- 代码风格遵循项目现状(2 空格缩进、无分号争议——照抄周围代码即可);构建前 `pnpm format` 会跑 prettier。
- 工作分支:`personal-fork`(已创建),依赖已安装(node_modules 存在)。
- 行号基于当前工作区版本(v2.1.0),如有偏差以代码内容为准搜索定位。

## 1. 环境验证(先做)

```bash
cd /Users/serena/Developer/kiss-translator
git status                    # 应在 personal-fork 分支
pnpm test -- --watchAll=false # 记录基线:全部通过
pnpm build:chrome             # 确认能产出 build/chrome/
```

基线测试若有失败,先记录再动手,结束时对比不得新增失败。

## 2. 代码库地图(调研结论,可信)

| 关注点 | 位置 |
|---|---|
| 站点规则数据结构 | `src/config/rules.js:66` `DEFAULT_RULE`;全局兜底 `GLOBLA_RULE` :119 |
| 内置规则 | `src/config/rules.js:176` `RULES_MAP`(GitHub 示例 :213-217),`:221` 转 `BUILTIN_RULES` |
| 规则匹配合并 | `src/libs/rules.js` `mergeRules` :130、`matchRule` :295、`checkRules`(导入白名单) :305-449 |
| 网页翻译核心 | `src/libs/translator.js` `Translator` 类;`#translateFetch` :4248 |
| 翻译 API 调度 | `src/apis/index.js` `apiTranslate` :706 |
| 各引擎请求/响应构造 | `src/apis/trans.js`;`genOpenAI` :1142;`genReqFuncs` 注册表 :1648;`parseTransRes` :1948(OpenAI 系 case 组 :2012-2031);`parseDictRes` :2119(case 组 :2121-2136);模型列表解析 :2741 |
| 接口类型常量与默认配置 | `src/config/api.js`;类型常量 :51-84;`OPT_ALL_TRANS_TYPES` :87;能力分组 `API_SPE_TYPES` :134;`defaultApi` :1513-1562;`defaultApiOpts`(DeepSeek 示例 :1629);`DEFAULT_API_LIST` :1774 |
| 术语解析 | `src/libs/utils.js:523` `parseAITerms`(格式:换行或`;`分隔,`术语,译文`;**译文不能含英文逗号**;无译文=保留原文) |
| 覆盖层挂载 | `src/libs/shadowDomManager.js` `ShadowDomManager`(构造 `{id, className, reactComponent, props, rootElement}`;`show(props)`/`hide()`/`toggle(props)`/`destroy()`);最小示例 `src/libs/fabManager.js:9-29` |
| 跨域请求 | content script 直接 `import { fetchData } from "../libs/fetch"`,自动经 background `MSG_FETCH` 代理,无 CORS 限制 |
| 子模块注册 | `src/libs/translatorManager.js:255` `#createRuntimeModules`(顶层 frame 分支内 new 各 Manager) |
| content 启动 | `src/common.js:312-343`(`matchRule` → `new TranslatorManager(...)`) |
| 存储 | `src/config/storage.js` 键常量;`src/libs/storage.js` 的 `getObj/setObj/trySetObj`(:195/:155/:173) |
| 规则编辑 UI | `src/views/Options/Rules.js`;aiTerms 输入框 :799-810(照抄模板) |
| i18n | `src/config/i18n.js` 单一 `I18N` 对象,key → `{zh, en, zh_TW, ...}`,缺省回退英文/defaultText。**接口名不需要 i18n**(apiName 是数据字段) |
| 设置/规则迁移 | **新增字段零迁移**:读取时 `mergeSettingWithDefault` 自动补默认值;规则 `mergeRules`/`checkRules` 对缺失字段天然容错。只有改变既有字段语义才需 bump `CURRENT_SETTINGS_VERSION` |

## 3. 功能 1:站点级 `aiPrompt` 覆盖

### 3.1 修改点(共 4 处 + i18n)

1. **`src/config/rules.js`**
   - `DEFAULT_RULE`(:66)增加字段:`aiPrompt: "",`(建议放在 `aiTerms` 下一行)。
   - `GLOBLA_RULE`(:119)同步加 `aiPrompt: "",`。
2. **`src/libs/rules.js`**
   - `mergeRules`(:130)第 2 组数组(`"terms", "aiTerms", ...` 那个)中加 `"aiPrompt"`。
   - `checkRules`(:305):字段白名单,在 :331 附近的解构和 :373 附近的映射两处都加 `aiPrompt`,否则导入/同步规则时字段被丢弃。
3. **`src/views/Options/Rules.js`**:照抄 aiTerms 的 TextField(:799-810)新增:
   ```jsx
   <TextField
     size="small"
     label={i18n("ai_prompt")}
     helperText={i18n("ai_prompt_helper")}
     name="aiPrompt"
     value={aiPrompt}
     disabled={disabled}
     onChange={handleChange}
     multiline
     maxRows={10}
   />
   ```
   别忘了在 RuleFields 的 `formValues` 解构里加 `aiPrompt`。
4. **`src/config/i18n.js`**:`I18N` 加两个 key(至少 zh/en):
   - `ai_prompt`: zh `"AI 提示词覆盖"` / en `"AI Prompt Override"`
   - `ai_prompt_helper`: zh `"附加到该站点 AI 翻译的系统提示词末尾,留空则不附加"` / en `"Appended to the system prompt for AI translation on this site. Leave empty to disable."`
5. **生效链路(关键)**:`src/libs/translator.js` `#translateFetch`(:4248)。现有逻辑里 glossary 来自 `this.#glossary`(构造时 `parseAITerms(this.#rule.aiTerms)`)。aiPrompt 采用**追加式覆盖**(对批量/非批量 prompt 都安全,不用碰 slug 解析):在 `#translateFetch` 里,`resolveApiPromptSettings` 之后,若 `this.#rule.aiPrompt?.trim()`,则:

   注意 `systemPrompt`(非聚合)与 `batchPrompt`(聚合,`useBatchFetch` 时生效)是两个独立字段,必须分别追加:

   ```js
   if (this.#rule.aiPrompt?.trim()) {
     const extra = `\n\n${this.#rule.aiPrompt.trim()}`;
     if (apiSetting.systemPrompt?.trim()) apiSetting.systemPrompt += extra;
     if (apiSetting.batchPrompt?.trim()) apiSetting.batchPrompt += extra;
   }
   ```
   注意:`apiTranslate` 的缓存 key 含 prompt 签名(`src/apis/index.js:742` `getPromptCacheSig`),prompt 变化会自动失效旧缓存,无需额外处理。另外验证 `resolveApiPromptSettings` 返回的是新对象而非引用(它是 slug → 文本的解析,返回组装后的新对象);若发现是引用,先浅拷贝再改,避免污染全局 API 配置。

### 3.2 预置站点规则

向 `src/config/rules.js` 的 `RULES_MAP`(:176)追加三条内置规则。这些规则会通过既有的订阅规则机制生效(构建时 `src/rules.js` 序列化),且用户可在设置页查看/修改。**注意内置规则已有 GitHub 条目(:213),不要覆盖它,改成给它补充字段。**

- **GitHub(修改既有 :213 条目)**:在原 `{autoScan, selector, ignoreSelector}` 上追加:
  ```js
  aiTerms: [
    "LLM,大语言模型", "transformer,", "attention,注意力机制", "fine-tuning,微调",
    "inference,推理", "agent,智能体", "multi-agent,多智能体", "RAG,检索增强生成",
    "hallucination,幻觉", "embedding,嵌入", "prompt,提示词", "token,",
    "context window,上下文窗口", "quantization,量化", "distillation,蒸馏",
    "MoE,混合专家", "RLHF,", "benchmark,基准测试", "ablation,消融实验",
    "baseline,基线", "checkpoint,检查点", "weights,权重", "overfitting,过拟合",
    "reasoning,推理(思维链)", "chain-of-thought,思维链", "tool calling,工具调用",
    "repository,仓库", "pull request,", "merge,合并", "fork,", "commit,提交",
    "issue,", "workflow,", "action,", "release,发布",
  ].join("\n"),
  aiPrompt: "你正在翻译技术文档/代码托管平台内容。要求:代码、命令、API 名称、库名、框架名、文件名、参数名一律保留原文;术语遵循所附术语表;译文风格简洁专业,符合中文技术社区表达习惯。",
  ```
  (parseAITerms 里无译文的条目表示保留原文不译。)
- **政治金融新闻(新增条目)**,key 为 pattern:
  ```js
  "reuters.com,apnews.com,bloomberg.com,ft.com,economist.com,wsj.com,nytimes.com,cnbc.com,bbc.com,bbc.co.uk,theguardian.com,aljazeera.com,foreignaffairs.com,politico.com": {
    aiTerms: [
      "the Fed,美联储", "Federal Reserve,美联储", "rate hike,加息", "rate cut,降息",
      "quantitative easing,量化宽松", "tapering,缩减购债", "yield curve,收益率曲线",
      "inverted yield curve,收益率曲线倒挂", "sanctions,制裁", "tariff,关税",
      "trade deficit,贸易逆差", "soft landing,软着陆", "hard landing,硬着陆",
      "stagflation,滞胀", "CPI,消费者价格指数(CPI)", "nonfarm payrolls,非农就业数据",
      "hawkish,鹰派", "dovish,鸽派", "bipartisan,两党共同", "filibuster,阻挠议事",
      "midterms,中期选举", "swing state,摇摆州", "impeachment,弹劾",
      "oligarch,寡头", "junta,军政府", "annexation,吞并", "ceasefire,停火",
      "no-fly zone,禁飞区", "proxy war,代理人战争", "debt ceiling,债务上限",
      "credit default swap,信用违约互换", "short selling,卖空", "margin call,追加保证金",
    ].join("\n"),
    aiPrompt: "你正在翻译国际新闻与财经内容。要求:人名、机构名采用中文媒体通行译法(如 Trump→特朗普、NATO→北约);数字、百分比、货币金额保持精确;标题翻译保留新闻标题的简练风格;涉及政治立场的内容保持中立直译,不增删观点。",
  },
  ```
- **成人内容站点(新增条目)**:
  ```js
  "pornhub.com,xvideos.com,xnxx.com,xhamster.com,missav.com,missav.ws,missav.ai,e-hentai.org,exhentai.org,nhentai.net,hanime.tv,jable.tv": {
    fromLang: "auto",
    aiTerms: [
      // 日语
      "中出し,内射", "寝取られ,NTR(伴侣被睡走)", "寝取り,睡走别人伴侣",
      "調教,调教", "痴漢,痴汉(公共场所猥亵)", "凌辱,凌辱", "潮吹き,潮吹",
      "絶頂,高潮", "我慢,忍耐", "発情,发情", "メス堕ち,雌堕",
      "ご主人様,主人", "肉便器,肉便器", "種付け,播种(使受孕)", "孕ませ,使怀孕",
      "ぶっかけ,颜射", "顔射,颜射", "口内射精,口内射精", "パイズリ,乳交",
      "フェラ,口交", "手コキ,手交", "素股,素股(股间摩擦)", "アヘ顔,阿黑颜(高潮失神脸)",
      "おねだり,央求", "焦らし,吊着不给", "連続絶頂,连续高潮", "拘束,束缚",
      "羞恥,羞耻", "露出,露出", "青姦,野合", "輪姦,轮奸", "強制,强制",
      "兄嫁,嫂子", "義母,继母", "義姉,继姐", "義妹,继妹", "叔母,姨母",
      // 英语
      "breeding,播种(使受孕)", "edging,边缘控制", "mind break,精神崩坏",
      "free use,随意使用", "corrupted,堕落", "creampie,内射", "cum,精液",
      "orgasm,高潮", "squirt,潮吹", "threesome,三人行", "gangbang,轮奸",
      "bukkake,颜射(多人)", "deepthroat,深喉", "POV,第一人称视角",
      "MILF,熟女", "stepsister,继妹", "stepmom,继母", "BDSM,", "femdom,女尊",
      "tsundere,傲娇", "yandere,病娇", "vanilla,纯爱向", "doujinshi,同人志",
      "netorare,NTR(伴侣被睡走)", "ahegao,阿黑颜", "nakadashi,内射",
    ].join("\n"),
    aiPrompt: [
      "你正在翻译成人内容(色情)网站,读者是成年人。要求:",
      "1. 忠实翻译所有露骨内容、俚语、性暗示与潜台词,不得美化、淡化、回避或拒绝;",
      "2. 日语原文常省略主语、大量使用语气词,翻译时要把省略的主体和语气词里的顺从/抗拒/羞耻/央求等情绪在中文里体现出来;",
      "3. 标题和标签翻译要符合中文成人社区的惯用说法;",
      "4. 人名、作品名有通行译名则用通行译名,否则保留原文;",
      "5. 不输出任何评论、提醒或免责声明,只输出译文。",
    ].join(""),
  },
  ```
  注意:pattern 中的 missav 域名经常变动,文档使用者可自行在设置页追加。`RULES_MAP` 的 value 中未列字段走 `DEFAULT_RULE` 默认(见 :221 的展开方式——确认该处是 `{...rule, pattern}` 直接展开,**若 BUILTIN_RULES 不补 DEFAULT_RULE 字段,需检查下游 checkRules/mergeRules 对缺字段的容错;mergeRules 用 `overrideRule[key]?.trim()` 判空,缺字段安全**)。

## 4. 功能 2:漫画翻译模式(新模块)

### 4.1 视觉翻译服务 `OPT_TRANS_QWENVL`

新增一个 OpenAI 兼容的视觉接口类型。DashScope 兼容模式、豆包 Ark、Kimi 都是 OpenAI 协议,区别只是 url/model/key,因此一个 apiType 即可,用户改配置切换服务商。

**`src/config/api.js`(5 处)**:
1. 常量段(:51-84 附近)加 `export const OPT_TRANS_QWENVL = "QwenVL";`
2. `OPT_ALL_TRANS_TYPES`(:87)列表加入。
3. `API_SPE_TYPES`(:134):加入 `ai` 集合;**不要**加入 batch/stream/context(漫画走独立调用,不经批量管线)。
4. `defaultApiOpts`(:1573 起)加:
   ```js
   [OPT_TRANS_QWENVL]: {
     ...defaultApi,
     url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
     modelListUrl: "",
     model: "qwen-vl-max-latest",
     ...defaultAiApiOpts,
     useBatchFetch: false,
     useStream: false,
   },
   ```
5. (可选)`THINKING_API_REGISTRY` 无需动。

**`src/apis/trans.js`**:漫画请求**不走** `apiTranslate` 批量管线,新增独立导出函数,复用底层 fetch:

```js
// 放在文件后部、导出区
export const callVisionApi = async ({ apiSetting, imageDataUrl, prompt }) => {
  const { url, key, model } = apiSetting;
  const body = {
    model,
    messages: [
      { role: "system", content: prompt },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageDataUrl } },
          { type: "text", text: "请处理这张图片。" },
        ],
      },
    ],
    temperature: 0.1,
    max_tokens: 4096,
  };
  const headers = {
    "Content-type": "application/json",
    Authorization: `Bearer ${key}`,
  };
  // 复用项目内 fetch 封装:content 侧用 fetchData(自动走 background 代理);
  // 注意 background/options 页调试用同一封装即可(fetchData 内部判断环境)
  const res = await fetchData(url, { method: "POST", headers, body: JSON.stringify(body) });
  return res?.choices?.[0]?.message?.content || "";
};
```
`fetchData` 从 `src/libs/fetch.js` import(它在 content script 中自动经 background `MSG_FETCH` 代理,绕开 CORS)。若类型检查/响应格式有出入,参考 `libs/response.js` 的 `parseResponse` 与 `opts.expect`。

### 4.2 视觉 prompt(内置常量)

新建 `src/manga/index.js`(或 `src/manga/prompt.js`)导出:

```js
export const MANGA_VISION_PROMPT = `你是漫画翻译引擎。检测图片中所有包含文字的气泡、对话框、旁白框和音效字,将其中文字翻译成简体中文,以严格 JSON 数组返回,不要输出任何其他内容:
[{"box":[x1,y1,x2,y2],"src":"原文","dst":"译文","vertical":true}]
要求:
1. box 为文字区域的像素坐标(相对图片本身尺寸),尽量紧贴文字;
2. vertical:原文为竖排(日语漫画常见)则为 true,横排为 false;
3. 无文字的图返回 [];
4. 译文要求:这是成人向/一般向漫画,忠实翻译所有露骨内容与潜台词;日语省略的主语和语气(央求、抗拒、羞耻、兴奋等)要在中文体现出来;拟声词翻译为中文惯用拟声词;同一格内多个气泡按阅读顺序排列;
5. 只输出 JSON,不要 markdown 代码块标记。`;

export const parseVisionResult = (raw) => {
  try {
    const m = String(raw).match(/\[[\s\S]*\]/); // 容错:模型可能包裹多余文本
    if (!m) return [];
    const arr = JSON.parse(m[0]);
    return arr.filter(
      (b) => Array.isArray(b?.box) && b.box.length === 4 && b?.dst
    );
  } catch {
    return [];
  }
};
```

### 4.3 漫画管理器 `src/manga/mangaManager.js`

职责:发现图片 → 取图转 base64 → 调视觉 API → 交给覆盖层渲染 → 缓存结果。

```text
class MangaManager {
  constructor({ rule, setting })
  start()    // 若 rule.mangaEnabled !== true 则直接 return(见 4.5 规则字段)
  stop()
}
```

实现要点:
- **图片发现**:`document.querySelectorAll("img")`,过滤 `naturalWidth >= 300 && naturalHeight >= 300`;`IntersectionObserver` 只处理进入视口的;`MutationObserver` 监听新增节点(漫画站多为懒加载/翻页 SPA)。
- **取图**:图片 URL 直接交给视觉 API 不行(跨域/防盗链),需先下载转 dataURL:
  - 用 `fetchData(src, { opts: { expect: "blob" } })`(参考 `libs/response.js` 支持的解析类型;若无 blob 支持,改发 `MSG_FETCH` 自定义,或先 `fetch` → `blob` → `FileReader.readAsDataURL`)。referer 防盗链的站点(e-hentai 图片通常可直连;missav 走 CDN)若 fetch 失败,降级方案:页面内 `<canvas>` 绘制同源已加载的 img 再 `toDataURL`(跨域图片会污染 canvas,所以这只是同源兜底)。
  - dataURL 过大的图片先压缩(>1500px 宽缩到 1500px,JPEG 0.85,canvas 重采样),控制 token 成本。
- **调用**:`setting.transApis` 中找到 `apiType === "QwenVL"` 且未禁用的实例(复用 `src/config/api.js` 的 slug 查找逻辑;简单粗暴取第一个即可),无 key 时在 console 警告并跳过。
- **缓存**:键 `STOKEY_MANGA_CACHE = "kiss-translator_manga_cache"`(在 `src/config/storage.js` 加常量),结构 `{ [imgUrl]: { bubbles, updatedAt } }`,用 `libs/storage.js` 的 `getObj/setObj`;缓存条数上限 200,超出按 updatedAt 淘汰最旧。
- **状态开关**:`visible` 布尔;悬浮按钮(见 4.4)切换;切换时对已处理图片只显示/隐藏覆盖层,不重调 API。

### 4.4 覆盖层渲染 `src/manga/mangaOverlay.js` + `mangaOverlayView.jsx`

- 每张已处理图片一个覆盖容器:`img.parentElement` 上 `position: relative`(原样式若是 static 才改,记住原值以便 stop 时恢复),容器内放绝对定位 `div`(inset:0, pointer-events:none)。
- 简单可靠起见**不强制用 ShadowDomManager**(ShadowDomManager 的 `show()` 二次调用不重渲染 props 有坑,见源码 :43 REVIEW 注释);直接用原生 DOM 或 `ReactDOM.createRoot` 挂在上述容器内即可。若用 React,参照 `src/libs/shadowHost.js` 的隔离思路给容器加 `class="notranslate"`(防止被翻译器自己翻译)。
- 每个气泡渲染为:
  ```jsx
  <div style={{
    position: "absolute",
    left: `${(box[0] / naturalWidth) * 100}%`,
    top: `${(box[1] / naturalHeight) * 100}%`,
    width: `${((box[2] - box[0]) / naturalWidth) * 100}%`,
    minHeight: `${((box[3] - box[1]) / naturalHeight) * 100}%`,
    background: "rgba(255, 252, 240, 0.92)",
    color: "#111",
    borderRadius: "6px",
    padding: "2px 4px",
    fontSize: /* 按气泡高度估算,clamp(10px, h/6, 18px) */,
    lineHeight: 1.3,
    writingMode: vertical ? "vertical-rl" : "horizontal-tb",
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: 10,
  }}>{dst}</div>
  ```
  坐标按百分比定位,图片缩放时自然跟随;用 `ResizeObserver` 或 window resize 事件无需额外处理(百分比天然响应)。
- **悬浮开关按钮**:页面右下角固定按钮(`position:fixed; z-index:2147483647`),文字「漫」/「原」,点击调 `mangaManager.toggle()`。仅在 manga 规则命中的站点显示。
- 所有覆盖元素加 `class="notranslate"` 并在 manga 站点规则的 `ignoreSelector` 中兜底。

### 4.5 规则字段 `mangaEnabled`

- `DEFAULT_RULE` / `GLOBLA_RULE` 加 `mangaEnabled: false`;`mergeRules` 加进布尔/枚举处理(现有枚举组是字符串型,布尔字段参照 `splitLength` 数字组的写法单独处理,或统一用 `"true"/"false"` 字符串沿用枚举组——**推荐字符串型 `"false"` 默认**,与项目 autoScan 等字段风格一致);`checkRules` 白名单两处同步加。
- 漫画站点规则(`e-hentai.org,exhentai.org,nhentai.net,missav.com,...` 可在 3.2 成人规则上)加 `mangaEnabled: "true"`。
- `Rules.js` 表单加一个 Select(参照 autoScan 字段的既有 Select 实现)。
- `TranslatorManager.#createRuntimeModules` 的 `!this.#isIframe` 分支内:
  ```js
  this._mangaManager = new MangaManager({
    rule: this.#cloneConfig(this.#rule),
    setting: this.#cloneConfig(this.#setting),
  });
  ```
  并在 `TranslatorManager` 的销毁/stop 路径同步调用(参照 `_inputTranslator` 的生命周期处理)。

### 4.6 其余收尾

- `src/config/i18n.js`:加 `manga_enabled`(zh "漫画翻译" / en "Manga translation")等 UI 文案。
- 油猴版(低优先):`config-overrides.js:120-168` banner 的 `@connect` 加 `dashscope.aliyuncs.com`(以及豆包/月之暗面域名,如配置需要)。浏览器扩展版不需要(manifest host_permissions 已是 `<all_urls>`)。
- `common.js:270-279` 有跳过 image/* 页面的逻辑,漫画功能作用于 HTML 页面内的 `<img>`,不受影响,不用改。

## 5. 验证清单

1. `pnpm test -- --watchAll=false`:与基线对比无新增失败。
2. `pnpm build:chrome` 成功;`chrome://extensions` 开发者模式加载 `build/chrome/`。
3. 设置页:规则编辑表单能看到并保存「AI 提示词覆盖」「漫画翻译」字段;接口列表出现 QwenVL,可填 key/url/model。
4. 功能点实测(需用户自行打开,执行 AI 准备好测试步骤说明即可):
   - GitHub 仓库 README:双语翻译,术语表生效(如 agent→智能体、transformer 保留);
   - reuters.com 文章:财经术语符合术语表;
   - 任一成人站点:成人术语与语气翻译生效;
   - e-hentai 或 nhentai 阅读页:右下角出现「漫」按钮,点击后漫画气泡被中文覆盖,竖排正确,翻页后新图自动处理,再点切回原图。
5. 单测:为 `parseAITerms` 的新增用例不需要(未改动);为 `parseVisionResult` 和 `mergeRules` 的 aiPrompt/mangaEnabled 合并各补一个简单单测(项目 jest 有先例,参考 `src/libs/*.test.js`)。

## 6. 执行顺序建议

1. 环境验证(§1)→ 2. 功能 1 全部(§3)→ build + 手测网页翻译 → 3. 功能 2 全部(§4)→ build + 手测漫画 → 4. 收尾(§5 单测、README 顶部注明 fork 改动点)。
2. 每个阶段独立 commit(commit message 用英文,参照 `git log` 现有风格)。

## 7. 常见坑 checklist

- [ ] `checkRules` 白名单漏加新字段 → 规则导入/同步后字段丢失(§3.1-2、§4.5)。
- [ ] `apiSetting` 是共享引用时直接改 systemPrompt 会污染全局配置 → 先浅拷贝(§3.1-5)。
- [ ] parseAITerms 译文含英文逗号会被截断 → 术语表译文一律用中文标点(§2)。
- [ ] 覆盖层被翻译器当成页面文本二次翻译 → 所有注入元素加 `class="notranslate"`(§4.4)。
- [ ] 漫画图片懒加载(滚动才出现)→ 必须 IntersectionObserver + MutationObserver(§4.3)。
- [ ] 视觉模型输出带 ```json 围栏或多余文字 → 用 §4.2 的正则提取容错。
- [ ] 大图不压缩直接发 → token 爆炸且可能超模型输入限制(§4.3 压缩)。
- [ ] `ShadowDomManager.show()` 二次调用不更新 props → 覆盖层不用它,用原生 DOM/独立 root(§4.4)。
