import {
  MANGA_VISION_PROMPT,
  buildMangaVisionPrompt,
  parseVisionResult,
} from "./prompt";

test("prompt requires a JSON-only answer and vertical flag", () => {
  expect(MANGA_VISION_PROMPT).toContain('"vertical"');
  expect(MANGA_VISION_PROMPT).toContain("只输出 JSON");
});

test("site rule without glossary or instruction keeps the base prompt untouched", () => {
  expect(buildMangaVisionPrompt()).toBe(MANGA_VISION_PROMPT);
  expect(buildMangaVisionPrompt({ aiPrompt: "   ", aiTerms: "" })).toBe(
    MANGA_VISION_PROMPT
  );
});

test("site glossary and instruction are appended, and the JSON contract is restated", () => {
  const prompt = buildMangaVisionPrompt({
    aiTerms: "attention,注意力机制\ntransformer,\nquantization,",
    aiPrompt: "语气词里的情绪要体现出来。",
  });

  expect(prompt.startsWith(MANGA_VISION_PROMPT)).toBe(true);
  expect(prompt).toContain("术语表(优先使用下列译法,未列出的按语境直译):");
  expect(prompt).toContain("attention → 注意力机制");
  // 无译文的条目 = 保留原文
  expect(prompt).toContain("transformer → 保留原文");
  expect(prompt).toContain("quantization → 保留原文");
  expect(prompt).toContain("本站点补充要求:\n语气词里的情绪要体现出来。");
  expect(prompt.trimEnd().endsWith("仍然只输出 JSON 数组。")).toBe(true);
});

test("only the instruction or only the glossary still produces a usable prompt", () => {
  const withTermsOnly = buildMangaVisionPrompt({ aiTerms: "a,b" });
  expect(withTermsOnly).toContain("a → b");
  expect(withTermsOnly).not.toContain("本站点补充要求");

  const withPromptOnly = buildMangaVisionPrompt({ aiPrompt: "只翻译对白" });
  expect(withPromptOnly).toContain("本站点补充要求:\n只翻译对白");
  expect(withPromptOnly).not.toContain("术语表");
});

test("parses a plain JSON array", () => {
  const raw = JSON.stringify([
    { box: [10, 20, 100, 200], src: "おはよう", dst: "早上好", vertical: true },
  ]);

  expect(parseVisionResult(raw)).toEqual([
    { box: [10, 20, 100, 200], src: "おはよう", dst: "早上好", vertical: true },
  ]);
});

test("parses responses wrapped in markdown fences and prose", () => {
  const raw = [
    "好的，识别结果如下：",
    "```json",
    '[{"box":[1,2,3,4],"src":"a","dst":"甲","vertical":false}]',
    "```",
    "以上。",
  ].join("\n");

  expect(parseVisionResult(raw)).toEqual([
    { box: [1, 2, 3, 4], src: "a", dst: "甲", vertical: false },
  ]);
});

test("normalizes reversed coordinates and numeric strings", () => {
  const raw = '[{"box":["100","200","10","20"],"dst":"乙"}]';

  expect(parseVisionResult(raw)).toEqual([
    { box: [10, 20, 100, 200], src: "", dst: "乙", vertical: false },
  ]);
});

test("drops entries without a usable box or translation", () => {
  const raw = JSON.stringify([
    { box: [1, 2, 3], dst: "缺一维" },
    { box: [1, 2, 3, 4] },
    { box: [1, 2, 3, 4], dst: "   " },
    { box: ["a", 2, 3, 4], dst: "非数字" },
    { box: [1, 2, 3, 4], dst: "保留" },
  ]);

  expect(parseVisionResult(raw)).toEqual([
    { box: [1, 2, 3, 4], src: "", dst: "保留", vertical: false },
  ]);
});

test("returns an empty list for unusable model output", () => {
  expect(parseVisionResult("")).toEqual([]);
  expect(parseVisionResult(null)).toEqual([]);
  expect(parseVisionResult("抱歉，我无法处理这张图片。")).toEqual([]);
  expect(parseVisionResult('{"box":[1,2,3,4],"dst":"不是数组"}')).toEqual([]);
  expect(parseVisionResult('[{"box":[1,2,3,4],"dst":"截断"')).toEqual([]);
});

test("keeps an empty array as an explicit no-text result", () => {
  expect(parseVisionResult("[]")).toEqual([]);
});

test("带发送图尺寸时，归一化坐标换算成像素，完全越界的丢弃、轻微溢出的夹回图内", () => {
  const raw = JSON.stringify([
    { box: [0.01, 0.01, 0.1, 0.2], dst: "正常", vertical: false },
    { box: [-0.5, -0.5, -0.4, -0.4], dst: "完全在图外", vertical: false },
    { box: [0.99, 0.02, 1.05, 0.13], dst: "右侧轻微溢出", vertical: false },
  ]);

  const out = parseVisionResult(raw, { width: 1500, height: 1978 });
  expect(out.map((b) => b.dst)).toEqual(["正常", "右侧轻微溢出"]);
  // 0.01×1500 / 0.1×1500 —— 归一化换算成像素
  expect(out[0].box[0]).toBeCloseTo(15, 5);
  expect(out[0].box[2]).toBeCloseTo(150, 5);
  // 1.05×1500=1575 超过图宽，夹回 1500
  expect(out[1].box[2]).toBe(1500);
});

test("模型把整页报成规则网格（归一化远超 1）时整条结果判为无效", () => {
  // 真机复现：模型把整页当成 32 个等宽格子（归一化 x 到 3.2），不是文字框
  const raw = JSON.stringify(
    Array.from({ length: 32 }, (_, i) => ({
      box: [i / 10, 0, (i + 1) / 10, 0.05],
      dst: "越界",
      vertical: false,
    }))
  );
  expect(parseVisionResult(raw).length).toBe(32); // 不带尺寸时原样返回
  expect(parseVisionResult(raw, { width: 1500, height: 1978 })).toEqual([]);
});

test("少数越界、多数正常时保留有效条目", () => {
  const raw = JSON.stringify([
    { box: [0.01, 0.01, 0.1, 0.2], dst: "A", vertical: false },
    { box: [0.2, 0.03, 0.3, 0.23], dst: "B", vertical: false },
    { box: [0.3, 0.04, 0.4, 0.24], dst: "C", vertical: false },
    { box: [9, 9, 9.1, 9.1], dst: "越界", vertical: false },
  ]);
  const out = parseVisionResult(raw, { width: 1500, height: 1978 });
  expect(out.map((b) => b.dst)).toEqual(["A", "B", "C"]);
});
