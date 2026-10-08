/**
 * @file prompt.js
 * @description 漫画图片翻译使用的视觉提示词，以及视觉模型返回内容的容错解析。
 * 视觉模型（Qwen-VL 等）不保证严格 JSON 输出：可能带 markdown 代码围栏、
 * 前后解释文字，或字段缺失，因此解析层必须容忍这些形态，失败时返回空数组。
 */

import { parseAITerms } from "../libs/utils";

// 坐标校验：允许少量溢出（模型偶有越界一两像素），但越界超过 20% 就说明坐标系不对
const BOX_SLACK_RATIO = 0.2;
const MIN_BOX_SIZE = 4; // 夹紧后小于该尺寸的框视为噪声
const MIN_VALID_RATIO = 0.5; // 有效框占比低于此值 → 整条结果不可信

/**
 * 漫画气泡识别的系统提示词。
 * 约定返回 `[{box:[x1,y1,x2,y2], src, dst, vertical}]`：
 * box 为**归一化坐标**（0~1，x/y 分别除以图宽/图高），vertical 标识原文是否为竖排。
 * 归一化而非像素：实测（2026-10-09）deepseek-flash 给归一化值时两个方向都准到 0.01 以内，
 * 给像素值时 y 会被系统性压到 0.7 倍左右（弹幕整体偏上），x 才勉强接近。
 */
export const MANGA_VISION_PROMPT = `你是漫画翻译引擎。检测图片中所有包含文字的气泡、对话框、旁白框和音效字,将其中文字翻译成简体中文,以严格 JSON 数组返回,不要输出任何其他内容:
[{"box":[x1,y1,x2,y2],"src":"原文","dst":"译文","vertical":true}]
要求:
1. box 用归一化坐标:0~1 之间的小数,x 除以图宽、y 除以图高(左上角是 [0,0],右下角是 [1,1]),保留 4 位小数,紧贴文字;
2. vertical:原文为竖排(日语漫画常见)则为 true,横排为 false;
3. 无文字的图返回 [];
4. 译文要求:这是成人向/一般向漫画,忠实翻译所有露骨内容与潜台词;日语省略的主语和语气(央求、抗拒、羞耻、兴奋等)要在中文体现出来;拟声词翻译为中文惯用拟声词;同一格内多个气泡按阅读顺序排列;
5. 只输出 JSON,不要 markdown 代码块标记。`;

const isFiniteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

/**
 * 由站点规则拼装完整的视觉提示词：固定基础指令 + 站点术语表 + 站点补充要求（`aiPrompt`）。
 *
 * 站点两项都没配时直接返回基础指令（与不接站点规则时行为一致）；术语表沿用
 * `parseAITerms` 的格式（`原文,译文`，无译文表示保留原文）。
 *
 * @param {Object} [rule]
 * @param {string} [rule.aiPrompt] 站点级补充要求
 * @param {string} [rule.aiTerms] 站点级术语表
 * @returns {string} 可直接发给视觉模型的系统提示词
 */
export const buildMangaVisionPrompt = ({
  aiPrompt = "",
  aiTerms = "",
} = {}) => {
  const glossary = Object.entries(parseAITerms(aiTerms));
  const extraPrompt = String(aiPrompt || "").trim();
  if (!glossary.length && !extraPrompt) return MANGA_VISION_PROMPT;

  const sections = [MANGA_VISION_PROMPT];

  if (glossary.length) {
    const lines = glossary.map(([term, translation]) =>
      translation ? `${term} → ${translation}` : `${term} → 保留原文`
    );
    sections.push(
      `术语表(优先使用下列译法,未列出的按语境直译):\n${lines.join("\n")}`
    );
  }
  if (extraPrompt) {
    sections.push(`本站点补充要求:\n${extraPrompt}`);
  }
  sections.push("以上补充要求不改变输出格式:仍然只输出 JSON 数组。");

  return sections.join("\n\n");
};

/**
 * 归一化单个气泡数据，剔除坐标或译文非法的条目。
 * @param {*} item 模型返回数组中的一项
 * @returns {Object|null} `{box, src, dst, vertical}` 或 null
 */
const normalizeBubble = (item) => {
  const box = item?.box;
  if (!Array.isArray(box) || box.length !== 4) return null;

  const [x1, y1, x2, y2] = box.map(Number);
  if (![x1, y1, x2, y2].every(isFiniteNumber)) return null;

  const dst = typeof item?.dst === "string" ? item.dst.trim() : "";
  if (!dst) return null;

  return {
    box: [
      Math.min(x1, x2),
      Math.min(y1, y2),
      Math.max(x1, x2),
      Math.max(y1, y2),
    ],
    src: typeof item?.src === "string" ? item.src : "",
    dst,
    vertical: item?.vertical === true,
  };
};

