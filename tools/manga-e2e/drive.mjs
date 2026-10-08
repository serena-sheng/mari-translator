/**
 * @file drive.mjs
 * @description 漫画翻译链路的端到端验证（CDP 驱动一次性 ego lite 实例）。
 *
 * 覆盖本 fork 的漫画相关改动，且不需要真实 API key（视觉接口打到 tools/manga-e2e/server.mjs 桩服务）：
 *   1. 扩展能在 ego lite 里装起来（--load-extension 一次性 profile，不碰用户日常 profile）；
 *   2. 站点规则 mangaEnabled → 悬浮开关挂载；
 *   3. 图片发现 → 经 background 代理取图转 dataURL → 视觉请求（含站点术语表 + aiPrompt）；
 *   4. 覆盖层渲染：坐标百分比、竖排/横排、notranslate；
 *   5. 悬浮开关切换显隐；
 *   6. 站点术语表变更 → 缓存提示词签名失效 → 重新识别；
 *   7. 视觉接口按设置页排序（sortOrder）选取 + DeepSeek 思考模式注入 thinking。
 *
 * 用法：
 *   node tools/manga-e2e/server.mjs &     # 先起桩服务
 *   pnpm build:chrome                     # 确保 build/chrome 是最新的
 *   node tools/manga-e2e/drive.mjs        # 断言全过则退出码 0
 *
 * 依赖：Node.js ≥ 22（用内置 WebSocket）、macOS 上已安装 ego lite。无需额外 npm 依赖。
 */
import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");

const EGO =
  process.env.EGO_BIN || "/Applications/ego lite.app/Contents/MacOS/ego lite";
const EXT = process.env.KISS_EXT || path.join(REPO, "build/chrome");
const STUB = process.env.STUB || "http://127.0.0.1:8790";
const CDP_PORT = Number(process.env.CDP_PORT || 9333);
const PROFILE =
  process.env.PROFILE || path.join(os.tmpdir(), "kiss-manga-e2e-profile");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok) });
  log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

// 只清理本次探针自己的一次性实例（profile 路径唯一），不会碰到用户日常的 ego
const killProbe = () => {
  try {
    execSync(`pkill -f "user-data-dir=${PROFILE}" || true`);
  } catch (err) {
    // 没有匹配进程时 pkill 返回非 0，忽略
  }
};

async function cdpReady() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch (err) {
      // 还没起来
    }
    await sleep(500);
  }
  throw new Error("CDP endpoint never came up");
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const listeners = [];
    let nextId = 0;
    ws.onopen = () =>
      resolve({
        on: (fn) => listeners.push(fn),
        send: (method, params = {}, sessionId) =>
          new Promise((res, rej) => {
            const id = ++nextId;
            pending.set(id, { res, rej });
            ws.send(
              JSON.stringify(
                sessionId
                  ? { id, method, params, sessionId }
                  : { id, method, params }
              )
            );
          }),
      });
    ws.onerror = (e) =>
      reject(new Error("ws error " + String(e?.message || e)));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) {
        listeners.forEach((fn) => fn(msg));
      }
    };
  });
}

const evaluate = async (send, sessionId, expression) => {
  const r = await send(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    sessionId
  );
  if (r.exceptionDetails) {
    throw new Error("page eval failed: " + JSON.stringify(r.exceptionDetails));
  }
  return r.result?.value;
};

const fetchLog = async () => (await fetch(`${STUB}/__log`)).json();

