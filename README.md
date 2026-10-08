# KISS Translator 简约翻译

[English](README.en.md) | [中文](README.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

> **个人 fork（分支 `personal-fork`）**：基于上游 `dev` 分支（`a8c5a6f`，版本号 2.1.0），新增两项定制能力，其余行为与上游一致。
>
> 1. **站点级 AI 提示词覆盖**：网页规则新增 `aiPrompt` 字段，追加到该站点 AI 翻译的系统提示词末尾（留空不生效）。
>    内置三套站点规则与术语表：GitHub（编程/AI）、路透/彭博/BBC/经济学人等（政治金融）、成人站点（日英术语 + 露骨内容直译指令）。
> 2. **漫画图片翻译**：新增视觉接口类型 `QwenVL` / `DeepSeekVL`（OpenAI 兼容协议，DashScope、DeepSeek 官方 API、豆包 Ark、Kimi 等均可）。
>    在规则中把「漫画翻译」设为开启后，页面右下角出现悬浮按钮，循环切换三种显示方式：**嵌字**（「漫」，译文直接盖在原气泡上，支持竖排）→ **侧栏弹幕**（「幕」，把图片压窄、译文像弹幕一样贴在两侧栏里，不挡画面）→ **原图**（「原」）。视觉输入会带上该站点的术语表与补充提示词，思考模式也可按接口配置。
>
> 使用、改动清单与手测见 [个人 fork 改动](#个人-fork-改动personal-fork)。

一个简约、开源的 [双语对照翻译扩展 & 油猴脚本](https://github.com/fishjar/kiss-translator)。

[kiss-translator.webm](https://github.com/fishjar/kiss-translator/assets/1157624/f7ba8a5c-e4a8-4d5a-823a-5c5c67a0a47f)

## 感谢以下赞助商对本项目的支持

<table>
  <tr>
    <td align="center"><img src="https://github.com/user-attachments/assets/8c5f141d-9d13-46b0-832f-f6884db4e5d5" width="600" /></td>
    <td>
      <a href="https://go.apimart.ai/gh-gotranslatorrr" target="_blank">
        <b>APIMart</b> 是专注 AI 图片/视频生成的低价 API 平台，GPT-Image-2 低至 $0.006/张，1 美元可出图 160+ 张。图片、视频一套异步 API 通吃，提交任务拿 ID、回调取结果，跑批万张不超时、换模型不改代码。按量付费、无月费，通过此注册链接注册即可开用。
      </a>
    </td>
  </tr>
  <tr>
    <td align="center"><img src="https://platform.ephone.ai/logo-e.png" width="96" /></td>
    <td>
      <a href="https://platform.ephone.ai/" target="_blank">
        <b>ePhone AI</b> 是一个面向开发者的 AI 模型 API 中转与聚合平台，支持 OpenAI、Claude、Gemini、DeepSeek、GLM 等多家大模型。
      </a>
    </td>
  </tr>
</table>

## 特性

- [x] 保持简约
- [x] 开放源代码
- [x] 适配常见浏览器
  - [x] Chrome/Edge
  - [x] Firefox
  - [x] Kiwi (Android)
  - [x] Orion (iOS)
  - [x] Safari
  - [x] Thunderbird
- [x] 支持多种翻译服务
  - [x] Google/Microsoft
  - [x] Tencent/Volcengine
  - [x] OpenAI/Gemini/Claude/Ollama/DeepSeek/OpenRouter/OrcaRouter/Requesty
  - [x] DeepL/DeepLX
  - [x] AzureAI/CloudflareAI
  - [x] Chrome浏览器内置AI翻译(BuiltinAI)
- [x] 覆盖常见翻译场景
  - [x] 网页双语对照翻译
  - [x] 输入框翻译
    - 通过快捷键立即将输入框内文本翻译成其他语言
  - [x] 划词翻译
    - [x] 任意页面打开翻译框，可用多种翻译服务对比翻译
    - [x] 英文词典翻译
    - [x] 收藏词汇
  - [x] 鼠标悬停翻译
  - [x] YouTube 字幕翻译
    - 支持任意翻译服务对视频字幕进行翻译并双语显示
    - 内置基础的字幕合并与断句算法，提升翻译效果
    - 支持AI断句功能，可进一步提升翻译质量
    - 自定义字幕样式
- [x] 支持多样翻译效果
  - [x] 支持自动识别文本与手动规则两种模式
    - 自动识别文本模式使得绝大部分网站无需编写规则也能翻译完整
    - 手动规则模式，可以针对特定网站极致优化
  - [x] 自定义译文样式
  - [x] 支持富文本翻译及显示，能够尽量保留原文中的链接及其他文本样式
  - [x] 支持仅显示译文（隐藏原文）
- [x] 翻译接口高级功能
  - [x] 通过自定义接口，理论上支持任何翻译接口
  - [x] 聚合批量发送翻译文本
  - [x] 支持流式传输，实时显示翻译结果
  - [x] 支持AI上下文会话记忆功能，提升翻译效果
  - [x] 自定义AI术语词典
  - [x] 所有接口均支持Hook和自定义参数等高级功能
- [x] 跨客户端数据同步
  - [x] KISS-Worker（cloudflare/docker）
  - [x] WebDAV
- [x] 自定义翻译规则
  - [x] 规则订阅/规则分享
  - [x] 自定义专业术语
- [x] 自定义快捷键
  - `Alt+Q` 开启翻译
  - `Alt+D` 打开独立翻译窗
  - `Alt+K` 打开设置弹窗
  - `Alt+S` 打开翻译弹窗/翻译选中文字
  - `Alt+O` 打开设置页面
  - `Alt+I` 输入框翻译

## 安装

> 注：基于以下原因，建议优先使用浏览器扩展
>
> - 浏览器扩展的功能更完整（本地语言识别、右键菜单等）
> - 油猴脚本会遇到更多使用上的问题（跨域问题、脚本冲突等）

- [x] 浏览器扩展
  - [x] Chrome [安装地址](https://chrome.google.com/webstore/detail/kiss-translator/bdiifdefkgmcblbcghdlonllpjhhjgof?hl=zh-CN)
    - [x] Kiwi (Android)
    - [x] Orion (iOS)
  - [x] Edge [安装地址](https://microsoftedge.microsoft.com/addons/detail/%E7%AE%80%E7%BA%A6%E7%BF%BB%E8%AF%91/jemckldkclkinpjighnoilpbldbdmmlh?hl=zh-CN)
  - [x] Firefox [安装地址](https://addons.mozilla.org/zh-CN/firefox/addon/kiss-translator/)
  - [ ] Safari
    - [ ] Safari (Mac)
    - [ ] Safari (iOS) 
  - [x] Thunderbird [下载地址](https://github.com/fishjar/kiss-translator/releases)
- [x] 油猴脚本
  - [x] Chrome/Edge/Firefox ([Tampermonkey](https://www.tampermonkey.net/)/[Violentmonkey](https://violentmonkey.github.io/)) [安装链接](https://fishjar.github.io/kiss-translator/kiss-translator.user.js)
    - [Greasy Fork](https://greasyfork.org/zh-CN/scripts/472840-kiss-translator)
  - [x] iOS Safari ([Userscripts Safari](https://github.com/quoid/userscripts)) [安装链接](https://fishjar.github.io/kiss-translator/kiss-translator-ios-safari.user.js)

## 关联项目

- 数据同步服务: [https://github.com/fishjar/kiss-worker](https://github.com/fishjar/kiss-worker)
  - 可用于本项目的数据同步服务。
  - 亦可用于分享个人的私有规则列表。
  - 自己部署，自己管理，数据私有。
- 社区订阅规则: [https://github.com/fishjar/kiss-rules](https://github.com/fishjar/kiss-rules)
  - 提供社区维护的，最新最全的订阅规则列表。
  - 求助规则相关的问题。

## 常见问题

### 如何设置快捷键

在插件管理那里设置，例如： 

- chrome [chrome://extensions/shortcuts](chrome://extensions/shortcuts)
- firefox [about:addons](about:addons)

### 规则设置的优先级是如何的

个人规则 > 订阅规则 > 全局规则

其中全局规则优先级最低，但非常重要，相当于兜底规则。

### 如何在网页上直接编辑规则

打开网页翻译面板，点击「编辑网站规则」。选择规则用途后点击「选取元素」，在网页上点击锁定元素；通过祖先路径调整层级，比较不同定位候选及匹配数量，点击「确认添加定位」加入草稿，最后点击主面板的「保存规则」保存。也可以通过「手动添加」输入 CSS 选择器。选取链接时不会跳转，右键可取消选取；副面板中的 ← / → 可按页面顺序浏览匹配元素。

- 支持翻译目标、排除区域、根容器、保留原文和段落边界。修改、删除、撤销和重做都只更新当前草稿及预览，点击「保存规则」后才写入本地并触发同步。
- 打开编辑器不会自动保存规则，也不会改变自动扫描设置。「自动扫描页面」启用时，目标选择器不是翻译白名单；需要严格指定目标时可选择「禁用」。删除一条定位不等于排除区域，其他规则或自动扫描仍可能覆盖它。
- 「恢复此组继承」重新使用订阅／全局值；「清空此组」将草稿中的该组设为显式空选择器。清空根容器后不扫描页面。
- 没有匹配的个人规则时，新规则的默认网站匹配与 popup 的「网域」一致，例如 `www.bbc.com`，可从下拉列表选择 `*.bbc.com` 等范围，也可输入自定义匹配规则。已有匹配的个人规则会直接载入编辑，保存时保留未修改的其他配置；已有 `hostname:` 规则仍兼容，订阅内容通过个人规则覆盖。
- 有未保存的草稿时，退出或重新读取规则会提示选择「保存规则」「不保存」或「继续编辑」。保存失败或检测到外部冲突会保留草稿；重新读取会替换草稿并清空撤销历史。页面路由变化时也会先提醒处理草稿，避免直接丢失修改。撤销历史仅保留在当前编辑会话。
- 「预计翻译范围」点击一次显示高亮，再次点击关闭，按钮会显示当前开关状态。范围预览使用草稿规则，只查看当前已加载 DOM，不发送翻译请求；内部排除项、保留项和后续语言／长度过滤仍然生效。「查看译文」会执行实际翻译。退出时应用已保存的规则，并恢复进入前的翻译和交互开关；未保存的预览修改不会留在页面上。

当前支持桌面普通 DOM 网页及其动态内容。iframe、Shadow DOM 内部、Canvas 文字和触屏专用操作暂未纳入可视化选取。油猴同源页面通过浏览器 Web Locks 协调写入；不同源页面共享的 GM 存储没有跨源原子事务保证，编辑器会在检测到外部变更时提示重新读取。

### 接口（Ollama等）测试失败

一般接口测试失败常见有以下几种原因：

- 地址填错了：
  - 比如 `Ollama` 有原生接口地址和 `Openai` 兼容的地址，本插件目前统一支持 `Openai` 兼容的地址，不支持 `Ollama` 原生接口地址
- 某些AI模型不支持聚合翻译：
  - 此种情况可以选择禁用聚合翻译或通过自定义接口的方式来使用。
  - 或通过自定义接口的方式来使用，详情参考： [自定义接口示例文档](https://github.com/fishjar/kiss-translator/blob/master/custom-api_v2.md)
- 某些AI模型的参数不一致：
  - 比如 `Gemini` 原生接口参数非常不一致，部分版本的模型不支持某些参数会导致返回错误。
  - 此种情况可以通过 `Hook` 修改请求 `body` ,或者更换为 `Gemini2` (`Openai` 兼容的地址)
- 服务器跨域限制访问，返回403错误：
  - 比如 `Ollama` 启动时须添加环境变量 `OLLAMA_ORIGINS=*`, 参考：https://github.com/fishjar/kiss-translator/issues/174

### 填写的接口在油猴脚本不能使用

油猴脚本需要增加域名白名单，否则不能发出请求。

### 如何设置自定义接口的hook函数

自定义接口功能非常强大、灵活，理论可以接入任何翻译接口。

示例参考： [custom-api_v2.md](https://github.com/fishjar/kiss-translator/blob/master/custom-api_v2.md)

### 如何直接进入油猴脚本设置页面

设置页面地址： https://fishjar.github.io/kiss-translator/options.html

## 未来规划 

 本项目为业余开发，无严格时间表，欢迎社区共建。以下为初步设想的功能方向：

- [x] **聚合发送文本**：优化请求策略，减少翻译接口调用次数，提升性能。
- [x] **增强富文本翻译**：支持更复杂的页面结构和富文本内容的准确翻译。
- [x] **强化自定义/AI 接口**：支持流式传输、上下文记忆、多轮对话等高级 AI 功能。
- [x] **英文词典备灾机制**：当翻译服务失效时，可切换其他词典或 fallback 到本地词典查询。
- [x] **优化 YouTube 字幕支持**：改进流式字幕的合并与翻译体验，减少断句。

- [ ] **支持边缘AI计算**：实现本地轻量的 LLM、ASR、OCR、TTS 辅助翻译。
- [ ] **分布式共享平台**：引入分布式共享机制，用于分享字幕、规则等。
- [ ] **支持文档翻译**：支持翻译 TXT、PDF、图片、漫画等。
- [ ] **翻译Agent**：自研翻译Aagent，实现智能化翻译功能。
- [ ] **项目重构**：重新规划整理功能模块，使用现代框架和技术重构整个项目。
 
 如果你对某个方向感兴趣，欢迎在 [Issues](https://github.com/fishjar/kiss-translator/issues) 中讨论或提交 PR！

## 开发指引

```sh
git clone https://github.com/fishjar/kiss-translator.git
cd kiss-translator
git checkout dev # 提交PR建议推送到dev分支
pnpm install
pnpm build
```

### 外部触发示例

```js
// `toggle_translate`   切换翻译
// `toggle_styles`      切换样式
// `toggle_popup`       打开/关闭控制面板
// `toggle_transbox`    打开/关闭翻译弹窗
// `toggle_hover_node`  翻译鼠标悬停段落
// `input_translate`    翻译输入框
window.dispatchEvent(new CustomEvent("kiss_translator", {detail: { action: "toggle_translate" }}));
```

## 交流

- 加入 [Telegram 群](https://t.me/+RRCu_4oNwrM2NmFl)

## 赞赏

![appreciate](https://github.com/fishjar/kiss-translator/assets/1157624/ebaecabe-2934-4172-8085-af236f5ee399)

## 个人 fork 改动（personal-fork）

> 本节内容只在本 fork 中维护。除下列改动外，翻译链路、界面与上游 `dev`（`a8c5a6f`，版本 2.1.0）完全一致。

### 1. 站点级 AI 提示词覆盖（`aiPrompt`）

- 网页规则新增字段 `aiPrompt`：非空时**追加**到该站点 AI 翻译的系统提示词末尾（聚合 `systemPrompt` 与非聚合 `nobatchPrompt` 两条链路各自生效，不覆盖原始提示词）。基础提示词为空时（如「简洁单句」预设）直接采用站点指令。
- 设置页「网页规则 → 高级选项」可编辑；导入/导出、订阅规则同步均保留该字段。
- 接口缓存的 prompt 签名已包含提示词文本，改 `aiPrompt` 会自动失效旧译文缓存。
- 内置预置规则（可在设置页查看/改）：
  - `github.com`：编程/AI 术语表（LLM、agent、RAG、MoE 等，无译文的条目保留原文）+ 技术文档翻译指令；
  - 路透/美联/彭博/FT/经济学人/WSJ/NYT/CNBC/BBC/卫报/半岛/外交事务/Politico：财经政治术语表（加息、收益率曲线倒挂、鹰派/鸽派等）+ 新闻财经翻译指令；
  - 成人站点（pornhub/xvideos/xnxx/xhamster/missav/e-hentai/exhentai/nhentai/hanime/jable）：日英成人术语表 + 忠实直译（含潜台词与语气）指令，并已把「漫画翻译」默认设为开启。

### 2. 漫画图片翻译（`QwenVL` / `DeepSeekVL`）

- 新增两个视觉接口槽，都走 OpenAI 兼容的 `chat/completions` + `image_url` 协议，**按设置页顺序逐个尝试**（同时启用多个时排前面的先用；主接口欠费/超时/坐标全坏会自动落到后面的槽，见下文「本地保底」）：
  - `QwenVL`：`https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` + `qwen-vl-max-latest`；
  - `DeepSeekVL`：`https://api.deepseek.com/chat/completions` + `deepseek-flash`（DeepSeek 官方 API 自 2026-08 起支持图片输入，旧名 `deepseek-v4-flash-vision-exp` 已由最新 Flash 承接）。
  也支持任何其它 OpenAI 兼容的视觉服务（豆包 Ark、Kimi、SiliconFlow 托管的开源 VL、本机 MLX/Ollama 等）：改 `url` / `model` / `key` 即可。该槽默认关闭聚合与流式，漫画翻译走独立的单图请求链路（每次一张图；接口默认超时 90s，可在接口配置里改）。
- 开启方式：在目标站点的网页规则里把「漫画翻译」设为**开启**。此时页面右下角出现悬浮按钮，循环切换：**嵌字**（「漫」= 译文盖在原图上）→ **侧栏弹幕**（「幕」= 图片压窄、译文贴在两侧栏里，纵向对齐原文、逐条向下堆积不重叠、统一 14px 横排）→ **原图**（「原」= 关掉译文并还原图片尺寸）。切换只改显示方式，不会重新请求接口。
- 两种显示方式的分工：**嵌字**贴近原版面、适合对照阅读；**侧栏弹幕**不遮挡画面（栏位只在图片左右两侧，译文按气泡左右分栏），适合只想快速看对话时用。
- 工作方式：`IntersectionObserver` + `MutationObserver` 只处理进入视口的 `≥300px` 图片（懒加载、翻页原地换 `src`、SPA 都覆盖）；图片经 background 代理下载转 dataURL（跨域图片不受 CORS 限制；若站点有防盗链导致下载被拒，则退回同源 canvas 兜底，跨域图片在兜底路径上会失败并跳过该图），宽度超过 1300px 先压缩再发送（DeepSeek 视觉侧内部长边上限就是约 1300，送更大纯属浪费带宽）；视觉模型返回严格 JSON（`box`/`src`/`dst`/`vertical`），带 markdown 围栏等脏输出会被容错解析；结果按图片 URL 缓存（最多 200 条，超出按更新时间淘汰），覆盖层用百分比定位 + `ResizeObserver` 重算字号，图片缩放时自动跟随，`vertical: true` 的气泡竖排渲染。
- **站点规则同时作用于视觉链路**：漫画翻译的视觉提示词 = 固定基础指令 + 该站点规则的术语表（`aiTerms`，渲染成 `原文 → 译文`，无译文写「保留原文」）+ 该站点的补充提示词（`aiPrompt`，作为「本站点补充要求」），末尾重申「仍然只输出 JSON 数组」。也就是说预置的成人站点术语表/直译指令、GitHub 的编程术语表，对漫画译文同样生效。改了术语表或提示词后，旧图片缓存会自动失效（缓存条目带着提示词签名，签名不一致就重新识别）。
- **思考模式对视觉请求同样生效**：视觉接口在设置页里选的思考模式/强度会按厂商协议注入（DeepSeek 的视觉槽默认 `disabled`，会真的带上 `thinking:{"type":"disabled"}`，避免白花 token；难页想让它推理时改成启用即可）。`QwenVL` 侧**不注入**思考字段（DashScope 的 VL 模型不保证接受该字段），需要的话用「自定义请求体」自己加。
- 与 DeepSeek 视觉接口相关的官方限制（已按此实现，无需额外配置）：图片必须放在 `user` 消息里（`system`/`assistant` 带图返回 400）；支持 JPEG/PNG/GIF/WebP；内联单图 ≤32MiB、请求体 ≤48MiB。模型侧对图片的缩放不会影响定位，因为我们只要归一化坐标。
- 注入元素都带 `notranslate`，不会被自身的网页翻译器二次翻译；`stop()`（页面卸载/重载/规则变更）会移除覆盖层与开关并还原父容器定位样式。
- **坐标用「归一化值」而不是像素**（关键）：提示词要求模型返回 0~1 的归一化坐标（x÷图宽、y÷图高），解析层再乘回发送图尺寸。2026-10-09 用「文字位置已知的合成图」实测：要求像素时 deepseek-flash 的 **y 会被系统性压到约 0.7 倍**（于是弹幕/覆盖层整体偏上，越靠下偏得越多），x 也只是勉强接近；改要归一化值后两个方向都准到 0.01 以内（真机弹幕与原文的纵向中心偏差从几百像素降到 0.5 像素）。`src/manga/prompt.test.js` 有对应回归测试。
- **坐标按「发送尺寸」换算**：过宽的图会先缩到 1300 宽再发（控制 token 与上传体积；DeepSeek 视觉侧内部长边上限约 1300，再送大没有增益），归一化坐标乘的是这张**发送图**的尺寸，因此覆盖层的百分比与字号都用发送尺寸换算，而不是页面原图的 `naturalWidth`。用原图尺寸换算会让整块译文向右上偏 `1300/原宽` 倍（2026-10-09 在 wnacg 真机、原图 2216×3111 上复现并修掉，`src/manga/mangaManager.test.js` 有对应回归测试）。
- **越界坐标会被丢弃**：模型偶尔会把整页当成规则网格返回（真机上见过一张 1500×1978 的图报成 x 到 3.2、y 只占顶部 —— 归一化后仍远超 1）。解析层会丢弃与图幅不相交的框；若一条结果的越界比例超过一半，整条作废并按 `coordsRejected` 记进缓存（不渲染、也不反复重试）。旧缓存里已固化的坏条目会在读取时被重新校验、按需重译。
- **真机实测记录（2026-10-09，wnacg）**：
  - 站点在 Cloudflare 后面：**直接打开相册内页会停在「请稍候…」挑战页**，先访问一次站点首页（几秒即过）再进内页正常。
  - 图片走 CDN + 一次性 `verify=` 令牌，令牌过期或缺会话 cookie 时 background 代理取图会 **403**；跨域图又没法用 canvas 兜底（画布被污染），最终表现为「该图直接跳过、没有覆盖层」。真机日志里能看到 `manga: image data unavailable`。
  - 三种显示方式在真机（`photos-slide-aid-393050`，原图 2216×3111、容器 1388px）实测通过：嵌字态译文盖在原气泡上；弹幕态每张已译图左右各一条栏位、图片压窄到 832px、条目统一 14px 横排且按「原文纵向中心」对齐叠加、互不重叠；「原图」态清空内联宽度、图片还原到 1388px 铺满容器。改用归一化坐标后，真机量化校验（15 页 20 条）中心偏差多为 0.2~0.5px，仅在原文框彼此重叠处被下推让位。
- 油猴版：`dashscope.aliyuncs.com` 与 `api.deepseek.com` 都已在 `config-overrides.js` 的 `@connect` 列表里；改其它视觉服务商时把它的域名加进该列表即可。

### 2.1 本地视觉保底（MLX，免费）

云端视觉接口欠费、超时或坐标全坏时，漫画管理器会**按设置页顺序自动落到下一个启用的视觉槽**——把本地模型排在云端后面即可免费保底（想纯本地就把云端槽停用）。

本机部署（Apple Silicon，已实测 M5/24GB）：

```sh
# 一次性：建环境 + 装 mlx-vlm + 下载模型（约 2.3GB）
uv venv ~/mlx-serve --python 3.13
uv pip install --python ~/mlx-serve/bin/python mlx-vlm
~/mlx-serve/bin/python -c "from huggingface_hub import snapshot_download; print(snapshot_download('mlx-community/Qwen3-VL-4B-Instruct-4bit'))"

# 启动（OpenAI 兼容服务，端口 8080；脚本在 ~/mlx-serve/start.sh）
~/mlx-serve/start.sh &
```

接口配置（设置页「添加接口」选 `QwenVL`）：

| 字段 | 值 |
|---|---|
| url | `http://127.0.0.1:8080/v1/chat/completions` |
| key | 任意非空，如 `local` |
| model | `mlx-community/Qwen3-VL-4B-Instruct-4bit` |
| 超时 | 建议 240s（首次加载模型要几十秒，之后每页约 5-15s） |

模型选型理由：Qwen3-VL 官方 32 语 OCR（含日/中）、竖排文档是其训练强项，Qwen 底模的日→中翻译在开源模型里第一梯队；4B-4bit 在 24GB 统一内存下只占约 3GB，M5 上速度明显快于同档 llama.cpp。备选：`Qwen3-VL-8B-Instruct-4bit`（更准更慢）、`Qwen3-VL-2B-Instruct-4bit`（更快更易漏小字）。

### 改动清单（相对上游）

基线：上游 `dev` 分支 `a8c5a6f`（`package.json` 版本 2.1.0）。本 fork 托管在 `origin`（`serena-sheng/kiss-translator`，私有），上游是 `upstream`（`fishjar/kiss-translator`）。与上游同步：`git fetch upstream && git rebase upstream/dev personal-fork`（先把 `personal-fork` 的改动 rebase 到最新上游，再 push）。

| commit | 内容 |
|---|---|
| `a652c70` | 站点级 `aiPrompt` 字段 + 三套预置站点规则/术语表（GitHub、政治金融、成人站点） |
| `c4869f6` | `QwenVL` 视觉接口 + 漫画翻译模式（图片发现 / 取图 / 覆盖层 / 悬浮开关 / 缓存） |
| `47241ab` | `DeepSeekVL` 视觉槽（官方 API 图片输入）+ 视觉请求支持自定义请求体 |
| `3b382f6` | 测试：钉死 DeepSeek 视觉槽的默认端点与支持图片的模型名 |
| `e1c2927` | 视觉链路吃站点术语表/提示词（带提示词签名失效缓存）+ 思考模式真正注入 |
| `ce427df` | 视觉接口按设置页排序（`sortOrder`）选取 |
| `81d6721` | 修复：视觉返回的气泡坐标按「发送尺寸」换算（原图过宽时会整体偏位） |
| `3270544` | 侧栏弹幕显示方式（「漫 → 幕 → 原」三态循环，`attachMangaLayer` 可运行时换模式） |
| `a9d83f2` | 修复：退出弹幕模式时还原图片尺寸（不再留下被压窄的图） |
| `9b1b468` | 修复：弹幕模式下不拉伸本身比栏位目标还窄的小图 |
| `ab7ce3e` | 弹幕按「原文纵向中心」对齐（不再顶部对齐）；栏位列锚定容器边缘（跨图一致）；显示方式持久化（后续页面沿用）；**坐标改用归一化值**（修掉「弹幕普遍偏上」的 y 轴系统性压缩）+ 越界坐标校验与 `coordsRejected` 缓存 |
| `0f242e3` | 测试：无需真实 Key 的漫画链路 E2E harness（`tools/manga-e2e/`） |
| `37e1757` | 工具：用 CDP 安装未打包扩展（不弹原生目录框） |

> README/文档自身的改动（`ef3604d` 起）不单列，用 `git log -- README.md` 查。

**新增文件**（3 个源码 + 4 个测试 + 1 个 E2E harness 目录）：

| 文件 | 作用 |
|---|---|
| `src/manga/mangaManager.js` | 图片发现（IntersectionObserver + MutationObserver）、取图压缩、视觉接口调用、结果缓存、显隐开关与清理 |
| `src/manga/overlay.js` | 两种显示方式（嵌字覆盖层 / 侧栏弹幕：百分比定位、竖排、字号自适应、左右分栏堆积）与右下角三态悬浮开关 |
| `src/manga/prompt.js` | 视觉提示词拼装（基础指令 + 站点术语表/提示词）与模型返回的容错解析 |
| `tools/manga-e2e/` | 漫画链路 E2E harness：`server.mjs`（桩视觉接口）+ `drive.mjs`（裸 CDP）+ `drive-ego.mjs`（走 ego Space API），不需要真实 API key |

**修改的上游文件**（`git rebase` 时的冲突面就是下面这 16 个，另有本 `README.md` 本身）：

| 关注点 | 文件 |
|---|---|
| 规则字段与新预设 | `src/config/rules.js`、`src/libs/rules.js`、`src/views/Options/Rules.js`、`src/config/i18n.js` |
| 视觉接口注册 | `src/config/api.js`、`src/apis/trans.js`、`src/components/ApiProviderIcon.js` |
| 站点提示词生效 | `src/libs/translator.js` |
| 漫画生命周期与存储 | `src/libs/translatorManager.js`、`src/libs/storage.js`、`src/config/storage.js` |
| 二进制跨上下文回传 | `src/libs/response.js`（新增 `expect: "base64"`） |
| 测试补充 | `src/config/api.test.js`、`src/libs/rules.test.js`、`src/libs/translatorManager.test.js`、`src/libs/response.test.js` |

### 开发命令（本 fork 实测）

上游锁定 **pnpm 9.14.4**（见 `.pnpm-version` 与 `.github/workflows/release.yml`）。用更新的 pnpm（≥ 10）
连 `pnpm install` 都跑不起来：新版不再读 `package.json` 里的 `pnpm.overrides`，会以
`ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` 拒绝执行，并在安装时把那三个安全 override 从锁文件里丢掉。用锁定版本跑即可：

```sh
PNPM="npx -y pnpm@9.14.4"
$PNPM install
CI=true $PNPM test       # 注意：`pnpm test -- --watchAll=false` 会把 `--` 原样传给 jest，参数解析错乱
$PNPM build:chrome       # 产物在 build/chrome/，chrome://extensions 开发者模式加载
pnpm exec prettier --write <改过的文件>   # 别直接跑 `pnpm format`
```

> `pnpm format` 是上游脚本，会对全仓库执行 prettier。本机装的 prettier 版本会重排 `src/config/i18n.js` 里既有的 `TERMINOLOGY_PLAYGROUND_I18N` 段落（约 90 行与本次改动无关的 diff），所以只对改动过的文件跑 `pnpm exec prettier --write`。

### 自动化验证（漫画链路 E2E，不需要 API Key）

`tools/manga-e2e/` 里的 harness 把视觉接口打到本地桩服务，因此可以在没有 Qwen/DeepSeek key 的情况下
把漫画链路整条跑通并断言：扩展装载 → 规则命中 → 悬浮开关 → 图片发现 → 取图转 dataURL → 视觉请求
（含站点术语表 / `aiPrompt` / 思考参数）→ 覆盖层渲染（坐标换算、竖排）→ 缓存与「改术语表即失效」。

```sh
node tools/manga-e2e/server.mjs &                                   # 桩服务
node tools/manga-e2e/drive.mjs                                      # 方式一：一次性 ego 实例 + 裸 CDP（零依赖，不碰日常浏览器）
ego-browser --ego-server-name=kiss-e2e nodejs < tools/manga-e2e/drive-ego.mjs   # 方式二：走 ego 自己的 Space API（过程可见 + 截图）
```

两种方式断言同一批行为（33 条 / 27 条），失败以非 0 退出码结束。方式二需要先起一个带本扩展的 ego 服务，
细节与踩坑（storage 存 JSON 字符串、ego profile 持久导致的缓存命中、注入元素异步出现）见
`tools/manga-e2e/README.md`。

### 加载方式（本 fork 构建产物）

```sh
pnpm build:chrome                                   # 产物：build/chrome/
cd build/chrome && npx bestzip ../kiss-translator-personal-fork-chrome.zip * .nojekyll
```

- **压缩包直接拖入**：先打开 `chrome://extensions` 右上角的「开发者模式」，把 `build/kiss-translator-personal-fork-chrome.zip` 拖进页面即自动安装（包根目录已放好 `manifest.json`）。
- **加载已解压目录**：`chrome://extensions` → 「加载已解压的扩展程序」→ 选 `build/chrome/`。改代码后重新 `pnpm build:chrome`，在扩展卡片上点「重新加载」。
- **不用点原生目录框的装法**：让浏览器以 `--enable-unsafe-extension-debugging` 启动，然后
  `node tools/load-extension.mjs --port <调试端口>` —— 它走 CDP 的 `Extensions.loadUnpacked`，
  等价于「加载已解压的扩展程序」；`--launch` 会自动起一个带调试口的隔离实例再装。
- 若已装商店版 KISS Translator，**先禁用它**：两个扩展都会注入内容脚本，同一个页面会出现双份翻译。
- 版本号沿用上游 `2.1.0`（Chrome 扩展版本号只允许点分数字，加 `-fork` 后缀会导致加载失败），加载后的卡片自带「已加载未打包扩展程序」标记，足够区分。

### 手测清单

1. `chrome://extensions` 加载 `build/chrome/`，设置页「接口」里**启用一个视觉接口**（`QwenVL` 或 `DeepSeekVL`，本机若已有 DeepSeek key 选后者更省事）并填 API Key（可改 url/model）。**若接口列表里看不到新内置接口**（旧设置不会自动并入新增加的预设接口，视觉槽是后加的），点「添加接口」→ 选 `QwenVL` / `DeepSeekVL` 创建一个实例即可（url/model 已预填）。**改动网页规则后需刷新目标页面**：设置页的规则变更不会热更新已打开页面的内容脚本（`TranslatorManager` 只监听设置键，规则键没有监听器）。
2. GitHub 仓库 README：开启双语翻译，检查 `agent→智能体`、`transformer` 保留原文；术语高亮样式正常。
3. reuters.com 文章：`rate hike→加息`、`hawkish→鹰派`。
4. 任一成人站点：术语与语气（央求/羞耻等）是否落地，标题/标签用中文社区惯用说法。
5. e-hentai / nhentai 阅读页：右下角出现「漫」按钮 → 点击后气泡被中文覆盖、竖排正确、翻页/滚动后新图自动处理 → 再点按钮切回原文。
6. 在规则里改一条术语表（或改 `aiPrompt`）→ 刷新漫画页：译文应随之变化（缓存条目带提示词签名，站点规则一变旧缓存即失效）；若接口思考模式改成启用，请求体里会带 `thinking:{"type":"enabled"}`。

> 第 5、6 条（含「改术语表即失效」「按 sortOrder 选视觉槽」「DeepSeek 思考参数真的进请求体」）已被
> `tools/manga-e2e/` 的 E2E harness 自动覆盖，不必每次手点；剩下真正需要人眼判断的是第 2–4 条的译文质量。
