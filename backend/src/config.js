'use strict';

const REQUIRED = [
  'DATABASE_URL',
  'REDIS_URL',
  'SUB2API_BASE_URL',
  'S3_ENDPOINT',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'S3_BUCKET',
];

/**
 * 从环境变量对象构造强类型配置。缺失必填项时抛出聚合错误。
 * 不读 process.env 之外的副作用,纯函数,便于单测。
 *
 * @param {Record<string, string|undefined>} [env=process.env]
 * @returns {{
 *   databaseUrl: string,
 *   redisUrl: string,
 *   sub2apiBaseUrl: string,
 *   tokenCacheTtl: number,
 *   limits: { assets: number, generations: number },
 *   s3: { endpoint: string, accessKey: string, secretKey: string, bucket: string, region: string, publicBaseUrl: string|null }
 * }}
 */
function loadConfig(env = process.env) {
  const missing = REQUIRED.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`缺少必填环境变量: ${missing.join(', ')}`);
  }

  const ttl = Number(env.TOKEN_CACHE_TTL);

  const posIntOr = (raw, fallback) => {
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };

  return {
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    sub2apiBaseUrl: env.SUB2API_BASE_URL.replace(/\/+$/, ''),
    tokenCacheTtl: Number.isFinite(ttl) && ttl > 0 ? ttl : 60,
    // 每用户云端图片上限(素材库 / 生图历史各自独立),缺省 50。
    limits: {
      assets: posIntOr(env.USER_ASSET_LIMIT, 50),
      generations: posIntOr(env.USER_GENERATION_LIMIT, 50),
    },
    s3: {
      endpoint: env.S3_ENDPOINT,
      accessKey: env.S3_ACCESS_KEY,
      secretKey: env.S3_SECRET_KEY,
      bucket: env.S3_BUCKET,
      region: env.S3_REGION || 'us-east-1',
      publicBaseUrl: env.S3_PUBLIC_BASE_URL || null,
    },
  };
}

module.exports = { loadConfig };
