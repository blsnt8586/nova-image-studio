'use strict';

const sharpLib = require('sharp');

/**
 * 可无损转 WebP 的栅格格式白名单。
 * GIF 多为动图,转单帧会丢动画,故不在此列、原样保留。
 */
const COMPRESSIBLE_MIMES = Object.freeze(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

/** 判断该 mime 是否适合做 WebP 无损压缩。 */
function isCompressibleMime(mime) {
  return COMPRESSIBLE_MIMES.includes(String(mime || '').toLowerCase());
}

/**
 * 将图片 buffer 无损压缩为 WebP。
 *
 * 设计约束:
 * - 仅处理白名单栅格格式;其余(含动图 GIF)原样返回。
 * - 使用 lossless + effort 6:逐像素无损,压缩努力拉满(存储一次性,值得多花 CPU)。
 * - 仅当结果确实更小才采用,否则保留原图,避免反向膨胀。
 * - 任何异常都回退原图:压缩绝不阻断上传。
 *
 * @param {Buffer} buffer 原始图片字节
 * @param {string} mime 原始 content-type
 * @param {object} [deps]
 * @param {object} [deps.sharp] 注入的 sharp(便于测试)
 * @returns {Promise<{ buffer: Buffer, mime: string, compressed: boolean }>}
 */
async function compressToWebpLossless(buffer, mime, deps = {}) {
  const sharp = deps.sharp || sharpLib;
  const passthrough = { buffer, mime, compressed: false };

  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || !isCompressibleMime(mime)) {
    return passthrough;
  }

  try {
    const out = await sharp(buffer, { animated: true })
      .webp({ lossless: true, effort: 6 })
      .toBuffer();
    if (out.length > 0 && out.length < buffer.length) {
      return { buffer: out, mime: 'image/webp', compressed: true };
    }
    return passthrough;
  } catch (error) {
    console.warn('[image-compress] WebP 无损压缩失败,回退原图:', error?.message || error);
    return passthrough;
  }
}

module.exports = { compressToWebpLossless, isCompressibleMime, COMPRESSIBLE_MIMES };
