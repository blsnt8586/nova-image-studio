'use strict';

const crypto = require('crypto');
const drizzle = require('drizzle-orm');
const { generations } = require('../db/schema');

/**
 * 生图历史仓储。强制 user_id 隔离;图片本体在 MinIO,这里存 object_key。
 */
function createGenerationsRepo(deps) {
  const table = deps.table || generations;
  const { db } = deps;
  const ops = deps.ops || drizzle;
  const uuid = deps.uuid || crypto.randomUUID;

  async function list(userId) {
    return db.select().from(table)
      .where(ops.eq(table.userId, userId))
      .orderBy(ops.desc(table.createdAt));
  }

  async function getById(userId, id) {
    const rows = await db.select().from(table)
      .where(ops.and(ops.eq(table.userId, userId), ops.eq(table.id, id)))
      .limit(1);
    return rows[0] || null;
  }

  /** 按 (user_id, content_hash) 找已存在的同内容行,用于去重。空 hash 直接返回 null。 */
  async function findByHash(userId, hash) {
    if (!hash) return null;
    const rows = await db.select().from(table)
      .where(ops.and(ops.eq(table.userId, userId), ops.eq(table.contentHash, hash)))
      .limit(1);
    return rows[0] || null;
  }

  /** 统计该用户生图历史行数,用于上限判断。 */
  async function countByUser(userId) {
    const rows = await db.select({ count: ops.count() }).from(table)
      .where(ops.eq(table.userId, userId));
    return Number((rows[0] && rows[0].count) || 0);
  }

  async function create(userId, data) {
    const row = {
      id: uuid(),
      userId,
      mode: String(data.mode || ''),
      modelId: String(data.modelId || ''),
      prompt: String(data.prompt || ''),
      objectKey: String(data.objectKey || ''),
      contentHash: data.contentHash ? String(data.contentHash) : null,
      createdAt: new Date(),
    };
    const rows = await db.insert(table).values(row).returning();
    return rows[0] || row;
  }

  async function remove(userId, id) {
    await db.delete(table)
      .where(ops.and(ops.eq(table.userId, userId), ops.eq(table.id, id)));
  }

  return { list, getById, findByHash, countByUser, create, remove };
}

module.exports = { createGenerationsRepo };
