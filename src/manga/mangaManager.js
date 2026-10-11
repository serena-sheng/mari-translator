/**
 * @file mangaManager.js
 * @description 漫画图片翻译管理器：发现页面中尺寸足够大的漫画图片，取图转 base64，
 * 调用视觉模型（OpenAI 兼容协议，默认 Qwen-VL）拿回气泡坐标与译文，交给覆盖层渲染，
 * 并按图片 URL 缓存结果避免翻页/回滚时重复请求。
 *
 * 生命周期与 FAB / 输入框翻译等子模块一致：随 TranslatorManager 创建，随 restart 销毁重建。
 */

import { API_SPE_TYPES, newI18n } from "../config";
import { getEnabledApis } from "../libs/apiSelection";
import {
  getMangaCache,
  setMangaCache,
  getMangaMode,
  setMangaMode,
} from "../libs/storage";
import { fetchData } from "../libs/fetch";
import { getCacheDigest } from "../libs/cacheDigest";
import { kissLog, logger } from "../libs/log";
import { callVisionApi } from "../apis/trans";
import {
  MANGA_VISION_PROMPT,
  buildMangaVisionPrompt,
  parseVisionResult,
  validateVisionBubbles,
} from "./prompt";
import {
  MODE_MANGA_DANMAKU,
  MODE_MANGA_OVERLAY,
  TOGGLE_STATE_OFF,
  attachMangaLayer,
  mountMangaToggle,
} from "./overlay";

const MIN_IMAGE_EDGE = 300; // 小于该边长的图片视为图标/装饰图，跳过
// 发送前压缩到的最大宽度：DeepSeek 视觉侧内部会把长边缩到约 1300，再送大只是白烧
// 上传带宽与 base64 编解码（token 按模型缩放后计），1300 已等于其内部上限
const MAX_SEND_WIDTH = 1300;
const JPEG_QUALITY = 0.85;
const MAX_CACHE_ENTRIES = 200; // 缓存条数上限，超出按更新时间淘汰最旧
const MAX_CONCURRENT = 2; // 同时进行的视觉请求数量
// 视口预取范围（只放纵向，横向不预取）：给用户正在看的内容留一点提前量，
// 又不至于为翻不到的图白花视觉接口的钱
const ROOT_MARGIN = "300px 0px";
const CACHE_SAVE_DELAY = 1000; // 缓存落盘防抖
const IMAGE_LOAD_TIMEOUT = 15000; // 等待图片解码的兜底超时
const MANGA_CACHE_SALT = "KISS-Translator-MANGA"; // 提示词签名用的盐

/**
 * 发送给视觉模型的图片尺寸：与 #shrinkDataUrl 的缩放规则保持一致。
 * 视觉模型返回的 box 坐标属于**这张图**的像素空间（不是页面原图的 naturalWidth），
 * 覆盖层换算百分比必须用这里的尺寸，否则译文整块偏位。
 */
const sentImageSize = (naturalWidth, naturalHeight) =>
  naturalWidth > MAX_SEND_WIDTH
    ? {
        width: MAX_SEND_WIDTH,
        height: Math.round((naturalHeight / naturalWidth) * MAX_SEND_WIDTH),
      }
    : { width: naturalWidth, height: naturalHeight };

export default class MangaManager {
  #rule = {};
  #setting = {};
  #apiSettings = []; // 按优先级排序的视觉接口列表：第一个是主接口，失败依次保底
  #io = null;
  #mo = null;
  #resizeObserver = null;
  #toggle = null;
  #states = new Map(); // img -> { url, layer }
  #pendingRoots = new Set(); // 待扫描的新增节点 / 换了 src 的图片
  #pendingSync = new Set(); // 等下一帧统一 sync 的图（ResizeObserver 去抖）
  #syncRaf = null;
  #cache = {};
  #cacheReady = Promise.resolve();
  #prompt = MANGA_VISION_PROMPT; // 站点术语表/提示词拼装后的视觉提示词
  #promptSig = ""; // 提示词签名：站点规则变化时让旧缓存失效
  #cacheSaveTimer = null;
  #queue = [];
  #activeCount = 0;
  #mutationsTimer = null;
  #visible = true;
  // 显示方式：overlay（嵌字）/ danmaku（侧栏弹幕）
  #mode = MODE_MANGA_OVERLAY;
  #started = false;
  #destroyed = false;

