/**
 * @file load-extension.mjs
 * @description 通过 CDP 的 Extensions 域给一个已经开着远程调试的 Chrome/Chromium 装载未打包扩展，
 * 等价于在 chrome://extensions 点「加载已解压的扩展程序」——但不需要人点原生目录选择框。
 *
 * 这补上了我们此前唯一的「必须人工介入」的环节（ego 里装 kiss-translator fork 卡在原生选目录框）。
 *
 * 前提：目标浏览器必须以 --enable-unsafe-extension-debugging 启动，否则 Extensions 域
 * 会返回 "Method not available"。该 flag 只影响本次启动；装好的扩展会写进 profile，之后照常保留。
 *
 * 用法：
 *   # 给已在 9222 开调试的浏览器装（默认装本仓库的 build/chrome）
 *   node tools/load-extension.mjs --port 9222
 *
 *   # 顺手用 ego lite 起一个带调试口的隔离实例再装（一次性 profile，不碰日常浏览器）
 *   node tools/load-extension.mjs --launch --user-data-dir=/tmp/ego-kiss-manual
 *
 * 依赖：Node.js ≥ 22（内置 WebSocket），无需 npm 依赖。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, ".."); // tools/ 的上一层就是仓库根

const arg = (name, fallback = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const PORT = Number(arg("port", 9333));
const EXT = arg("extension", path.join(REPO, "build/chrome"));
const LAUNCH = flag("launch");
const USER_DATA_DIR = arg("user-data-dir", "/tmp/ego-kiss-load");
const EGO =
  process.env.EGO_BIN || "/Applications/ego lite.app/Contents/MacOS/ego lite";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let nextId = 0;
    ws.onopen = () =>
      resolve({
        send: (method, params = {}) =>
          new Promise((res, rej) => {
            const id = ++nextId;
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params }));
          }),
      });
    ws.onerror = (e) => reject(new Error("ws error " + String(e?.message || e)));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      }
    };
  });
}

async function cdpVersion() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch (err) {
      // 还没起来
    }
    await sleep(500);
  }
  throw new Error(`CDP 端点在 ${PORT} 上没起来`);
}

async function main() {
  if (!existsSync(path.join(EXT, "manifest.json"))) {
    throw new Error(`扩展目录里没有 manifest.json：${EXT}`);
  }

  if (LAUNCH) {
    if (!existsSync(EGO)) throw new Error(`找不到 ${EGO}，请用 --port 连已有浏览器`);
    console.log(`→ 启动一次性实例：${EGO}（profile ${USER_DATA_DIR}）`);
    const child = spawn(
      EGO,
      [
        `--user-data-dir=${USER_DATA_DIR}`,
        `--remote-debugging-port=${PORT}`,
        "--remote-allow-origins=*",
        "--enable-unsafe-extension-debugging",
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ],
      { detached: true, stdio: "ignore" }
    );
    child.unref();
  }

  const version = await cdpVersion();
  console.log(`→ 已连接 ${version.Browser}`);

  const { send } = await connect(version.webSocketDebuggerUrl);

  // 先探一下 Extensions 域在不在：缺 flag 时这里会明确报 "Method not available"
  try {
    const loaded = await send("Extensions.loadUnpacked", { path: EXT });
    console.log(`→ 装载成功，扩展 ID：${loaded.id}`);
    const targets = (await send("Target.getTargets")).targetInfos;
    const sw = targets.find((t) => t.type === "service_worker" && t.url.includes(loaded.id));
    console.log(`→ service worker：${sw ? "已启动 " + sw.url : "未出现（可能还没事件触发）"}`);
    console.log(`→ 目录：${EXT}`);
    process.exit(0);
  } catch (err) {
    console.error("!! 装载失败：", String(err.message || err));
    console.error("   如果报 Method not available：目标浏览器没带 --enable-unsafe-extension-debugging 启动，");
    console.error("   退出浏览器后用该 flag 重启（本脚本的 --launch 会自动带上）。");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
