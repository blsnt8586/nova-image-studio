'use strict';

const Redis = require('ioredis');

let client = null;

/**
 * 获取(惰性创建)单例 Redis 客户端。
 * @param {string} redisUrl
 * @returns {import('ioredis').Redis}
 */
function getRedis(redisUrl) {
  if (!client) {
    client = new Redis(redisUrl, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
    });
    client.on('error', (err) => {
      // 不让 Redis 抖动直接 crash 进程;代验侧已对缓存失败做降级
      console.error('[redis] error:', err.message);
    });
  }
  return client;
}

/**
 * 关闭 Redis 连接(用于优雅退出 / 测试清理)。
 */
async function closeRedis() {
  if (client) {
    await client.quit();
    client = null;
  }
}

module.exports = { getRedis, closeRedis };
