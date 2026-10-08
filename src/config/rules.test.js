import { BUILTIN_RULES, DEFAULT_RULE, GLOBLA_RULE } from "./rules";
import { parseAITerms } from "../libs/utils";

const findRule = (pattern) =>
  BUILTIN_RULES.find((rule) => rule.pattern === pattern);

test("DEFAULT_RULE 与 GLOBLA_RULE 都声明了站点级 aiPrompt 与漫画开关", () => {
  expect(DEFAULT_RULE).toMatchObject({ aiPrompt: "", mangaEnabled: "false" });
  expect(GLOBLA_RULE).toMatchObject({ aiPrompt: "", mangaEnabled: "false" });
});

// parseAITerms 每行只取英文逗号分隔的前两段：译文里再出现英文逗号会被静默截断，
// 这组预置术语表是给人直接使用/照抄的，必须在写入时就保证可完整解析。
test("内置规则的 aiTerms 逐行可完整解析，不会因英文逗号被截断", () => {
  const rulesWithTerms = BUILTIN_RULES.filter((rule) => rule.aiTerms);
  expect(rulesWithTerms.length).toBeGreaterThanOrEqual(3);

  rulesWithTerms.forEach((rule) => {
    const parsed = parseAITerms(rule.aiTerms);

    rule.aiTerms
      .split("\n")
      .filter((line) => line.trim())
      .forEach((line) => {
        const commaIndex = line.indexOf(",");
        const term = line
          .slice(0, commaIndex < 0 ? undefined : commaIndex)
          .trim();
        const rest = commaIndex < 0 ? "" : line.slice(commaIndex + 1).trim();

        expect(term).not.toBe("");
        expect(rest).not.toContain(",");
        expect(parsed[term]).toBe(rest);
      });
  });
});

test("内置规则的 aiPrompt 都是可直接使用的系统提示词", () => {
  const rulesWithPrompt = BUILTIN_RULES.filter((rule) => rule.aiPrompt);
  expect(rulesWithPrompt.length).toBeGreaterThanOrEqual(3);

  rulesWithPrompt.forEach((rule) => {
    expect(rule.aiPrompt.trim()).toBe(rule.aiPrompt);
    expect(rule.aiPrompt.length).toBeGreaterThan(20);
  });
});
