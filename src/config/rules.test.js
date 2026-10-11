import { BUILTIN_RULES, DEFAULT_RULE, GLOBLA_RULE } from "./rules";

test("DEFAULT_RULE 与 GLOBLA_RULE 都声明了站点级 aiPrompt 与漫画开关", () => {
  expect(DEFAULT_RULE).toMatchObject({ aiPrompt: "", mangaEnabled: "false" });
  expect(GLOBLA_RULE).toMatchObject({ aiPrompt: "", mangaEnabled: "false" });
});

test("不含内置站点预设：预设规则表为空", () => {
  expect(BUILTIN_RULES).toEqual([]);
});
