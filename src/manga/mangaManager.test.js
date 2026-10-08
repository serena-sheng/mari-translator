/**
 * 漫画翻译管理器的行为测试：图片发现 → 视觉接口调用 → 覆盖层渲染 → 缓存 → 开关 → 清理。
 *
 * jsdom 没有 IntersectionObserver / ResizeObserver，也不做真实布局，
 * 因此这里只验证「什么时候发请求、请求什么、往页面里挂了什么」，
 * 像素级对齐需要真实浏览器验证（见 README 的手测步骤）。
 */

jest.mock("../libs/log", () => ({
  kissLog: jest.fn(),
  LogLevel: { INFO: { value: 3 } },
}));
jest.mock("../libs/fetch", () => ({ fetchData: jest.fn() }));
jest.mock("../libs/storage", () => ({
  getMangaCache: jest.fn(),
  setMangaCache: jest.fn(),
  getMangaMode: jest.fn(),
  setMangaMode: jest.fn(),
}));
jest.mock("../apis/trans", () => ({ callVisionApi: jest.fn() }));

const { fetchData } = require("../libs/fetch");
const {
  getMangaCache,
  setMangaCache,
  getMangaMode,
  setMangaMode,
} = require("../libs/storage");
const { callVisionApi } = require("../apis/trans");
const MangaManager = require("./mangaManager").default;

const IMAGE_URL = "https://cdn.example.com/pages/01.jpg";
const DATA_URL = "data:image/jpeg;base64,AAAA";

// 视觉接口现在返回**归一化**坐标。测试里继续按「发送图像素」书写，用这个换算——
// 像素 ÷ 图宽/图高。默认基准是 createImage() 的 800×1200。
const norm = (box, w = 800, h = 1200) => [
  box[0] / w,
  box[1] / h,
  box[2] / w,
  box[3] / h,
];

class MockIntersectionObserver {
  static instances = [];

  constructor(callback) {
    this.callback = callback;
    this.targets = new Set();
    MockIntersectionObserver.instances.push(this);
  }

  observe(target) {
    this.targets.add(target);
  }

  unobserve(target) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
  }

  trigger(target) {
    this.callback([{ target, isIntersecting: true }]);
  }
}

const flush = async () => {
  jest.runOnlyPendingTimers();
  for (let i = 0; i < 24; i++) await Promise.resolve();
  jest.runOnlyPendingTimers();
  for (let i = 0; i < 24; i++) await Promise.resolve();
};

// jsdom 的 getComputedStyle 对未声明的 position 不稳定，这里给父容器显式声明 static，
// 以稳定复现「父容器原本 static → 覆盖层临时改成 relative → stop 时还原」这条路径
const createImage = (url = IMAGE_URL, width = 800, height = 1200) => {
  const wrapper = document.createElement("div");
  wrapper.style.position = "static";
  document.body.appendChild(wrapper);

  const img = document.createElement("img");
  Object.defineProperty(img, "naturalWidth", {
    value: width,
    configurable: true,
  });
  Object.defineProperty(img, "naturalHeight", {
    value: height,
    configurable: true,
  });
  Object.defineProperty(img, "complete", { value: true, configurable: true });
  img.src = url;
  wrapper.appendChild(img);
  return img;
};

const rule = (overrides = {}) => ({
  mangaEnabled: "true",
  ...overrides,
});

const setting = (overrides = {}) => ({
  uiLang: "zh",
  transApis: [
    {
      apiSlug: "vision",
      apiType: "QwenVL",
      url: "https://vision.example.com",
      key: "k",
      model: "m",
    },
    ...(overrides.transApis || []),
  ],
  ...overrides,
});

const createManager = (managerRule, managerSetting) =>
  new MangaManager({
    rule: rule(managerRule),
    setting: setting(managerSetting),
  });

const overlayOf = () => document.querySelector(".kiss-manga-overlay");

