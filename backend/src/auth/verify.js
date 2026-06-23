'use strict';

const { createHash } = require('crypto');

const CACHE_PREFIX = 'nova:auth:';
const PROFILE_PATH = '/api/v1/user/profile';

/**
 * 计算 token 的缓存 key(用 sha256,避免明文 token 落 Redis)。
 * @param {string} token
 * @returns {string}
 */
function __cacheKeyFor(token) {
  const hash = createHash('sha256').update(String(token)).digest('hex');
  return CACHE_PREFIX + hash;
}

/**
 * 构造一个携带 HTTP 状态语义的错误(供上层映射 503)。
 * @param {string} message
 * @param {number} status
 * @returns {Error & { status: number }}
 */
function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * 从 sub2api profile 响应里规整出身份。
 * @param {*} body 形如 { success, data: { id, role, email } }
 * @returns {{ userId: number, role: string, email: string } | null}
 */
function normalizeIdentity(body) {
  const data = body && typeof body === 'object' ? body.data : null;
  if (!data || data.id === undefined || data.id === null) {
    return null;
  }
  return {
    userId: data.id,
    role: typeof data.role === 'string' ? data.role : 'user',
    email: typeof data.email === 'string' ? data.email : '',
  };
}

/**
 * 代验 JWT:命中 Redis 缓存则直接返回;否则调 sub2api /api/v1/user/profile。
 *
 * @param {string} token JWT session token
 * @param {object} deps
 * @param {object} deps.redis ioredis 客户端(get/set)
 * @param {Function} deps.fetchImpl fetch 实现(便于注入/测试)
 * @param {string} deps.baseUrl sub2api base url
 * @param {number} deps.cacheTtl 缓存秒数
 * @returns {Promise<{ userId: number, role: string, email: string } | null>}
 *   合法返回身份;token 非法/缺失返回 null;sub2api 不可达抛 { status: 503 }。
 */
async function verifyToken(token, deps) {
  if (!token || typeof token !== 'string') {
    return null;
  }

  const { redis, fetchImpl, baseUrl, cacheTtl = 60 } = deps;
  const cacheKey = __cacheKeyFor(token);

  // 1. 缓存命中
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.userId !== undefined && parsed.userId !== null) {
          return parsed;
        }
      }
    } catch {
      // 缓存损坏:忽略,走代验
    }
  }

  // 2. 代验
  let res;
  try {
    res = await fetchImpl(baseUrl + PROFILE_PATH, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    throw httpError(`sub2api unreachable: ${err.message}`, 503);
  }

  if (res.status === 401 || res.status === 403) {
    return null;
  }
  if (!res.ok) {
    throw httpError(`sub2api profile failed: ${res.status}`, 503);
  }

  let body;
  try {
    body = await res.json();
  } catch (err) {
    throw httpError(`sub2api bad json: ${err.message}`, 503);
  }

  const identity = normalizeIdentity(body);
  if (!identity) {
    return null;
  }

  // 3. 写缓存
  if (redis) {
    try {
      await redis.set(cacheKey, JSON.stringify(identity), 'EX', cacheTtl);
    } catch {
      // 缓存写失败不影响主流程
    }
  }

  return identity;
}

module.exports = { verifyToken, __cacheKeyFor };
