'use strict';

const crypto = require('crypto');
const drizzle = require('drizzle-orm');
const { canvases } = require('../db/schema');

/**
 * 画布仓储。所有方法第一参数为 userId,查询强制 `where user_id = ?`,
 * 保证用户只能读写自己的画布。依赖注入便于单测。
 *
 * @param {object} deps
 * @param {object} deps.db Drizzle db
 * @param {object} [deps.table] 表 schema(默认 canvases)
 * @param {{ eq, and, desc }} [deps.ops] 关系算子(默认 drizzle-orm)
 * @param {() => string} [deps.uuid]
 */
function createCanvasesRepo(deps) {
  const table = deps.table || canvases;
  const { db } = deps;
  const ops = deps.ops || drizzle;
  const uuid = deps.uuid || crypto.randomUUID;

  async function list(userId) {
    return db.select().from(table)
      .where(ops.eq(table.userId, userId))
      .orderBy(ops.desc(table.updatedAt));
  }

  async function getById(userId, id) {
    const rows = await db.select().from(table)
      .where(ops.and(ops.eq(table.userId, userId), ops.eq(table.id, id)))
      .limit(1);
    return rows[0] || null;
  }

  async function create(userId, data) {
    const now = new Date();
    const row = {
      id: uuid(),
      userId,
      name: typeof data.name === 'string' ? data.name : '',
      snapshotJson: data.snapshotJson,
      createdAt: now,
      updatedAt: now,
    };
    const rows = await db.insert(table).values(row).returning();
    return rows[0] || row;
  }

  async function update(userId, id, data) {
    const patch = { updatedAt: new Date() };
    if (typeof data.name === 'string') patch.name = data.name;
    if (data.snapshotJson !== undefined) patch.snapshotJson = data.snapshotJson;
    const rows = await db.update(table).set(patch)
      .where(ops.and(ops.eq(table.userId, userId), ops.eq(table.id, id)))
      .returning();
    return rows[0] || null;
  }

  async function remove(userId, id) {
    await db.delete(table)
      .where(ops.and(ops.eq(table.userId, userId), ops.eq(table.id, id)));
  }

  return { list, getById, create, update, remove };
}

module.exports = { createCanvasesRepo };
