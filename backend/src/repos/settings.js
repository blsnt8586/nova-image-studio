'use strict';

const drizzle = require('drizzle-orm');
const { userSettings } = require('../db/schema');

/**
 * 用户偏好设置仓储(KV)。强制 user_id 隔离;按 (user_id, key) upsert。
 */
function createSettingsRepo(deps) {
  const table = deps.table || userSettings;
  const { db } = deps;
  const ops = deps.ops || drizzle;

  /** 取该用户全部设置键值。 */
  async function list(userId) {
    return db.select().from(table)
      .where(ops.eq(table.userId, userId))
      .orderBy(ops.desc(table.updatedAt));
  }

  /** 写入(存在即更新)单个键。value 任意可 JSON 序列化值,存为 jsonb。 */
  async function put(userId, key, value) {
    const row = {
      userId,
      key: String(key),
      value,
      updatedAt: new Date(),
    };
    await db.insert(table).values(row).onConflictDoUpdate({
      target: [table.userId, table.key],
      set: { value, updatedAt: row.updatedAt },
    });
    return row;
  }

  /** 删除单个键。 */
  async function remove(userId, key) {
    await db.delete(table)
      .where(ops.and(ops.eq(table.userId, userId), ops.eq(table.key, String(key))));
  }

  return { list, put, remove };
}

module.exports = { createSettingsRepo };
