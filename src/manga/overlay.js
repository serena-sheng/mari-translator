/**
 * @file overlay.js
 * @description 漫画译文的两种显示方式与悬浮开关。
 *
 * 1. `overlay`（嵌字）：在图片上按气泡坐标铺译文块（原行为）。
 * 2. `danmaku`（侧栏弹幕）：把图片压窄，在两侧腾出栏位，译文像弹幕一样贴在栏里，
 *    纵向与原文位置对齐、逐条向下堆积不重叠、统一横排字号，按气泡左右分栏。
 *
 * 刻意不使用项目的 ShadowDomManager 来挂载：它的 `show()` 二次调用不会刷新已挂载
 * 实例的 props（见 shadowDomManager.js 中的 REVIEW 说明），而这里需要「按图片逐个
 * 挂载 / 切换模式 / 更新 / 移除」，用原生 DOM 更直接可控。
 * 所有注入元素都带 `notranslate`，避免被自身的网页翻译器二次翻译。
 */

const OVERLAY_CLASS = "kiss-manga-overlay";
const BUBBLE_CLASS = "kiss-manga-bubble";
const GUTTER_CLASS = "kiss-manga-gutter";
const DANMAKU_CLASS = "kiss-manga-danmaku";
const TOGGLE_CLASS = "kiss-manga-toggle";

// 字号按气泡面积与译文长度估算后的取值区间（px，渲染后的像素）
const MIN_FONT_SIZE = 9;
const MAX_FONT_SIZE = 44;

// 侧栏弹幕：栏宽按容器比例取，夹在上下限之间；条目统一字号与行高
const GUTTER_RATIO = 0.2;
const GUTTER_MIN_WIDTH = 150;
const GUTTER_MAX_WIDTH = 300;
const DANMAKU_FONT_SIZE = 14;
const DANMAKU_GAP = 6;
const MIN_IMAGE_WIDTH = 120;

/** 显示方式 */
export const MODE_MANGA_OVERLAY = "overlay";
export const MODE_MANGA_DANMAKU = "danmaku";

/** 悬浮开关的三种状态（含关闭） */
export const TOGGLE_STATE_OFF = "off";

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const prefersReducedMotion = () =>
  typeof globalThis.matchMedia === "function" &&
  globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * 嵌字模式：在图片上铺一层按百分比定位的译文块。
 * @returns {Object} 句柄 `{sync, setVisible, destroy}`
 */
const createOverlay = (
  img,
  { bubbles = [], naturalWidth = 0, naturalHeight = 0 } = {}
) => {
  const overlay = document.createElement("div");
  overlay.className = `${OVERLAY_CLASS} notranslate`;
  overlay.style.cssText = `position:absolute; pointer-events:none; z-index:10; overflow:visible;`;

  const items = bubbles.map((bubble) => {
    const [x1, y1, x2, y2] = bubble.box;
    const el = document.createElement("div");
    el.className = `${BUBBLE_CLASS} notranslate`;
    el.textContent = bubble.dst;
    el.style.cssText = [
      "position:absolute",
      "box-sizing:border-box",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "text-align:center",
      `left:${((x1 / naturalWidth) * 100).toFixed(4)}%`,
      `top:${((y1 / naturalHeight) * 100).toFixed(4)}%`,
      `width:${(((x2 - x1) / naturalWidth) * 100).toFixed(4)}%`,
      `min-height:${(((y2 - y1) / naturalHeight) * 100).toFixed(4)}%`,
      // 不透明底：把原文盖住，避免中英叠在一起
      "background:#fffdf5",
      "color:#111",
      "border-radius:6px",
      "padding:1px 2px",
      "line-height:1.3",
      "overflow-wrap:break-word",
      "overflow:hidden",
      "pointer-events:none",
      `writing-mode:${bubble.vertical ? "vertical-rl" : "horizontal-tb"}`,
    ].join(";");
    overlay.appendChild(el);
    return { el, box: bubble.box, text: String(bubble.dst || "") };
  });

  // 覆盖层紧跟在图片之后，避免打乱页面既有子元素顺序
  img.insertAdjacentElement("afterend", overlay);

  // 对齐几何：父容器已定位，图片的 offset* 即相对父容器内边距盒的坐标
  const sync = () => {
    const width = img.offsetWidth;
    const height = img.offsetHeight;
    overlay.style.left = `${img.offsetLeft}px`;
    overlay.style.top = `${img.offsetTop}px`;
    overlay.style.width = `${width}px`;
    overlay.style.height = `${height}px`;

    const renderedHeight = img.clientHeight || height;
    const renderedWidth = img.clientWidth || width;
    items.forEach(({ el, box, text }) => {
      // 按「气泡面积 ÷ 译文长度」估字号：让译文大致填满气泡，而不是固定 18px 的小字
      const boxWidth = ((box[2] - box[0]) / naturalWidth) * renderedWidth;
      const boxHeight = ((box[3] - box[1]) / naturalHeight) * renderedHeight;
      const area = Math.max(boxWidth * boxHeight, 1);
      const chars = Math.max(text.length, 1);
      el.style.fontSize = `${clamp(
        Math.sqrt(area / (chars * 1.15)),
        MIN_FONT_SIZE,
        MAX_FONT_SIZE
      ).toFixed(1)}px`;
    });
  };

  sync();

  return {
    sync,
    setVisible(visible) {
      overlay.style.display = visible ? "" : "none";
    },
    destroy() {
      overlay.remove();
    },
  };
};

