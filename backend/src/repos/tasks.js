'use strict';

const crypto = require('crypto');
const drizzle = require('drizzle-orm');
const { tasks, taskItems } = require('../db/schema');

/**
 * 任务队列仓储(阶段 4)。强制 user_id 隔离;图片本体在 MinIO,task_items 存 object_keys。
 * 全部依赖通过注入,便于用录制型 fake db 单测,无需真实 PG。
 */
function createTasksRepo(deps) {
  const tasksTable = deps.tasksTable || tasks;
  const itemsTable = deps.itemsTable || taskItems;
  const { db } = deps;
  const ops = deps.ops || drizzle;
  const uuid = deps.uuid || crypto.randomUUID;

  async function listTasks(userId) {
    return db.select().from(tasksTable)
      .where(ops.eq(tasksTable.userId, userId))
      .orderBy(ops.desc(tasksTable.createdAt));
  }

  async function getTask(userId, id) {
    const rows = await db.select().from(tasksTable)
      .where(ops.and(ops.eq(tasksTable.userId, userId), ops.eq(tasksTable.id, id)))
      .limit(1);
    return rows[0] || null;
  }

  async function createTask(userId, data) {
    const row = {
      id: data.id || uuid(),
      userId,
      status: String(data.status || 'queued'),
      mode: String(data.mode || ''),
      requestJson: data.requestJson || {},
      resultJson: data.resultJson ?? null,
      error: data.error ?? null,
      warning: data.warning ?? null,
      createdAt: data.createdAt || new Date(),
      completedAt: data.completedAt ?? null,
      expiresAt: data.expiresAt ?? null,
    };
    const rows = await db.insert(tasksTable).values(row).returning();
    return rows[0] || row;
  }

  async function updateTask(userId, id, patch) {
    const set = {};
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.resultJson !== undefined) set.resultJson = patch.resultJson;
    if (patch.error !== undefined) set.error = patch.error;
    if (patch.warning !== undefined) set.warning = patch.warning;
    if (patch.completedAt !== undefined) set.completedAt = patch.completedAt;
    if (patch.expiresAt !== undefined) set.expiresAt = patch.expiresAt;
    const rows = await db.update(tasksTable).set(set)
      .where(ops.and(ops.eq(tasksTable.userId, userId), ops.eq(tasksTable.id, id)))
      .returning();
    return rows[0] || null;
  }

  async function removeTask(userId, id) {
    await db.delete(tasksTable)
      .where(ops.and(ops.eq(tasksTable.userId, userId), ops.eq(tasksTable.id, id)));
  }

  async function listItems(userId, taskId) {
    return db.select().from(itemsTable)
      .where(ops.and(ops.eq(itemsTable.userId, userId), ops.eq(itemsTable.taskId, taskId)))
      .orderBy(itemsTable.itemIndex);
  }

  async function createItem(userId, data) {
    const row = {
      taskId: String(data.taskId),
      itemIndex: Number(data.itemIndex) || 0,
      userId,
      status: String(data.status || 'queued'),
      objectKeys: data.objectKeys ?? null,
      error: data.error ?? null,
      createdAt: data.createdAt || new Date(),
      completedAt: data.completedAt ?? null,
    };
    const rows = await db.insert(itemsTable).values(row).returning();
    return rows[0] || row;
  }

  async function updateItem(userId, taskId, itemIndex, patch) {
    const set = {};
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.objectKeys !== undefined) set.objectKeys = patch.objectKeys;
    if (patch.error !== undefined) set.error = patch.error;
    if (patch.completedAt !== undefined) set.completedAt = patch.completedAt;
    const rows = await db.update(itemsTable).set(set)
      .where(ops.and(
        ops.eq(itemsTable.userId, userId),
        ops.eq(itemsTable.taskId, taskId),
        ops.eq(itemsTable.itemIndex, itemIndex),
      ))
      .returning();
    return rows[0] || null;
  }

  /** TTL 扫描:返回所有 expires_at < now 的任务(供清理用,需带 user_id 才能取 object_keys)。 */
  async function findExpired(now) {
    return db.select().from(tasksTable)
      .where(ops.lt(tasksTable.expiresAt, now));
  }

  /**
   * 仅按 task id 查归属 user_id(不带 user_id 过滤)。
   * 专供 WS 订阅鉴权:连接尚未确定能否访问该任务时,需要先拿到任务归属再比对。
   * 只返回 user_id,不泄漏其他字段。
   */
  async function getTaskOwner(taskId) {
    const rows = await db.select().from(tasksTable)
      .where(ops.eq(tasksTable.id, taskId))
      .limit(1);
    return rows[0] ? rows[0].userId : null;
  }

  /**
   * 按 task id 取整行(不带 user_id 过滤)。供全局队列/广播/序列化:
   * 拿到行后用行内 user_id 做后续按用户签发预签名。仅服务端内部调用。
   */
  async function getById(taskId) {
    const rows = await db.select().from(tasksTable)
      .where(ops.eq(tasksTable.id, taskId))
      .limit(1);
    return rows[0] || null;
  }

  /**
   * 全局队列统计:按 status 分组计数(跨用户)。供 getQueueStats 计算并发/排队量。
   * @param {string[]} statuses 要统计的状态白名单
   * @returns {Promise<Record<string, number>>}
   */
  async function countActiveByStatus(statuses) {
    const rows = await db
      .select({ status: tasksTable.status, count: ops.count() })
      .from(tasksTable)
      .where(ops.inArray(tasksTable.status, statuses))
      .groupBy(tasksTable.status);
    const out = {};
    for (const row of rows) out[row.status] = Number(row.count || 0);
    return out;
  }

  /**
   * 仅更新 expires_at(按 task id,不带 user_id)。供 ack 续期:
   * nova 入口任务可能无 JWT 归属,按 task id 续期即可,不泄漏其他字段。
   */
  async function setExpiry(taskId, expiresAt) {
    await db.update(tasksTable).set({ expiresAt })
      .where(ops.eq(tasksTable.id, taskId));
  }

  /**
   * 重启恢复:把所有 queued/processing 任务标记为 failed(跨用户)。
   * 返回被中断的任务 id 列表,供调用方清理对应 MinIO 对象。
   * @returns {Promise<string[]>}
   */
  async function failActiveTasks(message, failedAt, expiresAt) {
    const rows = await db.update(tasksTable)
      .set({ status: 'failed', error: message, completedAt: failedAt, expiresAt })
      .where(ops.inArray(tasksTable.status, ['queued', 'processing']))
      .returning();
    return (rows || []).map((r) => r.id);
  }

  /**
   * 物理删除一个任务及其子项(按 task id,不带 user_id —— 仅供 TTL 清理调用,
   * 调用方已通过 findExpired 拿到归属)。先删子项再删主表。
   */
  async function purgeTask(taskId) {
    await db.delete(itemsTable).where(ops.eq(itemsTable.taskId, taskId));
    await db.delete(tasksTable).where(ops.eq(tasksTable.id, taskId));
  }

  return {
    listTasks,
    getTask,
    createTask,
    updateTask,
    removeTask,
    listItems,
    createItem,
    updateItem,
    findExpired,
    getTaskOwner,
    getById,
    countActiveByStatus,
    setExpiry,
    failActiveTasks,
    purgeTask,
  };
}

module.exports = { createTasksRepo };
