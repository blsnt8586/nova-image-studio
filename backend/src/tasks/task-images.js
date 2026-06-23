'use strict';

const { compressToWebpLossless } = require('./image-compress.js');

const DEFAULT_FETCH_TIMEOUT_MS = 30000;

/** content-type → 扩展名映射;未知则用 png。 */
function extFromMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('png')) return 'png';
  return 'png';
}

/**
 * 生图任务的图片落地服务(阶段 4)。图片本体写入 MinIO(generation 类型),
 * 返回 object_key 供 task_items 记录。依赖注入,便于单测。
 *
 * @param {object} deps
 * @param {{ putObject: Function, removeObject: Function }} deps.storage
 * @param {Function} [deps.fetchImpl] 注入的 fetch(默认全局 fetch)
 */
function createTaskImageService(deps) {
  const { storage } = deps;
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const compress = deps.compress || compressToWebpLossless;

  /**
   * 上传一段图片 buffer,返回 objectKey。
   * 落库前做 WebP 无损压缩(省存储);压缩后 mime/ext 随之变更。
   * 压缩模块自带回退,失败时按原图原 mime 上传,绝不阻断。
   */
  async function saveBuffer(userId, buffer, mimeType) {
    const result = await compress(buffer, mimeType);
    const finalMime = result.mime || mimeType;
    const ext = extFromMime(finalMime);
    const { objectKey } = await storage.putObject(userId, 'generation', ext, result.buffer, finalMime);
    return objectKey;
  }

  /** 下载远程图片再上传到 MinIO,返回 objectKey。 */
  async function saveFromUrl(userId, imageUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_FETCH_TIMEOUT_MS);
    try {
      const response = await fetchImpl(imageUrl, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`远程图片下载失败: ${response.status}`);
      }
      const contentType = response.headers.get('content-type') || 'image/png';
      const buffer = Buffer.from(await response.arrayBuffer());
      return saveBuffer(userId, buffer, contentType);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 删除一组 objectKey(TTL 清理 / 用户删除)。逐个删除,失败不中断,统计结果。
   */
  async function deleteKeys(userId, objectKeys) {
    const keys = Array.isArray(objectKeys) ? objectKeys : [];
    let success = 0;
    let failed = 0;
    for (const key of keys) {
      try {
        await storage.removeObject(userId, key);
        success += 1;
      } catch (error) {
        failed += 1;
        console.warn(`[task-images] 删除对象失败: ${key}`, error?.message || error);
      }
    }
    return { total: keys.length, success, failed };
  }

  return { saveBuffer, saveFromUrl, deleteKeys };
}

module.exports = { createTaskImageService, extFromMime };