/**
 * 侧栏弹幕模式：把图片压窄，左右各腾一条栏位，译文按原文纵向位置逐条往下堆。
 *
 * 左右分栏按气泡水平中心决定；两栏各自「按锚点排序后顺排」，因此既不重叠，
 * 又尽量贴着原文的纵向位置。
 *
 * @returns {Object} 句柄 `{sync, setVisible, destroy}`
 */
const createGutters = (
  img,
  { bubbles = [], naturalWidth = 0, naturalHeight = 0 } = {}
) => {
  const parent = img.parentElement;
  const parentWidth = parent.clientWidth || img.offsetWidth || 0;
  const gutterWidth = clamp(
    Math.round(parentWidth * GUTTER_RATIO),
    GUTTER_MIN_WIDTH,
    GUTTER_MAX_WIDTH
  );
  const imageWidth = Math.max(parentWidth - gutterWidth * 2, MIN_IMAGE_WIDTH);
  // 图片当前的渲染宽度。只有它比「腾出两侧栏位后的目标宽度」更宽时才需要压窄；
  // 本身就更小的图若强行设成目标宽度会被放大变形（真机上 560px 的图被拉到 832px）。
  const beforeWidth = img.offsetWidth || img.clientWidth || parentWidth;

  // 记住图片原本的内联样式，退出/隐藏时还原（页面自己的 CSS 不动）
  const originalStyle = {
    width: img.style.width,
    maxWidth: img.style.maxWidth,
    height: img.style.height,
    marginLeft: img.style.marginLeft,
    marginRight: img.style.marginRight,
  };
  // 关键：不只缩宽度，还要左右各留出栏宽的外边距，否则图片（常见左对齐）会和侧栏重叠
  const applyNarrow = () => {
    // beforeWidth 为 0 表示量不到布局（如 jsdom、图片尚未布局），此时按「图占满容器」处理，仍然压窄
    if (beforeWidth > 0 && imageWidth >= beforeWidth) {
      // 容器本来就放得下两侧栏位，不动图片
      restoreImage();
      return;
    }
    img.style.width = `${imageWidth}px`;
    img.style.maxWidth = "none";
    img.style.height = "auto";
    img.style.marginLeft = `${gutterWidth}px`;
    img.style.marginRight = `${gutterWidth}px`;
  };
  // 把图片放回原始样式（「原图」模式与卸载时都要用，否则会留下被压窄的图）
  const restoreImage = () => {
    if (originalStyle.width) img.style.width = originalStyle.width;
    else img.style.removeProperty("width");
    if (originalStyle.maxWidth) img.style.maxWidth = originalStyle.maxWidth;
    else img.style.removeProperty("max-width");
    if (originalStyle.height) img.style.height = originalStyle.height;
    else img.style.removeProperty("height");
    if (originalStyle.marginLeft)
      img.style.marginLeft = originalStyle.marginLeft;
    else img.style.removeProperty("margin-left");
    if (originalStyle.marginRight)
      img.style.marginRight = originalStyle.marginRight;
    else img.style.removeProperty("margin-right");
  };
  applyNarrow();

  const gutters = {
    left: document.createElement("div"),
    right: document.createElement("div"),
  };
  Object.entries(gutters).forEach(([side, el]) => {
    el.className = `${GUTTER_CLASS} notranslate`;
    el.dataset.side = side;
    el.style.cssText = [
      "position:absolute",
      "top:0",
      "box-sizing:border-box",
      "overflow:visible",
      "pointer-events:none",
      "z-index:10",
      `width:${gutterWidth}px`,
    ].join(";");
    parent.appendChild(el);
  });

  const mid = naturalWidth / 2;
  const items = bubbles.map((bubble) => {
    const [x1, y1, x2, y2] = bubble.box;
    const side = (x1 + x2) / 2 < mid ? "left" : "right";
    const el = document.createElement("div");
    el.className = `${DANMAKU_CLASS} notranslate`;
    el.dataset.side = side;
    // 统一横排、统一字号；宽度受栏宽限制，超出即换行
    el.textContent = String(bubble.dst || "");
    el.style.cssText = [
      "position:absolute",
      "box-sizing:border-box",
      "width:100%",
      `font-size:${DANMAKU_FONT_SIZE}px`,
      "line-height:1.35",
      "color:#fff",
      "background:rgba(24,24,27,0.9)",
      "border-radius:6px",
      "padding:3px 6px",
      "overflow-wrap:break-word",
      "white-space:pre-wrap",
      "pointer-events:none",
    ].join(";");
    gutters[side].appendChild(el);
    // 入场：从靠图片的一侧滑入，做出弹幕「发射」的感觉（尊重 prefers-reduced-motion）
    if (!prefersReducedMotion() && typeof el.animate === "function") {
      const offset = side === "left" ? -14 : 14;
      el.animate(
        [
          { opacity: 0, transform: `translateX(${offset}px)` },
          { opacity: 1, transform: "translateX(0)" },
        ],
        { duration: 180, easing: "ease-out" }
      );
    }
    return { el, side, anchor: (y1 + y2) / 2 };
  });

  // 撑一条细线在栏的靠图一侧，标出该条弹幕对应的原文纵向位置
  const markers = items.map(({ el, side, anchor }) => {
    const mark = document.createElement("div");
    mark.className = "kiss-manga-marker notranslate";
    mark.style.cssText = [
      "position:absolute",
      "width:4px",
      "height:2px",
      "border-radius:1px",
      "background:rgba(24,24,27,0.55)",
      side === "left" ? "right:-6px" : "left:-6px",
    ].join(";");
    gutters[side].appendChild(mark);
    return { mark, anchor, side };
  });

  const sync = () => {
    const renderedHeight = img.clientHeight || img.offsetHeight;
    const containerWidth = parent.clientWidth || parentWidth;
    // 栏位贴容器左右边缘（而不是贴着图片），这样同一页里宽度不同的图片
    // （例如未压窄的小封面 vs 压窄后的正文页）译文列始终在同一条竖线上。
    gutters.left.style.top = `${img.offsetTop}px`;
    gutters.left.style.height = `${img.offsetHeight}px`;
    gutters.left.style.left = "0px";
    gutters.right.style.top = `${img.offsetTop}px`;
    gutters.right.style.height = `${img.offsetHeight}px`;
    gutters.right.style.left = `${Math.max(containerWidth - gutterWidth, 0)}px`;

    // 逐栏堆积：先按锚点（原文纵向中心）从上到下排序，再依次下推，保证互不重叠。
    // 每条译文以「自身中心」对齐原文中心，这样视线与原文基本平齐；只有会重叠时才向下让位。
    ["left", "right"].forEach((side) => {
      let bottom = Number.NEGATIVE_INFINITY;
      items
        .filter((item) => item.side === side)
        .sort((a, b) => a.anchor - b.anchor)
        .forEach((item) => {
          const chipH = item.el.offsetHeight || DANMAKU_FONT_SIZE * 1.6;
          const centered =
            (item.anchor / naturalHeight) * renderedHeight - chipH / 2;
          const top = Math.max(centered, bottom + DANMAKU_GAP);
          item.el.style.top = `${top}px`;
          bottom = top + chipH;
        });
    });

    markers.forEach(({ mark, anchor }) => {
      // 标记落在原文的纵向中心（anchor 已是中心），横向由所在栏贴边决定
      mark.style.top = `${(anchor / naturalHeight) * renderedHeight - 1}px`;
    });
  };

  sync();

  return {
    sync,
    setVisible(visible) {
      Object.values(gutters).forEach((el) => {
        el.style.display = visible ? "" : "none";
      });
      // 弹幕模式靠「压窄图片 + 两侧腾栏」实现，隐藏时必须把图片放回原尺寸，
      // 否则「原图」模式会留下一张被压窄的图（两侧还各空着一条栏位）
      if (visible) {
        applyNarrow();
        sync();
      } else {
        restoreImage();
      }
    },
    destroy() {
      Object.values(gutters).forEach((el) => el.remove());
      restoreImage();
    },
  };
};

