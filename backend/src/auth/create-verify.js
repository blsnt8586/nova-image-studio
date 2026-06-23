'use strict';

const { verifyToken } = require('./verify');
const { getRedis } = require('../cache/redis');

/**
 * 用运行时配置构造绑定好依赖的 `verify(token)`,供 withAuth/withAdmin 使用。
 *
 * @param {object} config loadConfig() 的结果
 * @param {object} [overrides] 测试可注入 redis / fetchImpl
 * @returns {(token: string) => Promise<object|null>}
 */
function createVerify(config, overrides = {}) {
  const redis = overrides.redis || getRedis(config.redisUrl);
  const fetchImpl = overrides.fetchImpl || globalThis.fetch;
  const deps = {
    redis,
    fetchImpl,
    baseUrl: config.sub2apiBaseUrl,
    cacheTtl: config.tokenCacheTtl,
  };
  return (token) => verifyToken(token, deps);
}

module.exports = { createVerify };
