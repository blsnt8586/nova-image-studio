/**
 * 智能重绘:把「涂抹图层」转换为 OpenAI images/edits 所需的 mask。
 *
 * react-sketch-canvas 导出的笔刷图层:涂抹处有不透明的笔刷色(alpha>0),
 * 其余为完全透明(alpha=0)。
 *
 * OpenAI mask 语义恰好相反 —— **透明区(alpha=0)= 允许修改**,不透明区 = 保留。
 * 因此本转换按 alpha 阈值反相:
 *   - 被涂抹(alpha ≥ threshold)   → 输出透明(alpha 0)   → 该区域允许重绘
 *   - 未涂抹(alpha < threshold)   → 输出不透明黑(alpha 255) → 该区域保留
 *
 * 纯函数:不修改入参,返回新缓冲;不依赖 DOM,便于单测。
 * DOM 侧(把笔刷 PNG 画到 canvas 取像素、再把本结果写回 canvas 导出 PNG)由组件负责。
 */

const DEFAULT_THRESHOLD = 32;

export interface MaskFromPaintOptions {
  /** alpha ≥ 阈值才算「已涂抹」,用于忽略抗锯齿软边。默认 32。 */
  threshold?: number;
}

/**
 * @param paintRgba 笔刷图层的 RGBA 像素(长度为 像素数 × 4)
 * @returns 新的 RGBA 缓冲:涂抹处透明、其余不透明黑
 */
export function paintLayerToOpenAiMask(
  paintRgba: Uint8ClampedArray,
  options: MaskFromPaintOptions = {},
): Uint8ClampedArray {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const out = new Uint8ClampedArray(paintRgba.length);

  for (let i = 0; i < paintRgba.length; i += 4) {
    const painted = paintRgba[i + 3] >= threshold;
    // 颜色统一为黑(0,0,0);仅 alpha 区分保留/可编辑。
    out[i] = 0;
    out[i + 1] = 0;
    out[i + 2] = 0;
    out[i + 3] = painted ? 0 : 255;
  }

  return out;
}

/** 笔刷图层是否为空(没有任何达到阈值的涂抹)。用于阻止提交空 mask。 */
export function isMaskEmpty(
  paintRgba: Uint8ClampedArray,
  options: MaskFromPaintOptions = {},
): boolean {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  for (let i = 3; i < paintRgba.length; i += 4) {
    if (paintRgba[i] >= threshold) return false;
  }
  return true;
}