  constructor({ rule = {}, setting = {} } = {}) {
    this.#rule = rule || {};
    this.#setting = setting || {};
  }

  /** 规则未开启漫画翻译、或未配置可用的视觉接口时，直接不启动（页面无任何注入） */
  start() {
    if (this.#started || this.#destroyed) return;
    if (this.#rule?.mangaEnabled !== "true") {
      // 悬浮开关不出现的头号原因就是这条：站点规则没有显式开漫画（默认继承全局 "false"）。
      // 排查时把日志等级调到 DEBUG 看这行，再去设置页确认「全局规则 / 该站点规则」的
      // 「漫画图片翻译模式」是否为「启用」。
      logger.debug(
        "manga: rule does not enable manga mode, skip",
        this.#rule?.pattern,
        this.#rule?.mangaEnabled
      );
      return;
    }

    const apiSettings = this.#resolveVisionApiSettings();
    if (apiSettings.length === 0) {
      kissLog("manga: no enabled vision api with api key configured, skip");
      return;
    }

    this.#started = true;
    this.#apiSettings = apiSettings;
    // 站点规则里的术语表与补充提示词直接进视觉提示词（漫画与整页翻译共用同一套规则配置）
    this.#prompt = buildMangaVisionPrompt({
      aiPrompt: this.#rule?.aiPrompt,
      aiTerms: this.#rule?.aiTerms,
    });
    this.#cacheReady = this.#initCache();

