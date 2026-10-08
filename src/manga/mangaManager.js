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
import { kissLog } from "../libs/log";
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
const MAX_SEND_WIDTH = 1500; // 发送前压缩到的最大宽度，控制 token 成本
const JPEG_QUALITY = 0.85;
const MAX_CACHE_ENTRIES = 200; // 缓存条数上限，超出按更新时间淘汰最旧
const MAX_CONCURRENT = 2; // 同时进行的视觉请求数量
const ROOT_MARGIN = "300px"; // 视口预取范围
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
  #apiSetting = null;
  #io = null;
  #mo = null;
  #resizeObserver = null;
  #toggle = null;
  #states = new Map(); // img -> { url, layer }
  #pendingRoots = new Set(); // 待扫描的新增节点 / 换了 src 的图片
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
    if (this.#rule?.mangaEnabled !== "true") return;

    const apiSetting = this.#resolveVisionApiSetting();
    if (!apiSetting) {
      kissLog("manga: no enabled vision api with api key configured, skip");
      return;
    }

    this.#started = true;
    this.#apiSetting = apiSetting;
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

  #resolveVisionApiSetting() {
    const apis = Array.isArray(this.#setting?.transApis)
      ? this.#setting.transApis
      : [];
    // 视觉接口必须有 Key 才能真正调用；只启用不填 Key 不算可用配置。
    // 顺序与设置页一致（按 sortOrder 再按下标），因此「第一个」就是用户在接口列表里看到的最靠前那个。
    return getEnabledApis(apis).find(
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

  #drainQueue() {
    while (this.#activeCount < MAX_CONCURRENT && this.#queue.length > 0) {
      const task = this.#queue.shift();
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

    const raw = await callVisionApi({
      apiSetting: this.#apiSetting,
      imageDataUrl: image.dataUrl,
      prompt: this.#prompt,
    });
    if (this.#destroyed) return;

    // 不带 bound 先解析一次，用来区分两种「空」：
    //   模型返回了条目但坐标不可信 → 记成 coordsRejected 存下来，避免反复重试同一个坏结果；
    //   模型本来就没返回条目（这张图没文字）→ 正常缓存。
    const rawBubbles = parseVisionResult(raw);
    const bubbles = parseVisionResult(raw, {
      width: image.width,
      height: image.height,
    });
    const coordsRejected = rawBubbles.length > 0 && bubbles.length === 0;
    if (coordsRejected) {
      kissLog("manga: vision boxes out of range, skip rendering", url);
    }
    this.#storeCache(url, bubbles, image.width, image.height, {
      coordsRejected,
    });
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
    this.#resizeObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        this.#states.get(entry.target)?.layer?.sync?.();
      });
    });
  }
}
