'use strict';

const { createHash } = require('crypto');

const KEYS_PATH = '/api/v1/keys';
const CACHE_PREFIX = 'nova:key:';

/**
 * 构造 keyId→sk-key 的缓存 key。
 * 以「userId + keyId」为命名空间,并对 token 做 sha256 摘要参与 key,
 * 既隔离不同会话又避免明文 token 落 Redis。
 * @param {string|number} userId
 * @param {string|number} keyId
 * @param {string} token
 * @returns {string}
 */
function __cacheKeyFor(userId, keyId, token) {
  const digest = createHash('sha256').update(String(token)).digest('hex').slice(0, 16);
  return `${CACHE_PREFIX}${userId}:${keyId}:${digest}`;
}

/**
 * 构造携带 HTTP 状态语义的错误(供上层映射 503)。
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
 * 从 sub2api /api/v1/keys 分页响应里取出 items 数组。
 * @param {*} body 形如 { code, data: { items: [...] } }
 * @returns {Array<object>}
 */
function extractItems(body) {
  const data = body && typeof body === 'object' ? body.data : null;
  const items = data && Array.isArray(data.items) ? data.items : null;
  return items || [];
}

/**
 * 拉取当前用户的 API key 列表(完整,含 sk- 本体)。
 * 仅在后端内部使用,绝不直接外泄。
 * @param {object} deps
 * @param {string} token
 * @returns {Promise<Array<object>|null>} 401/403 → null;不可达抛 503。
 */
async function fetchKeys(deps, token) {
  const { fetchImpl, baseUrl } = deps;
  let res;
  try {
    res = await fetchImpl(`${baseUrl}${KEYS_PATH}?page=1&page_size=100`, {
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
    throw httpError(`sub2api keys failed: ${res.status}`, 503);
  }

  let body;
  try {
    body = await res.json();
  } catch (err) {
    throw httpError(`sub2api bad json: ${err.message}`, 503);
  }
  return extractItems(body);
}

/**
 * 创建 sub2api API Key 客户端。
 *
 * - listKeys:脱敏列表(只回 id/name/status),供前端下拉。
 * - resolveKey:把 keyId 解析为 sk- 本体,带短 TTL 缓存。sk- key 不出后端。
 *
 * @param {object} deps
 * @param {Function} deps.fetchImpl
 * @param {string} deps.baseUrl sub2api base url
 * @param {object} [deps.redis] ioredis 客户端(get/set),可空
 * @param {number} [deps.cacheTtl=30] 解析结果缓存秒数
 * @returns {{ listKeys, resolveKey }}
 */
function createKeysClient(deps) {
  const { redis, cacheTtl = 30 } = deps;

  /**
   * 脱敏列表:剔除 key 本体,只回展示所需字段。
   * @param {string} token
   * @returns {Promise<Array<{id,name,status}>|null>}
   */
  async function listKeys(token) {
    const items = await fetchKeys(deps, token);
    if (items === null) {
      return null;
    }
    return items.map((k) => ({ id: k.id, name: k.name, status: k.status }));
  }

  /**
   * 把 keyId 解析为 sk- 本体。keyId 为空时回落到第一个 key。
   * @param {object} args
   * @param {string} args.token JWT
   * @param {string|number|null} args.keyId 选中的 key id(可空)
   * @param {string|number} args.userId 已代验身份(用于缓存命名空间)
   * @returns {Promise<string|null>} 命中返回 sk- key;无匹配返回 null;不可达抛 503。
   */
  async function resolveKey({ token, keyId, userId }) {
    const cacheKeyId = keyId === undefined || keyId === null ? '__first__' : keyId;

    // 1. 缓存命中
    if (redis) {
      try {
        const cached = await redis.get(__cacheKeyFor(userId, cacheKeyId, token));
        if (cached) {
          return cached;
        }
      } catch {
        // 缓存损坏:忽略,走代查
      }
    }

    const items = await fetchKeys(deps, token);
    if (items === null || items.length === 0) {
      return null;
    }

    let match;
    if (keyId === undefined || keyId === null) {
      match = items[0];
    } else {
      match = items.find((k) => String(k.id) === String(keyId));
    }
    if (!match || typeof match.key !== 'string' || !match.key) {
      return null;
    }

    // 3. 写缓存
    if (redis) {
      try {
        await redis.set(__cacheKeyFor(userId, cacheKeyId, token), match.key, 'EX', cacheTtl);
      } catch {
        // 缓存写失败不影响主流程
      }
    }

    return match.key;
  }

  return { listKeys, resolveKey };
}

module.exports = { createKeysClient, __cacheKeyFor };
