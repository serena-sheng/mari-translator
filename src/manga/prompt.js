/**
 * @file prompt.js
 * @description 漫画图片翻译使用的视觉提示词，以及视觉模型返回内容的容错解析。
 * 视觉模型（Qwen-VL 等）不保证严格 JSON 输出：可能带 markdown 代码围栏、
 * 前后解释文字，或字段缺失，因此解析层必须容忍这些形态，失败时返回空数组。
 */

import { parseAITerms } from "../libs/utils";

/**
 * 漫画气泡识别的系统提示词。
 * 约定返回 `[{box:[x1,y1,x2,y2], src, dst, vertical}]`：
 * box 为相对图片自身尺寸的像素坐标，vertical 标识原文是否为竖排。
 */
export const MANGA_VISION_PROMPT = `你是漫画翻译引擎。检测图片中所有包含文字的气泡、对话框、旁白框和音效字,将其中文字翻译成简体中文,以严格 JSON 数组返回,不要输出任何其他内容:
[{"box":[x1,y1,x2,y2],"src":"原文","dst":"译文","vertical":true}]
要求:
1. box 为文字区域的像素坐标(相对图片本身尺寸),尽量紧贴文字;
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
 * 从视觉模型的原始回复文本中提取气泡数组。
 *
 * 依次尝试：整段文本直接解析、去掉 markdown 围栏后解析、正则截取首个数组后解析。
 *
 * @param {*} raw 模型返回的原始文本
 * @returns {Array<Object>} 归一化后的气泡数组；无法解析时返回空数组
 */
export const parseVisionResult = (raw) => {
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
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeBubble).filter(Boolean);
      }
    } catch (err) {
      // 该形态解析失败，继续尝试下一种提取方式
    }
  }

  return [];
};
