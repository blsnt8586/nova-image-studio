'use strict';

const { Pool } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');

let pool = null;
let db = null;

/**
 * 获取(惰性创建)Drizzle DB 实例 + 底层连接池。
 * 阶段 1 仅建立连接,暂不挂业务 schema(阶段 3 引入)。
 *
 * @param {string} databaseUrl
 * @returns {{ db: import('drizzle-orm/node-postgres').NodePgDatabase, pool: import('pg').Pool }}
 */
function getDb(databaseUrl) {
  if (!db) {
    pool = new Pool({ connectionString: databaseUrl, max: 10 });
    pool.on('error', (err) => {
      console.error('[pg] pool error:', err.message);
    });
    db = drizzle(pool);
  }
  return { db, pool };
}

/**
 * 关闭连接池(优雅退出 / 测试清理)。
 */
async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}

module.exports = { getDb, closeDb };
