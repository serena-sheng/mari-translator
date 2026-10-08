import { MANGA_VISION_PROMPT, parseVisionResult } from "./prompt";

test("prompt requires a JSON-only answer and vertical flag", () => {
  expect(MANGA_VISION_PROMPT).toContain('"vertical"');
  expect(MANGA_VISION_PROMPT).toContain("只输出 JSON");
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
