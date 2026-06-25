'use client';

import { paintLayerToOpenAiMask, isMaskEmpty } from '@/lib/mask-from-paint';

/**
 * 智能重绘 DOM 侧:把 react-sketch-canvas 导出的「笔刷层 PNG」转换成
 * 与原图同尺寸的 OpenAI mask PNG(透明区=允许修改)。
 *
 * 像素反相逻辑在纯函数 paintLayerToOpenAiMask 里(已单测);这里只负责 DOM:
 *   1. 把笔刷 dataURL 画到一张「原图尺寸」的离屏 canvas(顺带把显示尺寸缩放回原始分辨率,
 *      保证 mask 与 image 像素对齐 —— OpenAI 要求两者同尺寸)
 *   2. 取像素 → 反相 → 写回 → 导出 PNG dataURL
 *
 * @param paintDataUrl react-sketch-canvas exportImage('png') 的结果
 * @param width 原图真实像素宽
 * @param height 原图真实像素高
 * @returns mask 的 PNG dataURL;若没有任何有效涂抹则返回 null
 */
export async function paintDataUrlToMaskDataUrl(
  paintDataUrl: string,
  width: number,
  height: number,
): Promise<string | null> {
  if (!paintDataUrl || width <= 0 || height <= 0) return null;

  const img = await loadImage(paintDataUrl);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // 把笔刷层缩放铺满到原图尺寸(笔刷层显示尺寸通常小于原图)。
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  if (isMaskEmpty(imageData.data)) return null;

  const maskRgba = paintLayerToOpenAiMask(imageData.data);
  // 写回到原 ImageData 的缓冲(避免重建 ImageData 的类型/SharedArrayBuffer 问题)。
  imageData.data.set(maskRgba);
  ctx.putImageData(imageData, 0, 0);

  return canvas.toDataURL('image/png');
}

/** 读取图片自然像素尺寸(用于按原图分辨率建画布)。 */
export async function getImageNaturalSize(src: string): Promise<{ width: number; height: number }> {
  const img = await loadImage(src);
  return { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

/**
 * 纯色填充：把笔刷涂抹区域直接填充为指定颜色（不调用 AI）。
 * @param imageSrc 原图 dataURL
 * @param paintDataUrl 笔刷层 dataURL
 * @param fillColor 填充颜色，默认白色
 * @returns 填充后的图片 dataURL
 */
export async function fillMaskedRegion(
  imageSrc: string,
  paintDataUrl: string,
  fillColor = '#FFFFFF'
): Promise<string> {
  const [img, paintImg] = await Promise.all([loadImage(imageSrc), loadImage(paintDataUrl)]);

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context 创建失败');

  // 1. 绘制原图
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // 2. 创建临时画布绘制笔刷层（缩放到原图尺寸）
  const paintCanvas = document.createElement('canvas');
  paintCanvas.width = canvas.width;
  paintCanvas.height = canvas.height;
  const paintCtx = paintCanvas.getContext('2d');
  if (!paintCtx) throw new Error('Paint canvas context 创建失败');
  paintCtx.drawImage(paintImg, 0, 0, canvas.width, canvas.height);

  const paintData = paintCtx.getImageData(0, 0, canvas.width, canvas.height);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // 3. 解析填充颜色
  const rgb = hexToRgb(fillColor);

  // 4. 遍历像素：笔刷层 alpha > 0 的位置填充颜色
  for (let i = 0; i < paintData.data.length; i += 4) {
    const paintAlpha = paintData.data[i + 3];
    if (paintAlpha > 0) {
      imgData.data[i] = rgb.r;
      imgData.data[i + 1] = rgb.g;
      imgData.data[i + 2] = rgb.b;
      // alpha 保持不变
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : { r: 255, g: 255, b: 255 };
}
