'use strict';

const crypto = require('crypto');

/** 允许的资源类型,作为 MinIO key 第二段;白名单防注入。 */
const ALLOWED_TYPES = Object.freeze(['asset', 'generation', 'canvas']);

const PRESIGN_PUT_TTL = 300; // 5 分钟
const PRESIGN_GET_TTL = 3600; // 1 小时

/** userId 必须是非空、不含 '/' 的简单标识(取自代验 JWT 的 data.id)。 */
function assertValidUserId(userId) {
  if (typeof userId !== 'string' || userId.length === 0 || userId.includes('/')) {
    throw new Error('非法 userId');
  }
}

/** 归一化扩展名:去掉前导点、转小写,仅保留字母数字,非法则用 bin。 */
function normalizeExt(ext) {
  const cleaned = String(ext || '').replace(/^\.+/, '').toLowerCase();
  return /^[a-z0-9]+$/.test(cleaned) ? cleaned : 'bin';
}

/**
 * 构造对象 key:`{userId}/{type}/{uuid}.{ext}`。
 * @param {string} userId 代验得到的用户标识
 * @param {string} type 资源类型(白名单)
 * @param {string} ext 扩展名
 * @param {() => string} [uuid] 注入的 uuid 生成器(便于测试)
 * @returns {string}
 */
function buildObjectKey(userId, type, ext, uuid = crypto.randomUUID) {
  assertValidUserId(userId);
  if (!ALLOWED_TYPES.includes(type)) {
    throw new Error(`非法资源类型: ${type}`);
  }
  return `${userId}/${type}/${uuid()}.${normalizeExt(ext)}`;
}

/**
 * 判断 objectKey 是否属于该用户(前缀必须精确为 `${userId}/`)。
 * 同时拒绝穿越与绝对路径。
 * @param {string} userId
 * @param {string} objectKey
 * @returns {boolean}
 */
function isOwnedKey(userId, objectKey) {
  if (typeof userId !== 'string' || userId.length === 0) return false;
  if (typeof objectKey !== 'string' || objectKey.length === 0) return false;
  if (objectKey.startsWith('/')) return false;
  if (objectKey.includes('..')) return false;
  return objectKey.startsWith(`${userId}/`);
}

/**
 * 构造存储服务。依赖全部注入,便于单测(无需真实 S3)。
 *
 * @param {object} deps
 * @param {object} deps.client S3 客户端
 * @param {(client, command, opts) => Promise<string>} deps.getSignedUrl
 * @param {Function} deps.PutObjectCommand
 * @param {Function} deps.GetObjectCommand
 * @param {string} deps.bucket
 * @param {() => string} [deps.uuid]
 * @returns {{ presignPut: Function, presignGet: Function }}
 */
function createStorage(deps) {
  const { client, getSignedUrl, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, bucket, uuid } = deps;

  /**
   * 为上传签发预签名 PUT。key 由后端按 userId 生成,前端不可指定。
   * @returns {Promise<{ url: string, objectKey: string }>}
   */
  async function presignPut(userId, type, ext, contentType) {
    const objectKey = buildObjectKey(userId, type, ext, uuid);
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: contentType || 'application/octet-stream',
    });
    const url = await getSignedUrl(client, command, { expiresIn: PRESIGN_PUT_TTL });
    return { url, objectKey };
  }

  /**
   * 为读取签发预签名 GET。签发前校验 objectKey 属于当前用户。
   * @returns {Promise<{ url: string, objectKey: string }>}
   */
  async function presignGet(userId, objectKey) {
    if (!isOwnedKey(userId, objectKey)) {
      throw new Error('无权访问该对象');
    }
    const command = new GetObjectCommand({ Bucket: bucket, Key: objectKey });
    const url = await getSignedUrl(client, command, { expiresIn: PRESIGN_GET_TTL });
    return { url, objectKey };
  }

  /**
   * 服务端直传:由后端按 userId 生成 key 并上传 buffer(生图任务用,无需前端预签名)。
   * @returns {Promise<{ objectKey: string }>}
   */
  async function putObject(userId, type, ext, body, contentType) {
    const objectKey = buildObjectKey(userId, type, ext, uuid);
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: body,
      ContentType: contentType || 'application/octet-stream',
    });
    await client.send(command);
    return { objectKey };
  }

  /**
   * 删除对象(TTL/用户删除)。删除前校验 objectKey 属于该用户。
   */
  async function removeObject(userId, objectKey) {
    if (!isOwnedKey(userId, objectKey)) {
      throw new Error('无权删除该对象');
    }
    const command = new DeleteObjectCommand({ Bucket: bucket, Key: objectKey });
    await client.send(command);
  }

  return { presignPut, presignGet, putObject, removeObject };
}

module.exports = {
  ALLOWED_TYPES,
  PRESIGN_PUT_TTL,
  PRESIGN_GET_TTL,
  buildObjectKey,
  isOwnedKey,
  createStorage,
};
