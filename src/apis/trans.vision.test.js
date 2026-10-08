/**
 * 漫画翻译链路使用的单图视觉请求构造测试：
 * 断言请求体是标准 OpenAI 兼容的 image_url 结构（Qwen-VL / DeepSeek 视觉均适用）。
 */

jest.mock("query-string", () => ({
  stringify: (obj) => new URLSearchParams(obj).toString(),
}));

jest.mock("../libs/fetch", () => ({
  fetchData: jest.fn(),
  fetchStream: jest.fn(),
}));

jest.mock("../libs/log", () => ({
  kissLog: jest.fn(),
  LogLevel: { INFO: { value: 3 } },
}));

jest.mock("../libs/docInfo", () => ({
  getDocInfo: () => ({ title: "", description: "", summary: "" }),
}));

jest.mock("../libs/stream", () => ({
  parseStreamingSegments: jest.fn(),
  createStreamingJsonParser: jest.fn(),
  createStreamingSubtitleParser: jest.fn(),
  createRealtimeStreamParser: jest.fn(),
  detectStreamFormat: jest.fn(),
  getStreamDelta: jest.fn(),
}));

import { fetchData } from "../libs/fetch";
import {
  DEFAULT_API_LIST,
  OPT_TRANS_DEEPSEEKVL,
  OPT_TRANS_QWENVL,
} from "../config";
import { callVisionApi } from "./trans";

const IMAGE = "data:image/jpeg;base64,AAAA";
const PROMPT = "只输出 JSON";

const apiOf = (apiType) => ({
  ...DEFAULT_API_LIST.find((api) => api.apiType === apiType),
  apiSlug: "vision",
  key: "K",
});

beforeEach(() => {
  jest.clearAllMocks();
  fetchData.mockResolvedValue({
    choices: [{ message: { content: '[{"box":[1,2,3,4],"dst":"你好"}]' } }],
  });
});

test("Qwen-VL 与 DeepSeek 视觉接口都是 OpenAI 兼容的 image_url 请求", async () => {
  for (const apiType of [OPT_TRANS_QWENVL, OPT_TRANS_DEEPSEEKVL]) {
    fetchData.mockClear();
    const apiSetting = apiOf(apiType);

    const content = await callVisionApi({
      apiSetting,
      imageDataUrl: IMAGE,
      prompt: PROMPT,
    });

    expect(content).toContain("你好");

    const [url, init] = fetchData.mock.calls[0];
    expect(url).toBe(apiSetting.url);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer K");

    const body = JSON.parse(init.body);
    expect(body.model).toBe(apiSetting.model);
    expect(body.messages[0]).toEqual({ role: "system", content: PROMPT });
    // 图片必须放在 user 消息里：DeepSeek 对 system/assistant 带图直接返回 400
    expect(body.messages[1].role).toBe("user");
    expect(body.messages[1].content[0]).toEqual({
      type: "image_url",
      image_url: { url: IMAGE },
    });
    expect(body.max_tokens).toBe(4096);
    expect(body.temperature).toBe(0.1);
  }
});

test("DeepSeek 视觉请求按接口配置注入思考模式，Qwen 侧不注入未知字段", async () => {
  await callVisionApi({
    apiSetting: apiOf(OPT_TRANS_DEEPSEEKVL),
    imageDataUrl: IMAGE,
    prompt: PROMPT,
  });
  const deepseekBody = JSON.parse(fetchData.mock.calls[0][1].body);
  // DeepSeek 的思考模式默认开启；视觉槽默认 disabled，必须真的把字段带上去
  expect(deepseekBody.thinking).toEqual({ type: "disabled" });

  fetchData.mockClear();
  await callVisionApi({
    apiSetting: apiOf(OPT_TRANS_QWENVL),
    imageDataUrl: IMAGE,
    prompt: PROMPT,
  });
  const qwenBody = JSON.parse(fetchData.mock.calls[0][1].body);
  expect(qwenBody.thinking).toBeUndefined();
  expect(qwenBody.enable_thinking).toBeUndefined();
});

test("自定义请求体会合并进视觉请求（可覆盖思考等参数）", async () => {
  await callVisionApi({
    apiSetting: {
      ...apiOf(OPT_TRANS_DEEPSEEKVL),
      customBody: '{"thinking":{"type":"disabled"}}',
    },
    imageDataUrl: IMAGE,
    prompt: PROMPT,
  });

  const body = JSON.parse(fetchData.mock.calls[0][1].body);
  expect(body.thinking).toEqual({ type: "disabled" });
  // 未覆盖的字段保持默认
  expect(body.max_tokens).toBe(4096);
});

test("视觉接口自带 90s 超时，配置了就按配置，缺省时用兜底值", async () => {
  await callVisionApi({
    apiSetting: apiOf(OPT_TRANS_QWENVL),
    imageDataUrl: IMAGE,
    prompt: PROMPT,
  });
  expect(fetchData.mock.calls[0][2]).toEqual({ httpTimeout: 90 });

  fetchData.mockClear();
  await callVisionApi({
    apiSetting: { ...apiOf(OPT_TRANS_QWENVL), httpTimeout: 120 },
    imageDataUrl: IMAGE,
    prompt: PROMPT,
  });
  expect(fetchData.mock.calls[0][2]).toEqual({ httpTimeout: 120 });

  // 外部直接构造的接口配置可能没有该字段，此时回落兜底值
  fetchData.mockClear();
  await callVisionApi({
    apiSetting: { ...apiOf(OPT_TRANS_DEEPSEEKVL), httpTimeout: undefined },
    imageDataUrl: IMAGE,
    prompt: PROMPT,
  });
  expect(fetchData.mock.calls[0][2]).toEqual({ httpTimeout: 90 });
});

test("接口直接返回文本（非 JSON 包装）时原样透出，交给解析层容错", async () => {
  fetchData.mockResolvedValue("[]");
  const content = await callVisionApi({
    apiSetting: apiOf(OPT_TRANS_QWENVL),
    imageDataUrl: IMAGE,
    prompt: PROMPT,
  });
  expect(content).toBe("[]");
});

test("缺少 url 或图片时明确报错，不发请求", async () => {
  await expect(
    callVisionApi({
      apiSetting: { ...apiOf(OPT_TRANS_QWENVL), url: "  " },
      imageDataUrl: IMAGE,
      prompt: PROMPT,
    })
  ).rejects.toThrow("url is empty");
  await expect(
    callVisionApi({
      apiSetting: apiOf(OPT_TRANS_QWENVL),
      imageDataUrl: "",
      prompt: PROMPT,
    })
  ).rejects.toThrow("image is empty");
  expect(fetchData).not.toHaveBeenCalled();
});