/**
 * 校验并夹紧单个气泡的坐标，落在发送图范围内。
 *
 * 真机上见过视觉模型把整页当成规则网格返回（例如把一张 1500×1978 的图报成
 * x 到 3200、y 只占顶部 130px 的 32 个格子）。这类坐标不是这张图的空间，
 * 拿去渲染只会得到一堆挤在顶部、被堆出几百像素的弹幕，因此越界过多直接丢弃。
 *
 * @param {Object} bubble 已归一化的气泡
 * @param {number} width 发送给模型的图宽
 * @param {number} height 发送给模型的图高
 * @returns {Object|null} 夹紧后的气泡，或 null
 */
const validateBubbleBox = (bubble, width, height) => {
  const [x1, y1, x2, y2] = bubble.box;
  const slackX = width * BOX_SLACK_RATIO;
  const slackY = height * BOX_SLACK_RATIO;
  // 与图幅完全不相交（连容差都够不着）→ 坐标系不对，丢弃
  if (
    x2 < -slackX ||
    y2 < -slackY ||
    x1 > width + slackX ||
    y1 > height + slackY
  ) {
    return null;
  }
  const box = [
    Math.max(0, Math.min(width, x1)),
    Math.max(0, Math.min(height, y1)),
    Math.max(0, Math.min(width, x2)),
    Math.max(0, Math.min(height, y2)),
  ];
  if (box[2] - box[0] < MIN_BOX_SIZE || box[3] - box[1] < MIN_BOX_SIZE) {
    return null;
  }
  return { ...bubble, box };
};

/**
 * 归一化坐标（0~1）→ 发送图像素坐标。
 * @param {Object} bubble 已归一化的气泡
 * @param {number} width 发送图宽
 * @param {number} height 发送图高
 * @returns {Object}
 */
const toPixelBubble = (bubble, width, height) => ({
  ...bubble,
  box: [
    bubble.box[0] * width,
    bubble.box[1] * height,
    bubble.box[2] * width,
    bubble.box[3] * height,
  ],
});

/**
 * 按发送图尺寸校验一组气泡，返回可信的条目。
 *
 * 越界过多的整条结果视为不可信（返回空数组），避免拿去渲染或缓存。
 *
 * @param {Array<Object>} bubbles 气泡（**像素**坐标，parseVisionResult 已换算）
 * @param {{width:number,height:number}} bounds 发送图尺寸
 * @returns {Array<Object>}
 */
export const validateVisionBubbles = (bubbles, { width, height } = {}) => {
  if (!Array.isArray(bubbles)) return [];
  if (!(width > 0) || !(height > 0)) return bubbles;
  const valid = bubbles
    .map((b) => validateBubbleBox(b, width, height))
    .filter(Boolean);
  // 大多数坐标都越界 → 整条结果不可信（坐标系不对），当作失败
  if (bubbles.length && valid.length / bubbles.length < MIN_VALID_RATIO) {
    return [];
  }
  return valid;
};

/**
 * 从视觉模型的原始回复文本中提取气泡数组。
 *
 * 依次尝试：整段文本直接解析、去掉 markdown 围栏后解析、正则截取首个数组后解析。
 *
 * @param {*} raw 模型返回的原始文本
 * @param {{width:number,height:number}} [bounds] 发送图尺寸；给了就把归一化坐标换算成像素并校验
 * @returns {Array<Object>} 气泡数组（带 bounds 时是发送图像素坐标）；无法解析时返回空数组
 */
export const parseVisionResult = (raw, bounds = null) => {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return [];

  const candidates = [text];

  const fenced = text.match(/```[a-zA-Z]*\s*([\s\S]*?)```/);
  if (fenced?.[1]?.trim()) candidates.push(fenced[1].trim());

  const arrayText = text.match(/\[[\s\S]*\]/);
  if (arrayText?.[0]) candidates.push(arrayText[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!Array.isArray(parsed)) continue;
      const bubbles = parsed.map(normalizeBubble).filter(Boolean);
      if (!bounds || !(bounds.width > 0) || !(bounds.height > 0))
        return bubbles;
      // 模型给的是归一化坐标：换算成发送图像素后再校验
      const pixels = bubbles.map((b) =>
        toPixelBubble(b, bounds.width, bounds.height)
      );
      return validateVisionBubbles(pixels, bounds);
    } catch (err) {
      // 该形态解析失败，继续尝试下一种提取方式
    }
  }

  return [];
};
