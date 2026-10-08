# 漫画翻译 E2E（无需真实 API Key）

验证本 fork 的漫画翻译链路：扩展装载 → 规则命中 → 悬浮开关 → 图片发现 → 取图转 dataURL →
视觉请求（含站点术语表/`aiPrompt`/思考参数）→ 覆盖层渲染 → 缓存与缓存失效。

视觉接口打到本地桩服务（`server.mjs`），因此**不需要 Qwen/DeepSeek 的 key**，也不产生任何真实费用。

## 组成

| 文件 | 作用 |
|---|---|
| `server.mjs` | 桩服务：fixture 页面 + 一张 900×1300 的图 + OpenAI 兼容的 `chat/completions`（固定返回两个气泡），并把收到的请求记录在 `/__log` |
| `drive.mjs` | 自己拉一个一次性 ego lite 实例（独立 `--user-data-dir` + `--load-extension`）用裸 CDP 驱动。零 npm 依赖，适合无人值守/CI；不碰日常浏览器 |
| `drive-ego.mjs` | 连到指定 ego 服务，用 ego 自己的 TaskSpace / page API 驱动。测试过程在 ego 窗口里可见，并会截图到 `build/manga-e2e-ego.png` |

两者断言同一批行为，都会在失败时以非 0 退出码结束。

## 顺便：给任意开着调试口的浏览器装扩展（不需要点原生目录框）

```sh
node tools/load-extension.mjs --launch            # 自己起一个带调试口的隔离实例再装
node tools/load-extension.mjs --port 9222         # 装进已在 9222 开调试的浏览器
```

前提是目标浏览器以 `--enable-unsafe-extension-debugging` 启动（缺这个 flag 时 Extensions 域会返回
`Method not available`，脚本会把这个原因打出来）。装好的扩展会写进 profile，之后照常保留。

## 前置

```sh
pnpm build:chrome        # 保证 build/chrome 是最新的
node tools/manga-e2e/server.mjs &     # 桩服务，默认 127.0.0.1:8790
```

- `drive.mjs` 需要 macOS 上装有 ego lite（Chromium 内核）与 Node.js ≥ 22（用到内置 WebSocket）。
- `drive-ego.mjs` 还需要一个**带本扩展**的 ego 服务在跑：

```sh
"/Applications/ego lite.app/Contents/MacOS/ego lite" \
  --user-data-dir=/tmp/ego-kiss-space \
  --load-extension="$PWD/build/chrome" \
  --ego-server-name=kiss-e2e
```

  注意两点：

  1. 全新的 `--user-data-dir` 第一次启动会弹首次运行向导，并拒绝 agent 接入。在向导后（或之前）把
     `<user-data-dir>/ego_config.json` 写成 `{"not_first_run": true}`，重启该实例即可。
  2. ego lite 目前只有一个 `Default` profile，Space 用的就是它。因此要给 Space 里的页面注入本扩展，
     必须让这个实例以 `--load-extension=<repo>/build/chrome` 启动（`--load-extension` 只在启动时生效，
     但会写进 profile，之后不带参数启动也仍然加载）。

## 运行

```sh
node tools/manga-e2e/drive.mjs                                  # 裸 CDP，一次性实例
ego-browser --ego-server-name=kiss-e2e nodejs < tools/manga-e2e/drive-ego.mjs
```

`drive-ego.mjs` 的完整日志同时写到 `build/manga-e2e-ego.log`（ego 的 nodejs 运行时对长任务的
stdout 不可靠），所以失败时先看那个文件。

## 断言的坑（改这个 harness 前先读）

- **storage 里存的是 JSON 字符串**：`getObj = JSON.parse(rawGet(key))`。直接写 JS 对象内容脚本读不到，
  会落 `parse json in storage err`。写的时候要 `JSON.stringify`。
- **扩展自己的设置页会回写 storage**：扩展安装后会自己打开一次 `options.html`，它拿的是“加载时”的
  内存快照，回写时会覆盖外部写入。要么先关掉所有扩展页面再写，要么从 background service worker 写。
- **ego 的 profile 是持久的**：不清 `*_manga_cache` 的话，换场景复用同一张图会命中上一轮缓存，
  观察不到新的视觉请求（`drive-ego.mjs` 每个场景前都会清缓存）。
- **注入元素是异步出现的**：`kiss-translator-fab`、`.kiss-manga-overlay` 要等 `TranslatorManager`
  读完 storage 才创建，必须轮询等待，不能 `goto` 完立刻断言。
