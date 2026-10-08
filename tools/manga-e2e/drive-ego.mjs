/**
 * @file drive-ego.mjs
 * @description 漫画翻译链路的 E2E 验证（走 ego 自己的 Space / TaskSpace API，不使用裸 CDP）。
 *
 * 与 drive.mjs 断言同一批行为，区别只是驱动方式：
 *   - drive.mjs     ：自己拉一个一次性 ego 实例 + 裸 CDP（不依赖 ego 服务名，适合无人值守）
 *   - drive-ego.mjs ：连到指定的 ego 服务，新建/复用 TaskSpace，用 page/snapshot/screenshot 驱动
 *                     （测试过程在 ego 窗口里可见，还能顺手截一张图给人看）
 *
 * 两者都打到 tools/manga-e2e/server.mjs 桩服务，因此不需要真实 API key。
 *
 * 前置：
 *   1. 桩服务在跑：node tools/manga-e2e/server.mjs
 *   2. 一个带本扩展的 ego 服务在跑，例如：
 *        "/Applications/ego lite.app/Contents/MacOS/ego lite" \
 *          --user-data-dir=/tmp/ego-kiss-space \
 *          --load-extension=$PWD/build/chrome \
 *          --ego-server-name=kiss-e2e
 *      （首次启动需要在 <user-data-dir>/ego_config.json 里写 "not_first_run": true，
 *        否则 ego 会弹首次运行向导并拒绝 agent 接入）
 *   3. pnpm build:chrome（保证 build/chrome 是最新的）
 *
 * 用法：node tools/manga-e2e/drive-ego.mjs [服务名] [space 名]
 */
// 这个脚本是喂给 `ego-browser nodejs` 的（自带 Node ESM 运行时），
// 因此只动态 import 内置模块，并用 cwd / 环境变量定位仓库。
const crypto = await import("node:crypto");
const { existsSync } = await import("node:fs");
const path = (await import("node:path")).default;

// ego 的 nodejs 运行时不一定继承 cwd/env，因此在几个候选位置里自己找构建产物
const extCandidates = [
  process.env.KISS_EXT,
  path.join(process.cwd(), "build/chrome"),
  path.join(process.env.HOME || "", "Developer/kiss-translator/build/chrome"),
].filter(Boolean);
const EXT =
  extCandidates.find((p) => existsSync(path.join(p, "manifest.json"))) ||
  extCandidates[0];

const SERVER_NAME =
  process.argv[2] || process.env.EGO_SERVER_NAME || "kiss-e2e";
const SPACE_NAME = process.argv[3] || "kiss manga e2e";
const STUB = process.env.STUB || "http://127.0.0.1:8790";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ego 的 nodejs 运行时对长任务的 stdout 不可靠，因此同时写一份日志文件
const fs = (await import("node:fs")).default;
const LOG_FILE =
  process.env.KISS_E2E_LOG || path.join(path.dirname(EXT), "manga-e2e-ego.log");
try {
  fs.writeFileSync(LOG_FILE, "");
} catch (err) {
  // 日志文件写不了就只靠 stdout
}
const log = (...a) => {
  const line = a
    .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
    .join(" ");
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch (err) {
    // 忽略
  }
  console.log(line);
};
// 内容脚本注入后，覆盖层/悬浮开关要等 TranslatorManager 读完 storage 才出现，必须轮询而不是固定等待
const waitFor = (page, fn, timeout = 30000) =>
  page.waitForFunction(fn, undefined, { timeout }).catch(() => null);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok) });
  log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

/** 未打包扩展的 ID = SHA-256(绝对路径) 前 16 字节按 a-p 十六进制映射 */
const unpackedExtensionId = (extPath) => {
  const hash = crypto.default
    .createHash("sha256")
    .update(extPath)
    .digest()
    .subarray(0, 16);
  return [...hash]
    .map(
      (byte) => "abcdefghijklmnop"[byte >> 4] + "abcdefghijklmnop"[byte & 15]
    )
    .join("");
};

