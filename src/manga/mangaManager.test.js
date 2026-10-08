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
}));
jest.mock("../apis/trans", () => ({ callVisionApi: jest.fn() }));

const { fetchData } = require("../libs/fetch");
const { getMangaCache, setMangaCache } = require("../libs/storage");
const { callVisionApi } = require("../apis/trans");
const MangaManager = require("./mangaManager").default;

const IMAGE_URL = "https://cdn.example.com/pages/01.jpg";
const DATA_URL = "data:image/jpeg;base64,AAAA";

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
    fetchData.mockResolvedValue(DATA_URL);
    callVisionApi.mockResolvedValue(
      JSON.stringify([
        {
          box: [100, 200, 300, 500],
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
    ["接口被禁用", { apiType: "QwenVL", isDisabled: true, key: "k" }],
    ["缺少 API Key", { apiType: "QwenVL", key: "   " }],
  ])("未配置可用的 QwenVL 接口时不启动（%s），页面无任何注入", (_label, api) => {
    const manager = new MangaManager({
      rule: rule(),
      setting: { uiLang: "zh", transApis: [api] },
    });
    manager.start();

    expect(document.querySelector(".kiss-manga-toggle")).toBeNull();
    expect(MockIntersectionObserver.instances).toHaveLength(0);
    manager.stop();
  });

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

  test("命中缓存不再请求接口，直接渲染覆盖层", async () => {
    getMangaCache.mockResolvedValue({
      [IMAGE_URL]: {
        bubbles: [
          { box: [0, 0, 100, 100], src: "", dst: "缓存译文", vertical: false },
        ],
        updatedAt: Date.now(),
      },
    });

    const manager = createManager();
    manager.start();
    await flush();

    const img = createImage();
    MockIntersectionObserver.instances[0].trigger(img);
    await flush();

    expect(callVisionApi).not.toHaveBeenCalled();
    expect(fetchData).not.toHaveBeenCalled();
    expect(overlayOf().textContent).toBe("缓存译文");

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

  test("悬浮开关只切换显隐，不重新请求接口", async () => {
    const manager = createManager();
    const img = createImage();
    manager.start();
    await flush();
    MockIntersectionObserver.instances[0].trigger(img);
    await flush();

    const toggle = document.querySelector(".kiss-manga-toggle");
    expect(toggle).not.toBeNull();
    expect(toggle.textContent).toBe("漫");

    toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(overlayOf().style.display).toBe("none");
    expect(toggle.textContent).toBe("原");

    toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(overlayOf().style.display).toBe("");
    expect(toggle.textContent).toBe("漫");
    expect(callVisionApi).toHaveBeenCalledTimes(1);

    manager.stop();
  });

  test("同一 img 节点原地换 src（翻页懒加载）时重新处理，旧覆盖层被替换", async () => {
    const SECOND_URL = "https://cdn.example.com/pages/02.jpg";
    callVisionApi
      .mockResolvedValueOnce(
        JSON.stringify([{ box: [0, 0, 100, 100], src: "", dst: "第一页", vertical: false }])
      )
      .mockResolvedValueOnce(
        JSON.stringify([{ box: [0, 0, 100, 100], src: "", dst: "第二页", vertical: false }])
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
});