/**
 * 按显示方式在图片上挂载译文层，并支持运行时切换模式。
 *
 * @param {HTMLImageElement} img 目标图片
 * @param {Object} params
 * @param {Array<Object>} params.bubbles 气泡数组（parseVisionResult 的输出，坐标属于发送给模型的图）
 * @param {number} params.naturalWidth 发送给模型的图宽
 * @param {number} params.naturalHeight 发送给模型的图高
 * @param {string} [params.mode] `overlay`（嵌字）或 `danmaku`（侧栏弹幕）
 * @returns {Object|null} 句柄 `{mode, setMode, sync, setVisible, destroy}`；无法挂载时返回 null
 */
export const attachMangaLayer = (
  img,
  {
    bubbles = [],
    naturalWidth = 0,
    naturalHeight = 0,
    mode = MODE_MANGA_OVERLAY,
  } = {}
) => {
  const parent = img.parentElement;
  if (!parent || !naturalWidth || !naturalHeight) return null;

  // 只有父容器原本是 static 时才改成 relative，并记住原值以便恢复
  const originalPosition = parent.style.position;
  const positionedByUs = getComputedStyle(parent).position === "static";
  if (positionedByUs) {
    parent.style.setProperty("position", "relative");
  }

  let visible = true;
  let currentMode = null;
  let handle = null;

  const build = (nextMode) => {
    handle?.destroy?.();
    currentMode = nextMode;
    handle =
      nextMode === MODE_MANGA_DANMAKU
        ? createGutters(img, { bubbles, naturalWidth, naturalHeight })
        : createOverlay(img, { bubbles, naturalWidth, naturalHeight });
    handle?.setVisible?.(visible);
  };

  build(mode);

  return {
    get mode() {
      return currentMode;
    },
    setMode(nextMode) {
      if (nextMode && nextMode !== currentMode) build(nextMode);
    },
    sync() {
      handle?.sync?.();
    },
    setVisible(next) {
      visible = next;
      handle?.setVisible?.(next);
    },
    destroy() {
      handle?.destroy?.();
      handle = null;
      // 只恢复由本模块改写的父容器定位样式
      if (positionedByUs && parent.style.position === "relative") {
        if (originalPosition) {
          parent.style.setProperty("position", originalPosition);
        } else {
          parent.style.removeProperty("position");
        }
      }
    },
  };
};