    const i18n = newI18n(this.#setting.uiLang || "zh");
    this.#toggle = mountMangaToggle({
      onClick: () => this.toggle(),
      title: i18n("manga_enabled"),
    });
    this.#toggle.setState(this.#toggleState());
    // 恢复用户上次选的显示方式（换页/翻页后新页面沿用弹幕模式）
    this.#restoreMode();

    this.#io = new IntersectionObserver(this.#handleIntersect, {
      rootMargin: ROOT_MARGIN,
    });
    this.#mo = new MutationObserver(this.#handleMutations);
    this.#mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      // 漫画阅读器翻页常用「原地替换 img.src」的懒加载写法，必须监听属性变更
      attributes: true,
      attributeFilter: ["src"],
    });
    this.#ensureResizeObserver();

    this.#observeImages(document);
  }

  /** 释放观察器、覆盖层与悬浮开关，并恢复被改写的父容器定位样式 */
  stop() {
    if (!this.#started) return;
    this.#started = false;
    this.#destroyed = true;

    this.#io?.disconnect();
    this.#mo?.disconnect();
    this.#resizeObserver?.disconnect();
    this.#io = null;
    this.#mo = null;
    this.#resizeObserver = null;
    this.#queue = [];
    this.#activeCount = 0;
    this.#pendingRoots.clear();

    this.#states.forEach((state) => state.layer?.destroy?.());
    this.#states.clear();

    this.#toggle?.destroy();
    this.#toggle = null;

    if (this.#mutationsTimer) {
      clearTimeout(this.#mutationsTimer);
      this.#mutationsTimer = null;
    }
    if (this.#syncRaf != null) {
      cancelAnimationFrame(this.#syncRaf);
      this.#syncRaf = null;
    }
    this.#pendingSync.clear();
    this.#flushCache();
  }

  /** 悬浮开关当前状态：三种显示方式之一，或关闭 */
  #toggleState() {
    if (!this.#visible) return TOGGLE_STATE_OFF;
    return this.#mode;
  }

  /**
   * 恢复上次保存的显示方式。换页/翻页后重新加载的漫画页面沿用同一方式，
   * 不会又退回「嵌字」。已在场的译文层同步切过去（不重新请求接口）。
   */
  async #restoreMode() {
    let saved = null;
    try {
      saved = await getMangaMode();
    } catch (err) {
      return;
    }
    if (this.#destroyed || !saved) return;
    if (
      saved !== MODE_MANGA_OVERLAY &&
      saved !== MODE_MANGA_DANMAKU &&
      saved !== TOGGLE_STATE_OFF
    ) {
      return;
    }

    this.#visible = saved !== TOGGLE_STATE_OFF;
    // 关闭态回到「嵌字」起点，这样下次循环仍是 漫 → 幕 → 原
    this.#mode = saved === TOGGLE_STATE_OFF ? MODE_MANGA_OVERLAY : saved;

    this.#states.forEach((state) => {
      state.layer?.setMode?.(this.#mode);
      state.layer?.setVisible?.(this.#visible);
    });
    this.#toggle?.setState(this.#toggleState());
  }

  /** 记住当前显示方式，供后续加载的漫画页面沿用 */
  #persistMode() {
    Promise.resolve(setMangaMode(this.#toggleState())).catch(() => {});
  }

  /**
   * 循环切换显示方式：嵌字 → 侧栏弹幕 → 原图 → 嵌字。
   * 只改显示方式与显隐，不重新请求接口（译文与坐标都已在手）。
   */
  toggle() {
    if (!this.#visible) {
      this.#visible = true;
      this.#mode = MODE_MANGA_OVERLAY;
    } else if (this.#mode === MODE_MANGA_OVERLAY) {
      this.#mode = MODE_MANGA_DANMAKU;
    } else {
      this.#visible = false;
    }

    this.#states.forEach((state) => {
      state.layer?.setMode?.(this.#mode);
      state.layer?.setVisible?.(this.#visible);
    });
    this.#toggle?.setState(this.#toggleState());
    this.#persistMode();
  }

  #resolveVisionApiSettings() {
    const apis = Array.isArray(this.#setting?.transApis)
      ? this.#setting.transApis
      : [];
    // 视觉接口必须有 Key 才能真正调用；只启用不填 Key 不算可用配置。
    // 顺序与设置页一致（按 sortOrder 再按下标）：第一个是主接口，其余是保底。
    return getEnabledApis(apis).filter(
      (api) => API_SPE_TYPES.vision.has(api?.apiType) && api.key?.trim()
    );
  }

  #handleIntersect = (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      // 只处理首次进入视口：后续懒加载由 #ensureImageReady 内部等待完成
      this.#io?.unobserve(entry.target);
      this.#enqueue(entry.target);
    });
  };

  #handleMutations = (mutations) => {
    // 先累积本次所有变更涉及的节点，再统一去抖处理，避免去抖窗口内的变更被整批丢弃
    mutations.forEach((mutation) => {
      if (mutation.type === "attributes") {
        if (mutation.target?.nodeName === "IMG") {
          this.#pendingRoots.add(mutation.target);
        }
        return;
      }
      mutation.addedNodes.forEach((node) => {
        if (
          node.nodeType === Node.ELEMENT_NODE ||
          node.nodeType === Node.DOCUMENT_FRAGMENT_NODE
        ) {
          this.#pendingRoots.add(node);
        }
      });
    });

    if (this.#mutationsTimer) return;
    this.#mutationsTimer = setTimeout(() => {
      this.#mutationsTimer = null;
      this.#flushPendingRoots();
    }, 200);
  };

  #flushPendingRoots() {
    if (this.#destroyed || this.#pendingRoots.size === 0) return;

    this.#pruneDisconnected();
    const roots = [...this.#pendingRoots];
    this.#pendingRoots.clear();
    // 新增图片与换了 src 的图片都重新走一遍视口判定，已处理且 URL 未变的会被跳过
    roots.forEach((root) => this.#observeImages(root));
  }

  #observeImages(root) {
    if (!this.#io || !root?.querySelectorAll) return;
    if (root.nodeName === "IMG") {
      this.#io.observe(root);
      return;
    }
    root.querySelectorAll("img").forEach((img) => this.#io.observe(img));
  }

  /** 页面翻页可能复用同一个 img 节点换 src，需要按 URL 变化重新处理 */
  #enqueue(img) {
    if (this.#destroyed || !img?.src) return;

    const url = img.currentSrc || img.src;
    const state = this.#states.get(img);
    if (state?.url === url) return;
    if (state) this.#teardown(img);

    this.#states.set(img, { url, overlay: null });
    this.#queue.push({ img, url });
    this.#drainQueue();
  }

  /**
   * 队列取件：优先处理离视口最近的图。
   * 快速翻页时队列按入队顺序排满已经翻过去的图，严格 FIFO 会让「正在看的图」
   * 排在队尾死等（落后感的主要来源）。队列很短，逐个读 rect 的开销可忽略。
   */
  #pickNextTask() {
    if (this.#queue.length <= 1) return this.#queue.shift();
    const viewportMid = (window.innerHeight || 0) / 2;
    let bestIdx = 0;
    let bestDist = Infinity;
    this.#queue.forEach((task, idx) => {
      const rect = task.img?.getBoundingClientRect?.();
      const dist = rect
        ? Math.abs((rect.top + rect.bottom) / 2 - viewportMid)
        : Number.MAX_SAFE_INTEGER; // 拿不到布局的排最后
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = idx;
      }
    });
    return this.#queue.splice(bestIdx, 1)[0];
  }

  #drainQueue() {
    while (this.#activeCount < MAX_CONCURRENT && this.#queue.length > 0) {
      const task = this.#pickNextTask();
      this.#activeCount += 1;
      this.#process(task.img, task.url)
        .catch((err) => kissLog("manga: process image failed", err))
        .finally(() => {
          this.#activeCount -= 1;
          this.#drainQueue();
        });
    }
  }

  async #process(img, url) {
    await this.#cacheReady;
    if (this.#destroyed || !img.isConnected) return;

    // 先确保图片已解码且尺寸达标：缓存命中路径同样需要原始尺寸才能算出气泡百分比
    const size = await this.#ensureImageReady(img);
    if (this.#destroyed || !size) return;

    // 发送尺寸（可能被缩过）——气泡坐标属于这个空间，缓存也要按它校验
    const sent = sentImageSize(size.naturalWidth, size.naturalHeight);

    // 缓存命中：直接渲染，不再请求接口（提示词签名变了、或发送尺寸变了都要重译）
    const cached = this.#cache[url];
    if (
      cached?.bubbles &&
      cached.promptSig === this.#promptSig &&
      cached.sentWidth === sent.width &&
      cached.sentHeight === sent.height
    ) {
      // 旧缓存可能是「坐标越界」的坏结果（见 prompt.js 的校验）。重新校验一次：
      //   有效条目照用；整条不可信且本就是这个标记（新写入）→ 当作无文字，不再重试；
      //   旧格式的坏缓存 → 当作没命中，走下面的重新识别。
      const usable = validateVisionBubbles(cached.bubbles, sent);
      if (usable.length > 0) {
        this.#render(img, url, usable, sent.width, sent.height);
        return;
      }
      if (cached.coordsRejected) return;
      kissLog("manga: cached bubbles rejected, refetching", url);
    }

    const image = await this.#toDataUrl(img, url);
    if (this.#destroyed || !image?.dataUrl) {
      kissLog("manga: image data unavailable", url);
      return;
    }

    // 按优先级逐个尝试启用的视觉接口：主接口挂了（余额不足/超时/网络错/坐标全坏）
    // 就落到下一个保底（例如本地 MLX/Ollama），直到有一个给出可用译文。
    let bubbles = null;
    let coordsRejected = false;
    let sawEmptySuccess = false; // 有接口正常返回、只是这张图确实没文字
    for (const apiSetting of this.#apiSettings) {
      let raw = "";
      try {
        raw = await callVisionApi({
          apiSetting,
          imageDataUrl: image.dataUrl,
          prompt: this.#prompt,
        });
      } catch (err) {
        kissLog("manga: vision api failed, try next", apiSetting?.name, err);
        continue;
      }
      if (this.#destroyed) return;

      // 不带 bound 先解析一次，用来区分两种「空」：
      //   模型返回了条目但坐标不可信 → 换下一个接口试试；都不可信再记 coordsRejected；
      //   模型本来就没返回条目（这张图没文字）→ 记成正常空结果。
      const rawBubbles = parseVisionResult(raw);
      const valid = parseVisionResult(raw, {
        width: image.width,
        height: image.height,
      });
      if (valid.length > 0) {
        bubbles = valid;
        coordsRejected = false;
        break;
      }
      if (rawBubbles.length > 0) coordsRejected = true;
      else sawEmptySuccess = true;
    }

    if (!bubbles) {
      if (coordsRejected) {
        // 每个有结果的接口坐标都不可信：记下来，避免反复重试同一个坏结果
        kissLog(
          "manga: vision boxes out of range on all apis, skip rendering",
          url
        );
        this.#storeCache(url, [], image.width, image.height, {
          coordsRejected: true,
        });
      } else if (sawEmptySuccess) {
        // 有接口明确说这张图没文字 → 缓存空结果，免得每次进视口都重跑整条链路
        this.#storeCache(url, [], image.width, image.height);
      }
      // 全部接口都调用失败（欠费/网络）→ 不缓存，下次进视口再试
      return;
    }
    this.#storeCache(url, bubbles, image.width, image.height);
    this.#render(img, url, bubbles, image.width, image.height);
  }

  /** 等待图片解码完成并检查尺寸；尺寸过小或超时返回 null */
  async #ensureImageReady(img) {
    if (!img.complete || !img.naturalWidth) {
      await new Promise((resolve) => {
        let timer = null;
        const done = () => {
          clearTimeout(timer);
          img.removeEventListener("load", done);
          img.removeEventListener("error", done);
          resolve();
        };
        img.addEventListener("load", done);
        img.addEventListener("error", done);
        timer = setTimeout(done, IMAGE_LOAD_TIMEOUT);
      });
    }

    if (
      img.naturalWidth < MIN_IMAGE_EDGE ||
      img.naturalHeight < MIN_IMAGE_EDGE
    ) {
      return null;
    }
    return { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight };
  }

  /**
   * 取图转 dataURL：跨域图片经 background 代理下载，失败时退回同源 canvas 兜底。
   * @returns {Promise<{dataUrl: string, width: number, height: number}|null>}
   *   width/height 是**实际发送给视觉模型的那张图**的像素尺寸。模型返回的 box 属于这个
   *   坐标空间（发送前可能被缩过），覆盖层必须用它换算百分比，否则整块译文会偏位。
   */
  async #toDataUrl(img, url) {
    try {
      const dataUrl = await fetchData(
        url,
        { method: "GET" },
        { expect: "base64" }
      );
      if (typeof dataUrl === "string" && dataUrl.startsWith("data:")) {
        return await this.#shrinkDataUrl(img, dataUrl);
      }
    } catch (err) {
      kissLog("manga: fetch image failed, try canvas fallback", err);
    }
    return this.#canvasFallback(img);
  }

  /** 过宽的图片先缩放再发送，控制 token 消耗与模型输入限制 */
  async #shrinkDataUrl(img, dataUrl) {
    const size = sentImageSize(img.naturalWidth, img.naturalHeight);
    if (size.width === img.naturalWidth) {
      return { dataUrl, ...size };
    }

    // 优先走异步离屏路径：createImageBitmap 的解码与 OffscreenCanvas.convertToBlob
    // 的编码都不占主线程。旧路径（Image.onload + canvas.toDataURL）全程同步，
    // 一张长图解码+重编码要几十上百 ms，两个并发任务叠起来就是肉眼可见的卡顿。
    if (
      typeof createImageBitmap === "function" &&
      typeof OffscreenCanvas !== "undefined" &&
      typeof FileReader !== "undefined"
    ) {
      try {
        const blob = await (await fetch(dataUrl)).blob();
        const bitmap = await createImageBitmap(blob);
        try {
          const canvas = new OffscreenCanvas(size.width, size.height);
          canvas
            .getContext("2d")
            .drawImage(bitmap, 0, 0, size.width, size.height);
          const outBlob = await canvas.convertToBlob({
            type: "image/jpeg",
            quality: JPEG_QUALITY,
          });
          const outDataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(outBlob);
          });
          return { dataUrl: outDataUrl, width: size.width, height: size.height };
        } finally {
          bitmap.close?.();
        }
      } catch (err) {
        kissLog("manga: offscreen shrink failed, use sync path", err);
      }
    }

    const bitmap = await new Promise((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = dataUrl;
    });
    if (!bitmap)
      return { dataUrl, width: img.naturalWidth, height: img.naturalHeight };

    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    canvas
      .getContext("2d")
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // 主动释放全尺寸解码图的引用，别让几 MB 的原图解码结果活到 GC 想起来
    bitmap.onload = null;
    bitmap.onerror = null;
    bitmap.src = "";
    return {
      dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY),
      width: canvas.width,
      height: canvas.height,
    };
  }

  /** 同源兜底：直接画页面上已加载的 img（跨域图片会污染 canvas，抛出即放弃） */
  #canvasFallback(img) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      return {
        dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY),
        width: canvas.width,
        height: canvas.height,
      };
    } catch (err) {
      kissLog("manga: canvas fallback failed (cross-origin image?)", err);
      return null;
    }
  }

  #render(img, url, bubbles, sentWidth, sentHeight) {
    if (this.#destroyed || !img.isConnected) return;
    if (!Array.isArray(bubbles) || bubbles.length === 0) return;

    const state = this.#states.get(img);
    if (!state || state.url !== url) return;

    const layer = attachMangaLayer(img, {
      bubbles,
      // 坐标来自发送给模型的那张图；嵌字按百分比、弹幕按锚点换算，都用它
      naturalWidth: sentWidth,
      naturalHeight: sentHeight,
      mode: this.#mode,
    });
    if (!layer) return;

    layer.setVisible(this.#visible);
    state.layer = layer;
    this.#resizeObserver?.observe(img);
  }

  #teardown(img) {
    this.#states.get(img)?.layer?.destroy?.();
    this.#resizeObserver?.unobserve(img);
    this.#states.delete(img);
  }

  /** 清理已从文档移除的图片，避免 Map 与覆盖层泄漏 */
  #pruneDisconnected() {
    this.#states.forEach((state, img) => {
      if (!img.isConnected) this.#teardown(img);
    });
  }

  async #loadCache() {
    try {
      const cached = await getMangaCache();
      this.#cache = cached && typeof cached === "object" ? cached : {};
    } catch (err) {
      kissLog("manga: load cache failed", err);
      this.#cache = {};
    }
  }

  /** 读缓存前先算出提示词签名：站点术语表/提示词改过之后，旧译文不再复用 */
  async #initCache() {
    try {
      this.#promptSig = await getCacheDigest(this.#prompt, MANGA_CACHE_SALT);
    } catch (err) {
      kissLog("manga: prompt signature failed", err);
      this.#promptSig = "";
    }
    await this.#loadCache();
  }

  #storeCache(
    url,
    bubbles,
    sentWidth,
    sentHeight,
    { coordsRejected = false } = {}
  ) {
    this.#cache[url] = {
      bubbles,
      sentWidth,
      sentHeight,
      updatedAt: Date.now(),
      promptSig: this.#promptSig,
      // 模型给了坐标但不可信：记下来，避免每次进视口都重试同一个坏结果
      ...(coordsRejected ? { coordsRejected: true } : {}),
    };

    const keys = Object.keys(this.#cache);
    if (keys.length > MAX_CACHE_ENTRIES) {
      keys
        .sort(
          (a, b) =>
            (this.#cache[a]?.updatedAt || 0) - (this.#cache[b]?.updatedAt || 0)
        )
        .slice(0, keys.length - MAX_CACHE_ENTRIES)
        .forEach((key) => delete this.#cache[key]);
    }

    this.#scheduleCacheSave();
  }

  #scheduleCacheSave() {
    if (this.#cacheSaveTimer) return;
    this.#cacheSaveTimer = setTimeout(() => {
      this.#cacheSaveTimer = null;
      this.#flushCache();
    }, CACHE_SAVE_DELAY);
  }

  #flushCache() {
    if (this.#cacheSaveTimer) {
      clearTimeout(this.#cacheSaveTimer);
      this.#cacheSaveTimer = null;
    }
    if (!this.#started && !Object.keys(this.#cache).length) return;
    setMangaCache(this.#cache).catch((err) =>
      kissLog("manga: save cache failed", err)
    );
  }

  #ensureResizeObserver() {
    if (typeof ResizeObserver === "undefined") return;
    // 窗口缩放会连续触发每张图的 sync，而弹幕 sync 边写 top 边读 offsetHeight，
    // 逐张立即跑是标准的布局抖动。攒到每帧一次统一跑。
    this.#resizeObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => this.#pendingSync.add(entry.target));
      if (this.#syncRaf != null) return;
      this.#syncRaf = requestAnimationFrame(() => {
        this.#syncRaf = null;
        if (this.#destroyed) {
          this.#pendingSync.clear();
          return;
        }
        const targets = [...this.#pendingSync];
        this.#pendingSync.clear();
        targets.forEach((target) => {
          this.#states.get(target)?.layer?.sync?.();
        });
      });
    });
  }
}