describe("MangaManager", () => {
  let originalIntersectionObserver;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    MockIntersectionObserver.instances.length = 0;
    originalIntersectionObserver = global.IntersectionObserver;
    global.IntersectionObserver = MockIntersectionObserver;
    document.body.innerHTML = "";
    getMangaCache.mockResolvedValue(null);
    setMangaCache.mockResolvedValue(undefined);
    getMangaMode.mockResolvedValue(null);
    setMangaMode.mockResolvedValue(undefined);
    fetchData.mockResolvedValue(DATA_URL);
    callVisionApi.mockResolvedValue(
      JSON.stringify([
        {
          box: norm([100, 200, 300, 500]),
          src: "こんにちは",
          dst: "你好",
          vertical: true,
        },
      ])
    );
  });

  afterEach(() => {
    global.IntersectionObserver = originalIntersectionObserver;
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test("规则未开启时不加载缓存、不挂开关、不观察图片", () => {
    const manager = createManager({ mangaEnabled: "false" });
    createImage();
    manager.start();

    expect(getMangaCache).not.toHaveBeenCalled();
    expect(MockIntersectionObserver.instances).toHaveLength(0);
    expect(document.querySelector(".kiss-manga-toggle")).toBeNull();
    manager.stop();
  });

  test.each([
    [
      "接口被禁用",
      { apiSlug: "vision", apiType: "QwenVL", isDisabled: true, key: "k" },
    ],
    ["缺少 API Key", { apiSlug: "vision", apiType: "QwenVL", key: "   " }],
  ])(
    "未配置可用的 QwenVL 接口时不启动（%s），页面无任何注入",
    (_label, api) => {
      const manager = new MangaManager({
        rule: rule(),
        setting: { uiLang: "zh", transApis: [api] },
      });
      manager.start();

      expect(document.querySelector(".kiss-manga-toggle")).toBeNull();
      expect(MockIntersectionObserver.instances).toHaveLength(0);
      manager.stop();
    }
  );

  test("图片进入视口后调用视觉接口并把气泡覆盖到图片上", async () => {
    const manager = createManager();
    const img = createImage();
    manager.start();
    await flush();

    const observer = MockIntersectionObserver.instances[0];
    expect(observer.targets.has(img)).toBe(true);

    observer.trigger(img);
    await flush();

    expect(fetchData).toHaveBeenCalledWith(
      IMAGE_URL,
      { method: "GET" },
      { expect: "base64" }
    );
    expect(callVisionApi).toHaveBeenCalledTimes(1);
    const visionArgs = callVisionApi.mock.calls[0][0];
    expect(visionArgs.imageDataUrl).toBe(DATA_URL);
    expect(visionArgs.prompt).toContain("JSON");

    const overlay = overlayOf();
    expect(overlay).not.toBeNull();
    // 覆盖层紧跟图片之后，并且带上 notranslate 防止被自身翻译器二次翻译
    expect(overlay.previousElementSibling).toBe(img);
    expect(overlay.className).toContain("notranslate");
    expect(img.parentElement.style.position).toBe("relative");

    const bubble = overlay.querySelector(".kiss-manga-bubble");
    expect(bubble.textContent).toBe("你好");
    // 坐标按图片原始尺寸换算成百分比（与图片显示尺寸无关）
    expect(parseFloat(bubble.style.left)).toBeCloseTo(12.5);
    expect(parseFloat(bubble.style.top)).toBeCloseTo(16.6667, 3);
    expect(parseFloat(bubble.style.width)).toBeCloseTo(25);
    expect(parseFloat(bubble.style.minHeight)).toBeCloseTo(25);
    expect(bubble.style.writingMode).toBe("vertical-rl");

    expect(setMangaCache).toHaveBeenCalledTimes(1);
    const cached = setMangaCache.mock.calls[0][0];
    expect(cached[IMAGE_URL].bubbles).toHaveLength(1);

    manager.stop();
  });

  test("同规则下命中缓存不再请求接口，直接渲染覆盖层", async () => {
    const first = createManager();
    first.start();
    await flush();
    const firstImg = createImage();
    MockIntersectionObserver.instances[0].trigger(firstImg);
    await flush();
    expect(callVisionApi).toHaveBeenCalledTimes(1);
    first.stop();

    // 落盘内容里带着提示词签名；同规则再进页面（新的管理器实例）应直接命中缓存
    const written = setMangaCache.mock.calls.at(-1)[0];
    expect(written[IMAGE_URL].promptSig).toBeTruthy();
    jest.clearAllMocks();
    getMangaCache.mockResolvedValue(written);

    const second = createManager();
    second.start();
    await flush();
    const secondImg = createImage();
    MockIntersectionObserver.instances[1].trigger(secondImg);
    await flush();

    expect(callVisionApi).not.toHaveBeenCalled();
    expect(fetchData).not.toHaveBeenCalled();
    expect(overlayOf().textContent).toBe("你好");
    expect(setMangaCache).not.toHaveBeenCalled();

    second.stop();
  });

  test("站点规则变了（术语表/提示词）时旧缓存不再复用，重新请求并覆盖渲染", async () => {
    getMangaCache.mockResolvedValue({
      [IMAGE_URL]: {
        bubbles: [
          { box: [0, 0, 100, 100], src: "", dst: "旧译文", vertical: false },
        ],
        updatedAt: Date.now(),
        promptSig: "stale-signature",
      },
    });

    const manager = createManager({ aiTerms: "中出し,内射" });
    manager.start();
    await flush();

    const img = createImage();
    MockIntersectionObserver.instances[0].trigger(img);
    await flush();

    expect(callVisionApi).toHaveBeenCalledTimes(1);
    expect(overlayOf().textContent).toBe("你好");

    manager.stop();
  });

  test("站点术语表与补充提示词进入视觉提示词", async () => {
    const manager = createManager({
      aiTerms: "中出し,内射\ntransformer,",
      aiPrompt: "语气词里的情绪要体现出来。",
    });
    manager.start();
    await flush();

    const img = createImage();
    MockIntersectionObserver.instances[0].trigger(img);
    await flush();

    const { prompt } = callVisionApi.mock.calls[0][0];
    expect(prompt).toContain("中出し → 内射");
    expect(prompt).toContain("transformer → 保留原文");
    expect(prompt).toContain("本站点补充要求:\n语气词里的情绪要体现出来。");

    manager.stop();
  });

  test("尺寸不足的图片（图标/装饰图）被跳过", async () => {
    const manager = createManager();
    manager.start();
    await flush();

    const img = createImage(IMAGE_URL, 120, 120);
    MockIntersectionObserver.instances[0].trigger(img);
    await flush();

    expect(callVisionApi).not.toHaveBeenCalled();
    expect(overlayOf()).toBeNull();

    manager.stop();
  });

  test("悬浮开关在「嵌字 → 侧栏弹幕 → 原图」之间循环，且不重新请求接口", async () => {
    const manager = createManager();
    const img = createImage();
    manager.start();
    await flush();
    MockIntersectionObserver.instances[0].trigger(img);
    await flush();

    const toggle = document.querySelector(".kiss-manga-toggle");
    const click = () =>
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(toggle).not.toBeNull();
    expect(toggle.textContent).toBe("漫");
    expect(overlayOf()).not.toBeNull();

    // 第二次：切到侧栏弹幕（覆盖层撤掉，换成两侧栏）
    click();
    expect(toggle.textContent).toBe("幕");
    expect(overlayOf()).toBeNull();
    expect(document.querySelectorAll(".kiss-manga-gutter")).toHaveLength(2);
    expect(
      document.querySelectorAll(".kiss-manga-danmaku").length
    ).toBeGreaterThan(0);
    // 弹幕模式要把图片压窄（腾出两侧栏位）
    expect(img.style.width).not.toBe("");

    // 第三次：回到原图（栏位整体隐藏，图片尺寸必须还原）
    click();
    expect(toggle.textContent).toBe("原");
    document.querySelectorAll(".kiss-manga-gutter").forEach((el) => {
      expect(el.style.display).toBe("none");
    });
    expect(img.style.width).toBe("");

    // 第四次：回到嵌字
    click();
    expect(toggle.textContent).toBe("漫");
    expect(overlayOf()).not.toBeNull();

    expect(callVisionApi).toHaveBeenCalledTimes(1);
    manager.stop();
  });

  test("切换显示方式后写入存储，供后续加载的漫画页面沿用", async () => {
    const manager = createManager();
    const img = createImage();
    manager.start();
    await flush();
    MockIntersectionObserver.instances[0].trigger(img);
    await flush();

    const toggle = document.querySelector(".kiss-manga-toggle");
    const click = () =>
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    click(); // 幕
    await flush();
    expect(setMangaMode).toHaveBeenLastCalledWith("danmaku");
    click(); // 原
    await flush();
    expect(setMangaMode).toHaveBeenLastCalledWith("off");
    click(); // 漫
    await flush();
    expect(setMangaMode).toHaveBeenLastCalledWith("overlay");

    manager.stop();
  });

  test("新页面（重新构造管理器）沿用已保存的弹幕显示方式", async () => {
    getMangaMode.mockResolvedValue("danmaku");
    const manager = createManager();
    const img = createImage();
    manager.start();
    await flush();
    MockIntersectionObserver.instances[0].trigger(img);
    await flush();

    // 一上来就是弹幕态：开关显示「幕」，图片直接按栏位渲染，没有嵌字覆盖层
    expect(document.querySelector(".kiss-manga-toggle").textContent).toBe("幕");
    expect(document.querySelectorAll(".kiss-manga-gutter")).toHaveLength(2);
    expect(
      document.querySelectorAll(".kiss-manga-danmaku").length
    ).toBeGreaterThan(0);
    expect(document.querySelectorAll(".kiss-manga-overlay")).toHaveLength(0);

    manager.stop();
  });

  test("缓存里是越界网格时判为坏缓存，重新识别而不是照画", async () => {
    // 先跑一遍正常流程，拿到管理器写进缓存的条目
    const first = createManager();
    const firstImg = createImage();
    first.start();
    await flush();
    MockIntersectionObserver.instances[0].trigger(firstImg);
    await flush();
    const stored = setMangaCache.mock.calls.at(-1)[0];
    first.stop();
    expect(stored[IMAGE_URL]).toBeTruthy();

    // 把该条换成真机上见过的坏结果：1500 宽的坐标、32 个顶格小格
    stored[IMAGE_URL].bubbles = Array.from({ length: 32 }, (_, i) => ({
      box: [i * 100, 0, (i + 1) * 100, 130],
      src: "",
      dst: "坏结果",
      vertical: false,
    }));

    getMangaCache.mockResolvedValue(stored);
    callVisionApi.mockClear();

    const second = createManager();
    const secondImg = createImage();
    second.start();
    await flush();
    MockIntersectionObserver.instances[1].trigger(secondImg);
    await flush();

    expect(callVisionApi).toHaveBeenCalledTimes(1); // 坏缓存被拒，重新请求
    expect(
      document.querySelectorAll(".kiss-manga-bubble").length
    ).toBeGreaterThan(0);
    expect(
      [...document.querySelectorAll(".kiss-manga-bubble")].some(
        (el) => el.textContent === "坏结果"
      )
    ).toBe(false);

    second.stop();
  });

  test("坐标不可信的结果会记成 coordsRejected，之后不再重复请求同一张图", async () => {
    const grid = JSON.stringify(
      Array.from({ length: 32 }, (_, i) => ({
        box: [i * 100, 0, (i + 1) * 100, 130],
        src: "",
        dst: "坏结果",
        vertical: false,
      }))
    );

    callVisionApi.mockResolvedValue(grid);
    const first = createManager();
    const firstImg = createImage();
    first.start();
    await flush();
    MockIntersectionObserver.instances[0].trigger(firstImg);
    await flush();
    first.stop();

    const stored = setMangaCache.mock.calls.at(-1)[0];
    expect(stored[IMAGE_URL].coordsRejected).toBe(true);
    expect(stored[IMAGE_URL].bubbles).toEqual([]);
    expect(document.querySelectorAll(".kiss-manga-bubble")).toHaveLength(0);

    // 换个页面命中同一条缓存：不该再打接口
    getMangaCache.mockResolvedValue(stored);
    callVisionApi.mockClear();
    const second = createManager();
    const secondImg = createImage();
    second.start();
    await flush();
    MockIntersectionObserver.instances[1].trigger(secondImg);
    await flush();

    expect(callVisionApi).not.toHaveBeenCalled();
    expect(document.querySelectorAll(".kiss-manga-bubble")).toHaveLength(0);

    second.stop();
  });

  test("侧栏弹幕：译文中心对齐原文纵向中心（不是从文字顶部对齐）", async () => {
    callVisionApi.mockResolvedValue(
      JSON.stringify([
        {
          box: norm([40, 100, 200, 300]),
          src: "",
          dst: "居中",
          vertical: false,
        },
      ])
    );
    const manager = createManager();
    const img = createImage(); // 800×1200
    // 让渲染高度可测且与原图 1:1，方便验证换算（jsdom 本身不做布局）
    Object.defineProperty(img, "clientHeight", {
      value: 1200,
      configurable: true,
    });
    Object.defineProperty(img, "offsetHeight", {
      value: 1200,
      configurable: true,
    });
    manager.start();
    await flush();
    MockIntersectionObserver.instances[0].trigger(img);
    await flush();

    document
      .querySelector(".kiss-manga-toggle")
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const chip = document.querySelector(".kiss-manga-danmaku");
    const fallbackLineHeight = 14 * 1.6; // jsdom 无布局，用兜底行高
    const top = parseFloat(chip.style.top);
    // 原文纵向中心 =(100+300)/2 = 200；译文的中心应落在 200
    expect(top + fallbackLineHeight / 2).toBeCloseTo(200, 1);

    // 位置标记（细线）也落在同一中心线上
    const marker = document.querySelector(".kiss-manga-marker");
    expect(parseFloat(marker.style.top)).toBeCloseTo(200 - 1, 1);

    manager.stop();
  });

  test("悬浮开关的三种状态有各自的文案与配色，且 dataset.state 同步", async () => {
    const manager = createManager();
    const img = createImage();
    manager.start();
    await flush();
    MockIntersectionObserver.instances[0].trigger(img);
    await flush();

    const toggle = document.querySelector(".kiss-manga-toggle");
    const click = () =>
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const seen = [];

    // 嵌字 → 侧栏弹幕 → 原图 → 嵌字，采集每一态的（文案, 配色）
    for (let i = 0; i < 4; i += 1) {
      seen.push([
        toggle.textContent,
        toggle.dataset.state,
        toggle.style.background,
      ]);
      click();
    }

    expect(seen.map(([label, state]) => [label, state])).toEqual([
      ["漫", "overlay"],
      ["幕", "danmaku"],
      ["原", "off"],
      ["漫", "overlay"],
    ]);
    // 三种状态两两配色都不同，用户一眼能看出当前模式
    const backgrounds = new Set(seen.slice(0, 3).map(([, , bg]) => bg));
    expect(backgrounds.size).toBe(3);

    manager.stop();
  });

  test("侧栏弹幕：按左右分栏、统一字号，并按锚点向下堆积不重叠", async () => {
    callVisionApi.mockResolvedValue(
      JSON.stringify([
        {
          box: norm([40, 100, 200, 300]),
          src: "",
          dst: "左边的台词",
          vertical: false,
        },
        {
          box: norm([60, 140, 220, 320]),
          src: "",
          dst: "左边更靠下的台词",
          vertical: false,
        },
        {
          box: norm([600, 200, 760, 400]),
          src: "",
          dst: "右边的台词",
          vertical: true,
        },
      ])
    );

    const manager = createManager();
    const img = createImage(); // 800×1200，中缝在 x=400
    manager.start();
    await flush();
    MockIntersectionObserver.instances[0].trigger(img);
    await flush();

    document
      .querySelector(".kiss-manga-toggle")
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const gutters = document.querySelectorAll(".kiss-manga-gutter");
    expect(gutters).toHaveLength(2);
    const [leftGutter, rightGutter] = gutters;
    expect(leftGutter.dataset.side).toBe("left");
    expect(rightGutter.dataset.side).toBe("right");

    // 气泡水平中心在中缝左侧的进左栏，右侧的进右栏
    const left = [...leftGutter.querySelectorAll(".kiss-manga-danmaku")];
    const right = [...rightGutter.querySelectorAll(".kiss-manga-danmaku")];
    expect(left.map((el) => el.textContent)).toEqual([
      "左边的台词",
      "左边更靠下的台词",
    ]);
    expect(right.map((el) => el.textContent)).toEqual(["右边的台词"]);

    // 统一横排、统一字号（竖排气泡也只按横排渲染）
    const all = [...document.querySelectorAll(".kiss-manga-danmaku")];
    const sizes = new Set(all.map((el) => el.style.fontSize));
    expect(sizes.size).toBe(1);
    expect(all.every((el) => el.style.writingMode === "")).toBe(true);

    // 同栏内按锚点顺排，第二条被推到第一条下方（jsdom 无布局，用兜底行高推进）
    const firstTop = parseFloat(left[0].style.top);
    const secondTop = parseFloat(left[1].style.top);
    expect(secondTop).toBeGreaterThanOrEqual(firstTop + 6);

    manager.stop();
  });

  test("侧栏弹幕：图片本身比「腾栏后的目标宽度」还窄时，不拉伸图片", async () => {
    const manager = createManager();
    // 容器 800 → 栏宽 clamp(160,150,300)=160 → 目标图宽 480；图片只有 300，不该被拉宽
    const img = createImage(IMAGE_URL, 300, 400);
    Object.defineProperty(img, "offsetWidth", {
      value: 300,
      configurable: true,
    });
    Object.defineProperty(img.parentElement, "clientWidth", {
      value: 800,
      configurable: true,
    });
    manager.start();
    await flush();
    MockIntersectionObserver.instances[0].trigger(img);
    await flush();

    document
      .querySelector(".kiss-manga-toggle")
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".kiss-manga-toggle").textContent).toBe("幕");

    // 栏位照常铺，但图片宽度一个字节都不动（保持原渲染宽度）
    expect(document.querySelectorAll(".kiss-manga-gutter")).toHaveLength(2);
    expect(img.style.width).toBe("");

    manager.stop();
  });

  test("同一 img 节点原地换 src（翻页懒加载）时重新处理，旧覆盖层被替换", async () => {
    const SECOND_URL = "https://cdn.example.com/pages/02.jpg";
    callVisionApi
      .mockResolvedValueOnce(
        JSON.stringify([
          {
            box: norm([0, 0, 100, 100]),
            src: "",
            dst: "第一页",
            vertical: false,
          },
        ])
      )
      .mockResolvedValueOnce(
        JSON.stringify([
          {
            box: norm([0, 0, 100, 100]),
            src: "",
            dst: "第二页",
            vertical: false,
          },
        ])
      );

    const manager = createManager();
    manager.start();
    await flush();

    const observer = MockIntersectionObserver.instances[0];
    const img = createImage();
    observer.trigger(img);
    await flush();
    expect(overlayOf().textContent).toBe("第一页");
    expect(callVisionApi).toHaveBeenCalledTimes(1);

    // 翻页：阅读器复用同一个 img 节点换 src
    img.src = SECOND_URL;
    await flush();
    // 属性变更被去抖处理后重新进入视口判定
    expect(observer.targets.has(img)).toBe(true);

    observer.trigger(img);
    await flush();

    expect(callVisionApi).toHaveBeenCalledTimes(2);
    expect(fetchData).toHaveBeenLastCalledWith(
      SECOND_URL,
      { method: "GET" },
      { expect: "base64" }
    );
    expect(document.querySelectorAll(".kiss-manga-overlay")).toHaveLength(1);
    expect(overlayOf().textContent).toBe("第二页");

    manager.stop();
  });

  test("视觉接口不绑定服务商：DeepSeekVL 槽同样可用于漫画翻译", async () => {
    const manager = new MangaManager({
      rule: rule(),
      setting: {
        uiLang: "zh",
        transApis: [
          {
            apiSlug: "ds",
            apiType: "DeepSeekVL",
            url: "https://api.deepseek.com/chat/completions",
            key: "k",
            model: "deepseek-flash",
          },
          // 纯文本翻译接口不应被当成视觉接口使用
          {
            apiSlug: "ds-text",
            apiType: "DeepSeek",
            url: "https://api.deepseek.com/chat/completions",
            key: "k",
            model: "deepseek-v4-flash",
          },
        ],
      },
    });
    const img = createImage();
    manager.start();
    await flush();

    MockIntersectionObserver.instances[0].trigger(img);
    await flush();

    expect(callVisionApi).toHaveBeenCalledTimes(1);
    expect(callVisionApi.mock.calls[0][0].apiSetting).toMatchObject({
      apiType: "DeepSeekVL",
      model: "deepseek-flash",
    });
    expect(overlayOf()).not.toBeNull();

    manager.stop();
  });

  test("多个视觉接口同时启用时，按设置页排序（sortOrder）取第一个", async () => {
    const manager = new MangaManager({
      rule: rule(),
      setting: {
        uiLang: "zh",
        transApis: [
          {
            apiSlug: "qwen",
            apiType: "QwenVL",
            key: "k",
            sortOrder: 5,
            url: "https://dashscope.example.com/v1/chat/completions",
            model: "qwen-vl-max-latest",
          },
          {
            apiSlug: "ds",
            apiType: "DeepSeekVL",
            key: "k",
            sortOrder: 0,
            url: "https://api.deepseek.com/chat/completions",
            model: "deepseek-flash",
          },
        ],
      },
    });
    manager.start();
    await flush();

    const img = createImage();
    MockIntersectionObserver.instances[0].trigger(img);
    await flush();

    // 数组里 QwenVL 在前，但 sortOrder 更小的是 DeepSeekVL —— 与设置页显示顺序一致
    expect(callVisionApi.mock.calls[0][0].apiSetting.apiSlug).toBe("ds");

    manager.stop();
  });

  test("stop 会移除覆盖层与开关，并恢复父容器定位样式", async () => {
    const manager = createManager();
    const img = createImage();
    manager.start();
    await flush();
    MockIntersectionObserver.instances[0].trigger(img);
    await flush();
    expect(overlayOf()).not.toBeNull();

    manager.stop();

    expect(overlayOf()).toBeNull();
    expect(document.querySelector(".kiss-manga-toggle")).toBeNull();
    // 还原父容器原本的定位样式
    expect(img.parentElement.style.position).toBe("static");
  });

  test("接口失败不抛错、不渲染覆盖层，也不写入缓存", async () => {
    callVisionApi.mockRejectedValue(new Error("boom"));
    const manager = createManager();
    const img = createImage();
    manager.start();
    await flush();
    MockIntersectionObserver.instances[0].trigger(img);
    await flush();

    expect(overlayOf()).toBeNull();
    expect(setMangaCache).not.toHaveBeenCalled();

    manager.stop();
  });

  test("发送前被缩放的图：气泡按「发送尺寸」换算坐标，而不是页面原图尺寸", async () => {
    // 真机复现过的坑：页面原图 2216×3111 会先被缩到 1500 宽再发给视觉模型，
    // 模型返回的 box 属于那张 1500 宽的图。若继续用 naturalWidth 换算百分比，
    // 整块译文会向坐上偏 1500/2216 ≈ 0.68 倍。
    const originalImage = global.Image;
    global.Image = class {
      set src(value) {
        this._src = value;
        Promise.resolve().then(() => this.onload && this.onload());
      }
      get src() {
        return this._src;
      }
    };
    const createElement = document.createElement.bind(document);
    jest.spyOn(document, "createElement").mockImplementation((tag) => {
      const el = createElement(tag);
      if (tag === "canvas") {
        el.getContext = () => ({ drawImage: jest.fn() });
        el.toDataURL = () => "data:image/jpeg;base64,SHRUNK";
      }
      return el;
    });

    callVisionApi.mockResolvedValue(
      JSON.stringify([
        {
          // 归一化按「发送尺寸」换算。2216×3111 超宽 → 发送 1300×1825（MAX_SEND_WIDTH），
          // 归一化基准要用发送尺寸，才能得到 100/200/300/500 这些像素
          box: norm([100, 200, 300, 500], 1300, 1825),
          src: "原文",
          dst: "译文",
          vertical: false,
        },
      ])
    );

    const manager = createManager();
    const img = createImage(IMAGE_URL, 2216, 3111); // 超过 MAX_SEND_WIDTH(1500)
    manager.start();
    await flush();
    MockIntersectionObserver.instances[0].trigger(img);
    await flush();

    // 发给模型的是缩放后的图
    expect(fetchData).toHaveBeenCalled();
    expect(callVisionApi).toHaveBeenCalledWith(
      expect.objectContaining({
        imageDataUrl: "data:image/jpeg;base64,SHRUNK",
      })
    );

    // 气泡坐标 ÷ 1300（发送宽度），而不是 ÷ 2216（原图宽度）
    const bubble = overlayOf().querySelector(".kiss-manga-bubble");
    expect(bubble.style.left).toBe("7.6923%"); // 100 / 1300
    expect(bubble.style.width).toBe("15.3846%"); // (300-100) / 1300

    manager.stop();
    global.Image = originalImage;
  });
});