async function main() {
  if (!existsSync(path.join(EXT, "manifest.json"))) {
    throw new Error(`扩展构建产物不存在：${EXT}，先跑 pnpm build:chrome`);
  }
  if (!existsSync(EGO)) {
    throw new Error(`找不到 ego lite：${EGO}`);
  }
  await fetch(`${STUB}/__reset`).catch(() => {
    throw new Error(
      `桩服务没起来（${STUB}），先跑 node tools/manga-e2e/server.mjs`
    );
  });

  killProbe();
  await sleep(800);
  await rm(PROFILE, { recursive: true, force: true });

  log("→ 启动一次性 ego lite（独立 profile + 加载扩展）");
  const child = spawn(
    EGO,
    [
      `--user-data-dir=${PROFILE}`,
      `--load-extension=${EXT}`,
      `--remote-debugging-port=${CDP_PORT}`,
      "--remote-allow-origins=*",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-component-update",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" }
  );
  child.unref();

  const version = await cdpReady();
  const { send, on } = await connect(version.webSocketDebuggerUrl);
  await send("Target.setDiscoverTargets", { discover: true });

  const consoleLines = [];
  on((msg) => {
    if (msg.method === "Runtime.consoleAPICalled") {
      consoleLines.push(
        msg.params.args
          .map((a) => a.value ?? a.description ?? a.unserializableValue ?? "")
          .join(" ")
      );
    } else if (msg.method === "Runtime.exceptionThrown") {
      consoleLines.push(
        "[exception] " +
          (msg.params.exceptionDetails?.exception?.description ||
            msg.params.exceptionDetails?.text)
      );
    }
  });

  // ---- 1. 扩展装起来了吗 ----
  let extTarget = null;
  for (let i = 0; i < 60 && !extTarget; i++) {
    const list = (await send("Target.getTargets")).targetInfos;
    extTarget = list.find((t) => t.url.startsWith("chrome-extension://"));
    if (!extTarget) await sleep(500);
  }
  check("扩展在 ego lite 中加载（service worker 起得来）", Boolean(extTarget));
  if (!extTarget) throw new Error("扩展没有加载，后续无法继续");
  const extId = new URL(extTarget.url).host;

  // ---- 2. 写站点规则与视觉接口（storage 的值是 JSON 字符串） ----
  // 扩展安装后会自己打开一次 options.html；它会把自己的内存快照回写 storage，
  // 是唯一的竞争写方，因此先探键名、关掉所有扩展页面，再从 service worker 写。
  const optTarget = await send("Target.createTarget", {
    url: `chrome-extension://${extId}/options.html`,
  });
  const { sessionId: optSession } = await send("Target.attachToTarget", {
    targetId: optTarget.targetId,
    flatten: true,
  });
  await evaluate(send, optSession, "document.readyState");
  await sleep(3000);

  const keyInfo = await evaluate(
    send,
    optSession,
    `(async () => {
      const keys = Object.keys(await chrome.storage.local.get(null));
      return {
        setKey: keys.find((k) => /_setting_v\\d+$/.test(k)) || null,
        rulesKey: keys.find((k) => /_rules_v\\d+$/.test(k)) || null,
      };
    })()`
  );
  check(
    "设置页已初始化 storage 键名",
    Boolean(keyInfo.setKey && keyInfo.rulesKey),
    JSON.stringify(keyInfo)
  );

  const extPages = (await send("Target.getTargets")).targetInfos.filter(
    (t) => t.type === "page" && t.url.startsWith("chrome-extension://")
  );
  for (const t of extPages) {
    await send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
  }
  await sleep(1500);

  const swTarget = (await send("Target.getTargets")).targetInfos.find(
    (t) => t.type === "service_worker" && t.url.includes(extId)
  );
  if (!swTarget)
    throw new Error("service worker target 不在，无法安全写 storage");
  const { sessionId: swSession } = await send("Target.attachToTarget", {
    targetId: swTarget.targetId,
    flatten: true,
  });

  const writeScript = `(async () => {
      const setKey = ${JSON.stringify(keyInfo.setKey)};
      const rulesKey = ${JSON.stringify(keyInfo.rulesKey)};
      const all = await chrome.storage.local.get(null);
      // 关键：storage 层把值当 JSON 字符串存取（getObj = JSON.parse(rawGet)），
      // 直接写对象内容脚本读不到，会落 "parse json in storage err"。
      const setting = { ...(all[setKey] ? JSON.parse(all[setKey]) : {}) };
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
      const rule = {
        pattern: "127.0.0.1",
        enabled: true,
        mangaEnabled: "true",
        aiTerms: "ご主人様,主人",
        aiPrompt: "E2E 站点补充要求：称呼一律译为「您」。",
      };
      await chrome.storage.local.set({
        [setKey]: JSON.stringify(setting),
        [rulesKey]: JSON.stringify([rule]),
      });
      const after = await chrome.storage.local.get(null);
      const stored = JSON.parse(after[setKey]);
      return {
        version: stored.version,
        transApis: (stored.transApis || []).map((a) => a.apiType + ":" + a.apiSlug + ":key=" + !!a.key),
        rules: JSON.parse(after[rulesKey]).map((r) => r.pattern + " manga=" + r.mangaEnabled),
      };
    })()`;

  let storage = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    storage = await evaluate(send, swSession, writeScript);
    if (storage.transApis.length) break;
    await sleep(1000);
  }
  check(
    "视觉接口写入 storage",
    storage.transApis.length === 1,
    JSON.stringify(storage.transApis)
  );
  check(
    "站点规则写入 storage（mangaEnabled=true）",
    storage.rules[0] === "127.0.0.1 manga=true"
  );

  // ---- 3. 打开 fixture 页，等漫画链路跑完 ----
  await fetch(`${STUB}/__reset`);
  const pageTarget = await send("Target.createTarget", {
    url: `${STUB}/fixture`,
  });
  const { sessionId: pageSession } = await send("Target.attachToTarget", {
    targetId: pageTarget.targetId,
    flatten: true,
  });
  await send("Runtime.enable", {}, pageSession);
  await send("Page.enable", {}, pageSession);
  await send("Page.navigate", { url: `${STUB}/fixture` }, pageSession);
  await sleep(12000);

  const visionLog = await fetchLog();
  const dom = await evaluate(
    send,
    pageSession,
    `(() => {
       const toggle = document.querySelector(".kiss-manga-toggle");
       const overlays = [...document.querySelectorAll(".kiss-manga-overlay")];
       const img = document.querySelector("#big");
       return {
         toggle: toggle ? { text: toggle.textContent, display: getComputedStyle(toggle).display } : null,
         overlayCount: overlays.length,
         overlayNotranslate: overlays.every((o) => o.classList.contains("notranslate")),
         parentPosition: img ? getComputedStyle(img.parentElement).position : null,
         bubbles: [...document.querySelectorAll(".kiss-manga-bubble")].map((el) => ({
           text: el.textContent,
           writingMode: getComputedStyle(el).writingMode,
           left: el.style.left,
           width: el.style.width,
           notranslate: el.classList.contains("notranslate"),
         })),
       };
     })()`
  );

  const cache = await evaluate(
    send,
    swSession,
    `(async () => {
       const all = await chrome.storage.local.get(null);
       const key = Object.keys(all).find((k) => k.endsWith("_manga_cache"));
       if (!key) return null;
       const entries = Object.values(JSON.parse(all[key]));
       return { count: entries.length, promptSig: entries[0]?.promptSig, bubbles: entries[0]?.bubbles?.length };
     })()`
  );

  const v1 = visionLog[0];
  check(
    "发出了视觉请求",
    visionLog.length === 1,
    `requests=${visionLog.length}`
  );
  check(
    "请求带接口配置的 Key",
    v1?.authorization === "Bearer e2e-stub-key",
    v1?.authorization
  );
  check("请求模型来自接口配置", v1?.model === "stub-vl-model", v1?.model);
  check(
    "图片经 background 代理取回转成 dataURL",
    String(v1?.imageUrlPrefix).startsWith("data:image/") &&
      v1?.imageUrlBytes > 100,
    `${v1?.imageUrlPrefix}… (${v1?.imageUrlBytes} 字节)`
  );
  check(
    "图片放在 user 消息里（system 只放文本）",
    v1?.userPartTypes.join("+") === "image_url+text",
    v1?.userPartTypes.join("+")
  );
  check(
    "视觉提示词含基础指令",
    Boolean(v1?.systemPrompt.includes("漫画翻译引擎"))
  );
  check(
    "站点术语表进了视觉提示词",
    Boolean(v1?.systemPrompt.includes("ご主人様 → 主人")),
    "ご主人様 → 主人"
  );
  check(
    "站点 aiPrompt 进了视觉提示词",
    Boolean(v1?.systemPrompt.includes("E2E 站点补充要求")),
    ""
  );
  check(
    "提示词末尾重申只输出 JSON",
    Boolean(v1?.systemPrompt.includes("仍然只输出 JSON 数组"))
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
  check(
    "覆盖层带 notranslate（不会被自身翻译器二次翻译）",
    dom.overlayNotranslate === true
  );
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
    "vertical:false 的气泡横排渲染",
    dom.bubbles[1]?.writingMode === "horizontal-tb",
    dom.bubbles[1]?.writingMode
  );
  check(
    "气泡坐标按图片原尺寸换算成百分比",
    dom.bubbles[0]?.left === "11.1111%" && dom.bubbles[0]?.width === "35.5556%",
    `left=${dom.bubbles[0]?.left} width=${dom.bubbles[0]?.width}`
  );
  check(
    "气泡带 notranslate",
    dom.bubbles.every((b) => b.notranslate)
  );
  check(
    "结果写进漫画缓存（带提示词签名）",
    cache?.count === 1 && Boolean(cache?.promptSig),
    JSON.stringify(cache)
  );

  // ---- 4. 悬浮开关切换显隐 ----
  const toggleState = await evaluate(
    send,
    pageSession,
    `(() => {
       const btn = document.querySelector(".kiss-manga-toggle");
       const overlay = document.querySelector(".kiss-manga-overlay");
       btn.click();
       const hidden = overlay.style.display;
       btn.click();
       return { hidden, shown: overlay.style.display };
     })()`
  );
  check("点开关隐藏覆盖层", toggleState.hidden === "none", toggleState.hidden);
  check(
    "再点恢复显示",
    toggleState.shown === "",
    `display="${toggleState.shown}"`
  );

  // ---- 5. 改站点术语表 → 缓存签名失效 → 重新识别 ----
  await fetch(`${STUB}/__reset`);
  await evaluate(
    send,
    swSession,
    `(async () => {
       const all = await chrome.storage.local.get(null);
       const rulesKey = ${JSON.stringify(keyInfo.rulesKey)};
       const rules = JSON.parse(all[rulesKey]);
       rules[0].aiTerms = "やめて,不要啊";
       await chrome.storage.local.set({ [rulesKey]: JSON.stringify(rules) });
     })()`
  );
  await send("Page.reload", {}, pageSession);
  await sleep(12000);
  const visionLog2 = await fetchLog();
  const newSig = await evaluate(
    send,
    swSession,
    `(async () => {
       const all = await chrome.storage.local.get(null);
       const key = Object.keys(all).find((k) => k.endsWith("_manga_cache"));
       return Object.values(JSON.parse(all[key]))[0]?.promptSig;
     })()`
  );
  check(
    "换术语表后旧缓存失效并重新识别",
    visionLog2.length === 1,
    `requests=${visionLog2.length}`
  );
  check(
    "新提示词用上新术语表",
    Boolean(visionLog2[0]?.systemPrompt.includes("やめて → 不要啊"))
  );
  check(
    "新提示词不再含旧术语",
    !visionLog2[0]?.systemPrompt.includes("ご主人様 → 主人")
  );
  check(
    "缓存提示词签名随站点规则更新",
    newSig !== cache?.promptSig,
    `${cache?.promptSig?.slice(0, 12)}… → ${newSig?.slice(0, 12)}…`
  );

  // ---- 6. 视觉接口按 sortOrder 选取 + DeepSeek 思考注入 ----
  await fetch(`${STUB}/__reset`);
  const slots = await evaluate(
    send,
    swSession,
    `(async () => {
       const all = await chrome.storage.local.get(null);
       const setKey = ${JSON.stringify(keyInfo.setKey)};
       const cacheKey = Object.keys(all).find((k) => k.endsWith("_manga_cache"));
       if (cacheKey) await chrome.storage.local.remove(cacheKey);
       const setting = JSON.parse(all[setKey]);
       setting.transApis = [
         { apiSlug: "e2e-vision-qwen", apiType: "QwenVL", name: "qwen", url: "${STUB}/qwen/v1/chat/completions", key: "k1", model: "qwen-vl-max-latest", isDisabled: false, sortOrder: 5 },
         { apiSlug: "e2e-vision-ds", apiType: "DeepSeekVL", name: "ds", url: "${STUB}/ds/v1/chat/completions", key: "k2", model: "deepseek-flash", isDisabled: false, sortOrder: 1, thinkingMode: "disabled" },
       ];
       await chrome.storage.local.set({ [setKey]: JSON.stringify(setting) });
       return JSON.parse((await chrome.storage.local.get(setKey))[setKey]).transApis.map((a) => a.apiType + "@" + a.sortOrder);
     })()`
  );
  await send("Page.reload", {}, pageSession);
  await sleep(12000);
  const visionLog3 = await fetchLog();
  const v3 = visionLog3[0];
  check(
    "两个视觉槽写入（更小的 sortOrder 更优先，数组顺序故意相反）",
    slots.join(",") === "QwenVL@5,DeepSeekVL@1",
    JSON.stringify(slots)
  );
  check(
    "请求打到选中的槽（DeepSeek 端点与 Key）",
    v3?.path === "/ds/v1/chat/completions" && v3?.authorization === "Bearer k2",
    `${v3?.path} ${v3?.authorization}`
  );
  check(
    "DeepSeek 槽的思考模式注入 thinking",
    JSON.stringify(v3?.thinking) === '{"type":"disabled"}',
    `${JSON.stringify(v3?.thinking)} reasoning_effort=${JSON.stringify(v3?.reasoningEffort)}`
  );

  // ---- 收尾 ----
  const failed = results.filter((r) => !r.ok);
  log(
    `\n================ 结果：${results.length - failed.length}/${results.length} 通过 ================`
  );
  if (failed.length) {
    failed.forEach((f) => log("  FAIL  " + f.name));
    log("\n页面控制台（最后 20 行）:");
    consoleLines.slice(-20).forEach((l) => log("  " + l.slice(0, 180)));
  } else {
    log("漫画链路全部断言通过。");
  }
  return failed.length;
}

main()
  .then((failed) => {
    killProbe();
    process.exit(failed ? 1 : 0);
  })
  .catch((err) => {
    console.error("FAILED:", err);
    killProbe();
    process.exit(1);
  });
