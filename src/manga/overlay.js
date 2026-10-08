/**
 * @file overlay.js
 * @description 漫画译文的页面覆盖层与悬浮开关。
 *
 * 刻意不使用项目的 ShadowDomManager 来挂覆盖层：它的 `show()` 二次调用不会
 * 刷新已挂载实例的 props（见 shadowDomManager.js 中的 REVIEW 说明），而漫画
 * 覆盖层需要「按图片逐个挂载 / 更新 / 移除」，用原生 DOM 更直接可控。
 * 所有注入元素都带 `notranslate`，避免被自身的网页翻译器二次翻译。
 */

const OVERLAY_CLASS = "kiss-manga-overlay";
const BUBBLE_CLASS = "kiss-manga-bubble";
const TOGGLE_CLASS = "kiss-manga-toggle";

// 字号按气泡面积与译文长度估算后的取值区间（px，渲染后的像素）
const MIN_FONT_SIZE = 9;
const MAX_FONT_SIZE = 44;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * 在图片父容器内挂载一个与图片边界对齐的覆盖层，并把气泡按百分比坐标铺进去。
 *
 * 坐标使用百分比：图片随窗口缩放时覆盖层自动跟随，无需重算。
 *
 * @param {HTMLImageElement} img 目标图片
 * @param {Object} params
 * @param {Array<Object>} params.bubbles 气泡数组（parseVisionResult 的输出）
 * @param {number} params.naturalWidth 图片原始宽度
 * @param {number} params.naturalHeight 图片原始高度
 * @returns {Object|null} 覆盖层句柄 `{sync, setVisible, destroy}`；无法挂载时返回 null
 */
export const attachOverlay = (
  img,
  { bubbles = [], naturalWidth = 0, naturalHeight = 0 } = {}
) => {
  const parent = img.parentElement;
  if (!parent || !naturalWidth || !naturalHeight) return null;

  // 只有父容器原本是 static 时才改成 relative，并记住原值以便恢复
  const originalPosition = parent.style.position;
  const positionedByUs = getComputedStyle(parent).position === "static";
  if (positionedByUs) {
    parent.style.setProperty("position", "relative");
  }

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

/**
 * 挂载页面右下角的漫画翻译悬浮开关。
 * @param {Object} params
 * @param {Function} params.onClick 点击回调
 * @param {string} [params.title] 提示文案
 * @returns {Object} 句柄 `{setActive, destroy}`
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
    setActive(active) {
      btn.textContent = active ? "漫" : "原";
      btn.style.background = active
        ? "rgba(24,24,27,0.86)"
        : "rgba(140,140,140,0.75)";
    },
    destroy() {
      btn.removeEventListener("click", onClick);
      btn.remove();
    },
  };
};
