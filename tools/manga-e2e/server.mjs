/**
 * @file server.mjs
 * @description 漫画翻译 E2E 的桩服务：提供 fixture 页面、一张大图，以及一个 OpenAI 兼容的视觉接口。
 *
 * 存在的意义：让漫画链路（图片发现 → 取图转 dataURL → 视觉请求 → 覆盖层渲染 → 缓存）
 * 可以在**没有真实 API key** 的情况下被自动断言，因为请求被本桩服务接住并记录下来。
 *
 * 用法：node tools/manga-e2e/server.mjs（默认 127.0.0.1:8790）
 * 端点：
 *   GET  /fixture                  测试页面（含一张 900x1300 的图）
 *   GET  /page.svg                 被翻译的漫画图
 *   POST /v1/chat/completions      固定返回两个气泡的视觉接口（路径前缀任意，如 /ds/v1/...）
 *   GET  /__log                    已记录的请求（断言用）
 *   GET  /__reset                  清空记录
 */
import http from "node:http";

const PORT = Number(process.env.PORT || 8790);

/** 桩返回的气泡：一个竖排、一个横排，覆盖两种渲染分支 */
const BUBBLES = [
  {
    box: [100, 120, 420, 380],
    src: "こんにちは、ご主人様",
    dst: "你好，主人",
    vertical: true,
  },
  {
    box: [480, 700, 800, 900],
    src: "やめて！",
    dst: "住手！",
    vertical: false,
  },
];

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1300">
<rect width="900" height="1300" fill="#f2f2f2"/>
<ellipse cx="260" cy="250" rx="160" ry="130" fill="#fff" stroke="#333" stroke-width="4"/>
<rect x="480" y="700" width="320" height="200" fill="#fff" stroke="#333" stroke-width="4"/>
<circle cx="700" cy="1150" r="90" fill="#ddd"/>
</svg>`;

const FIXTURE = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>manga e2e fixture</title></head>
<body>
<h1>fixture</h1>
<p id="plain">The Fed raised rates again; the yield curve stayed inverted.</p>
<img id="big" src="/page.svg" width="450" height="650" alt="manga page">
</body></html>`;

const requests = [];

const json = (res, obj, code = 200) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === "/__log") return json(res, requests);

  if (url.pathname === "/__reset") {
    requests.length = 0;
    return json(res, { ok: true });
  }

  if (url.pathname === "/fixture") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(FIXTURE);
  }

  if (url.pathname === "/page.svg") {
    res.writeHead(200, {
      "content-type": "image/svg+xml",
      "cache-control": "no-store",
    });
    return res.end(SVG);
  }

  if (url.pathname.endsWith("/v1/chat/completions")) {
    let body = "";
    for await (const chunk of req) body += chunk;
    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      // 请求体不是 JSON：记录下来，由断言侧报错
    }

    const userContent = parsed?.messages?.[1]?.content;
    const parts = Array.isArray(userContent) ? userContent : [];
    const imageUrl = String(parts[0]?.image_url?.url || "");
    requests.push({
      at: new Date().toISOString(),
      path: url.pathname,
      authorization: req.headers.authorization || "",
      model: parsed?.model,
      systemPrompt: parsed?.messages?.[0]?.content || "",
      userPartTypes: parts.map((p) => p.type),
      imageUrlPrefix: imageUrl.slice(0, 40),
      imageUrlBytes: imageUrl.length,
      // 思考参数是视觉链路的一部分（DeepSeek 槽会注入 thinking），必须能被断言
      thinking: parsed?.thinking,
      reasoningEffort: parsed?.reasoning_effort,
      topLevelKeys: Object.keys(parsed || {}),
    });

    return json(res, {
      choices: [{ message: { content: JSON.stringify(BUBBLES) } }],
    });
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`manga-e2e stub listening on http://127.0.0.1:${PORT}`);
});