async function main() {
  if (!existsSync(path.join(EXT, "manifest.json"))) {
    throw new Error(`扩展构建产物不存在：${EXT}，先跑 pnpm build:chrome`);
  }
  await fetch(`${STUB}/__reset`).catch(() => {
    throw new Error(
      `桩服务没起来（${STUB}），先跑 node tools/manga-e2e/server.mjs`
    );
  });

  const extId = unpackedExtensionId(EXT);
  const optionsUrl = `chrome-extension://${extId}/options.html`;

  const task = await taskSpace(SPACE_NAME);
  log(
    `→ ego space: #${task.spaceId}「${task.name}」(${task.ownership})｜扩展 ${extId}`
  );
  const page = task.page("p1");

  // 打开一张普通页面，确认这个 space 里的内容脚本确实注入了扩展
  await page.goto(`${STUB}/fixture`);
  await waitFor(
    page,
    () =>
      [...document.querySelectorAll("[id]")].some((n) => n.id.includes("kiss")),
    20000
  );
  const injected = await page.evaluate(() =>
    [...document.querySelectorAll("[id]")]
      .map((n) => n.id)
      .filter((id) => id.includes("kiss"))
  );
  check(
    "space 页面里注入了本扩展的内容脚本",
    injected.length > 0,
    injected.join(",")
  );
  if (!injected.length) {
    throw new Error("扩展没有注入（ego 服务是不是没用 --load-extension 起？）");
  }

  // storage 的键名带运行时拼接的前后缀，从设置页里探出来；
  // 值一律 JSON 字符串（storage 层 getObj = JSON.parse(rawGet)）。
  const pageEval = async (expression) => {
    await page.goto(optionsUrl);
    await page.waitForLoadState();
    await sleep(2000);
    return page.evaluate(expression);
  };

  const keyInfo = await pageEval(`(async () => {
    const keys = Object.keys(await chrome.storage.local.get(null));
    return {
      setKey: keys.find((k) => /_setting_v\\d+$/.test(k)) || null,
      rulesKey: keys.find((k) => /_rules_v\\d+$/.test(k)) || null,
    };
  })()`);
  check(
    "设置页可打开并已初始化 storage 键名",
    Boolean(keyInfo.setKey && keyInfo.rulesKey),
    JSON.stringify(keyInfo)
  );

  const writeScenario = async (mutate) => {
    const script = `(async () => {
      const setKey = ${JSON.stringify(keyInfo.setKey)};
      const rulesKey = ${JSON.stringify(keyInfo.rulesKey)};
      const all = await chrome.storage.local.get(null);
      // ego 的 profile 是持久的：不清缓存的话复用同一张图会命中上一轮的缓存，观察不到新的视觉请求
      const cacheKey = Object.keys(all).find((k) => k.endsWith("_manga_cache"));
      if (cacheKey) await chrome.storage.local.remove(cacheKey);
      const setting = { ...(all[setKey] ? JSON.parse(all[setKey]) : {}) };
      const rules = all[rulesKey] ? JSON.parse(all[rulesKey]) : [];
      ${mutate}
      await chrome.storage.local.set({
        [setKey]: JSON.stringify(setting),
        [rulesKey]: JSON.stringify(rules),
      });
      const after = await chrome.storage.local.get(null);
      return {
        transApis: (JSON.parse(after[setKey]).transApis || []).map((a) => a.apiType + "@" + (a.sortOrder ?? 0) + ":" + !!a.key),
        rules: JSON.parse(after[rulesKey]).map((r) => r.pattern + " manga=" + r.mangaEnabled + " terms=" + r.aiTerms),
      };
    })()`;
    return pageEval(script);
  };

  // ---- 场景 1：一个视觉槽 + 站点术语表/提示词 ----
  const s1 = await writeScenario(`
      setting.version = setting.version || 3;
      setting.logLevel = "debug";
      setting.transApis = [{
        apiSlug: "e2e-vision",
        apiType: "QwenVL",
        name: "E2E stub vision",
        url: "${STUB}/v1/chat/completions",
        key: "e2e-stub-key",
        model: "stub-vl-model",
        isDisabled: false,
        useBatchFetch: false,
        useStream: false,
      }];
      rules.splice(0, rules.length, {
        pattern: "127.0.0.1",
        enabled: true,
        mangaEnabled: "true",
        aiTerms: "ご主人様,主人",
        aiPrompt: "E2E 站点补充要求：称呼一律译为「您」。",
      });
  `);
  check(
    "视觉接口写入 storage",
    s1.transApis.length === 1,
    JSON.stringify(s1.transApis)
  );
  check(
    "站点规则写入 storage（mangaEnabled=true）",
    /manga=true/.test(s1.rules[0] || ""),
    s1.rules[0]
  );

  await fetch(`${STUB}/__reset`);
  await page.goto(`${STUB}/fixture`);
  await waitFor(
    page,
    () => document.querySelectorAll(".kiss-manga-bubble").length >= 2
  );
  await sleep(500);

  const vision1 = await (await fetch(`${STUB}/__log`)).json();
  const dom = await page.evaluate(() => {
    const toggle = document.querySelector(".kiss-manga-toggle");
    const overlays = [...document.querySelectorAll(".kiss-manga-overlay")];
    const img = document.querySelector("#big");
    return {
      toggle: toggle
        ? {
            text: toggle.textContent,
            display: getComputedStyle(toggle).display,
          }
        : null,
      overlayCount: overlays.length,
      overlayNotranslate: overlays.every((o) =>
        o.classList.contains("notranslate")
      ),
      parentPosition: img ? getComputedStyle(img.parentElement).position : null,
      bubbles: [...document.querySelectorAll(".kiss-manga-bubble")].map(
        (el) => ({
          text: el.textContent,
          writingMode: getComputedStyle(el).writingMode,
          left: el.style.left,
          width: el.style.width,
          notranslate: el.classList.contains("notranslate"),
        })
      ),
    };
  });

  const v1 = vision1[0];
  check("发出了视觉请求", vision1.length === 1, `requests=${vision1.length}`);
  check(
    "请求带接口配置的 Key",
    v1?.authorization === "Bearer e2e-stub-key",
    v1?.authorization
  );
  check(
    "图片经 background 代理取回转成 dataURL",
    String(v1?.imageUrlPrefix).startsWith("data:image/"),
    String(v1?.imageUrlPrefix)
  );
  check(
    "图片放在 user 消息里",
    v1?.userPartTypes.join("+") === "image_url+text",
    v1?.userPartTypes.join("+")
  );
  check(
    "视觉提示词含基础指令",
    Boolean(v1?.systemPrompt.includes("漫画翻译引擎"))
  );
  check(
    "站点术语表进了视觉提示词",
    Boolean(v1?.systemPrompt.includes("ご主人様 → 主人"))
  );
  check(
    "站点 aiPrompt 进了视觉提示词",
    Boolean(v1?.systemPrompt.includes("E2E 站点补充要求"))
  );
  check(
    "规则命中时挂上「漫」悬浮开关",
    dom.toggle?.text === "漫",
    JSON.stringify(dom.toggle)
  );
  check(
    "图片上挂了覆盖层",
    dom.overlayCount === 1,
    `overlay=${dom.overlayCount}`
  );
  check("覆盖层带 notranslate", dom.overlayNotranslate === true);
  check(
    "父容器定位被改写为 relative",
    dom.parentPosition === "relative",
    dom.parentPosition
  );
  check(
    "渲染出 2 个气泡",
    dom.bubbles.length === 2,
    JSON.stringify(dom.bubbles.map((b) => b.text))
  );
  check(
    "气泡文案来自视觉模型返回",
    dom.bubbles[0]?.text === "你好，主人",
    dom.bubbles[0]?.text
  );
  check(
    "vertical:true 的气泡竖排渲染",
    dom.bubbles[0]?.writingMode === "vertical-rl",
    dom.bubbles[0]?.writingMode
  );
  check(
    "气泡坐标换成百分比",
    dom.bubbles[0]?.left === "11.1111%" && dom.bubbles[0]?.width === "35.5556%",
    `${dom.bubbles[0]?.left} ${dom.bubbles[0]?.width}`
  );

  // 悬浮开关是「漫 → 幕 → 原」三态循环（不是简单的显隐两态）
  const toggleState = await page.evaluate(() => {
    const btn = document.querySelector(".kiss-manga-toggle");
    const seq = [];
    for (let i = 0; i < 3; i++) {
      btn.click();
      seq.push({
        label: btn.textContent,
        overlay:
          document.querySelector(".kiss-manga-overlay")?.style.display ??
          "(无覆盖层)",
        gutterDisplays: [
          ...document.querySelectorAll(".kiss-manga-gutter"),
        ].map((g) => g.style.display || ""),
      });
    }
    return seq;
  });
  check(
    "点开关切到侧栏弹幕（覆盖层撤下、左右栏出现）",
    toggleState[0].label === "幕" &&
      toggleState[0].overlay === "(无覆盖层)" &&
      toggleState[0].gutterDisplays.length === 2,
    JSON.stringify(toggleState[0])
  );
  check(
    "再点切回原图（栏位整体隐藏）",
    toggleState[1].label === "原" &&
      toggleState[1].gutterDisplays.length > 0 &&
      toggleState[1].gutterDisplays.every((d) => d === "none"),
    JSON.stringify(toggleState[1])
  );
  check(
    "再点恢复嵌字（覆盖层重新显示）",
    toggleState[2].label === "漫" && toggleState[2].overlay === "",
    JSON.stringify(toggleState[2])
  );

  // 给人看的证据：留一张渲染后的截图
  const shot = path.join(path.dirname(EXT), "manga-e2e-ego.png");
  await page.screenshot({ path: shot });
  log(`→ 截图：${shot}`);

  // ---- 场景 2：改站点术语表 → 缓存提示词签名失效 → 重新识别 ----
  await fetch(`${STUB}/__reset`);
  await writeScenario(`rules[0].aiTerms = "やめて,不要啊";`);
  await page.goto(`${STUB}/fixture`);
  await waitFor(
    page,
    () => document.querySelectorAll(".kiss-manga-bubble").length >= 2
  );
  await sleep(500);
  const vision2 = await (await fetch(`${STUB}/__log`)).json();
  check(
    "换术语表后旧缓存失效并重新识别",
    vision2.length === 1,
    `requests=${vision2.length}`
  );
  check(
    "新提示词用上新术语表",
    Boolean(vision2[0]?.systemPrompt.includes("やめて → 不要啊"))
  );
  check(
    "新提示词不再含旧术语",
    !vision2[0]?.systemPrompt.includes("ご主人様 → 主人")
  );

  // ---- 场景 3：两个视觉槽 → 按 sortOrder 选一个 + DeepSeek 思考注入 ----
  await fetch(`${STUB}/__reset`);
  const s3 = await writeScenario(`
      setting.transApis = [
        { apiSlug: "e2e-vision-qwen", apiType: "QwenVL", name: "qwen", url: "${STUB}/qwen/v1/chat/completions", key: "k1", model: "qwen-vl-max-latest", isDisabled: false, sortOrder: 5 },
        { apiSlug: "e2e-vision-ds", apiType: "DeepSeekVL", name: "ds", url: "${STUB}/ds/v1/chat/completions", key: "k2", model: "deepseek-flash", isDisabled: false, sortOrder: 1, thinkingMode: "disabled" },
      ];
  `);
  check(
    "两个视觉槽写入（更小的 sortOrder 更优先）",
    s3.transApis.join(",") === "QwenVL@5:true,DeepSeekVL@1:true",
    s3.transApis.join(",")
  );
  await page.goto(`${STUB}/fixture`);
  await waitFor(
    page,
    () => document.querySelectorAll(".kiss-manga-bubble").length >= 2
  );
  await sleep(500);
  const vision3 = await (await fetch(`${STUB}/__log`)).json();
  const v3 = vision3[0];
  check(
    "请求打到 sortOrder 更小的槽",
    v3?.path === "/ds/v1/chat/completions" && v3?.authorization === "Bearer k2",
    `${v3?.path} ${v3?.authorization}`
  );
  check(
    "DeepSeek 槽的思考模式注入 thinking",
    JSON.stringify(v3?.thinking) === '{"type":"disabled"}',
    JSON.stringify(v3?.thinking)
  );

  const failed = results.filter((r) => !r.ok);
  log(
    `\n================ 结果：${results.length - failed.length}/${results.length} 通过（ego space #${task.spaceId}）================`
  );
  failed.forEach((f) => log("  FAIL  " + f.name));

  await task.finish({ keep: [] });
  return failed.length;
}

main()
  .then((failed) => process.exit(failed ? 1 : 0))
  .catch((err) => {
    console.error("FAILED:", err);
    process.exit(1);
  });