const TOGGLE_LABELS = {
  [MODE_MANGA_OVERLAY]: "漫",
  [MODE_MANGA_DANMAKU]: "幕",
  [TOGGLE_STATE_OFF]: "原",
};

// 三种状态的按钮配色：嵌字=深色、侧栏弹幕=蓝色（区别于嵌字）、原图=灰色（关闭态）
const TOGGLE_BACKGROUNDS = {
  [MODE_MANGA_OVERLAY]: "rgba(24,24,27,0.86)",
  [MODE_MANGA_DANMAKU]: "rgba(37,99,235,0.9)",
  [TOGGLE_STATE_OFF]: "rgba(140,140,140,0.8)",
};

/**
 * 挂载页面右下角的漫画翻译悬浮开关。
 * @param {Object} params
 * @param {Function} params.onClick 点击回调
 * @param {string} [params.title] 提示文案
 * @returns {Object} 句柄 `{setState, destroy}`
 */
export const mountMangaToggle = ({ onClick, title = "" }) => {
  // 用原生 button 而不是 role=button 的 div：键盘可达（Tab + Enter）由浏览器保证
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `${TOGGLE_CLASS} notranslate`;
  btn.style.cssText = [
    "position:fixed",
    "right:16px",
    "bottom:16px",
    "z-index:2147483647",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "width:44px",
    "height:44px",
    "border:0",
    "padding:0",
    "appearance:none",
    "border-radius:50%",
    "box-shadow:0 2px 8px rgba(0,0,0,0.35)",
    "background:rgba(24,24,27,0.86)",
    "color:#fff",
    "font-size:18px",
    "line-height:1",
    "cursor:pointer",
    "user-select:none",
    "font-family:system-ui,-apple-system,sans-serif",
  ].join(";");
  if (title) btn.title = title;

  btn.addEventListener("click", onClick);

  (document.body || document.documentElement).appendChild(btn);

  return {
    /** 切换按钮呈现：`overlay` → 漫（嵌字）、`danmaku` → 幕（侧栏弹幕）、`off` → 原 */
    setState(state) {
      btn.textContent = TOGGLE_LABELS[state] || TOGGLE_LABELS[TOGGLE_STATE_OFF];
      btn.dataset.state = state;
      btn.style.background =
        TOGGLE_BACKGROUNDS[state] || TOGGLE_BACKGROUNDS[TOGGLE_STATE_OFF];
    },
    destroy() {
      btn.remove();
    },
  };
};
