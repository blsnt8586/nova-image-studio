'use strict';

/**
 * PG 任务网关(阶段 4 全量切换)。把 server.js 队列循环需要的「跨用户」任务操作
 * 统一封装在 multiUserTaskStore(按 user_id 隔离持久化 + MinIO)之上:
 *  - 全局队列统计(getQueueCounts):跨用户按 status 计数
 *  - 建任务 / 跑任务 / 序列化 / 删除 / 过期清理 / ack 续期
 *
 * 队列只持有 taskId,而 store/engine 的所有写操作都要 user_id。为避免热路径(drainQueue)
 * 反复查库,网关在进程内缓存 taskId→{userId, parallelCount};缓存未命中(如重启后)
 * 回退到 tasksRepo 按 task id 反查归属与 request_json.parallelCount。
 *
 * @param {object} deps
 * @param {object} deps.tasksRepo 含 countActiveByStatus/getById/getTaskOwner/setExpiry
 * @param {object} deps.store multiUserTaskStore(insertTask/serialize/deleteTask/findExpiredIds)
 * @param {object} deps.engine task-engine(runTask(taskId,userId,apiKey,refImages))
 */
function createPgTaskGateway(deps) {
  const { tasksRepo, store, engine } = deps;

  // 进程内运行时缓存,避免 drainQueue 热路径查库。任务终态/删除后清理。
  const owners = new Map(); // taskId -> userId
  const parallelCounts = new Map(); // taskId -> number

  async function getQueueCounts() {
    const counts = await tasksRepo.countActiveByStatus(['queued', 'processing']);
    return {
      queuedCount: Number(counts.queued || 0),
      processingCount: Number(counts.processing || 0),
    };
  }

  async function createTask(userId, { taskId, mode, requestForDb, parallelCount }) {
    await store.insertTask(taskId, userId, mode, requestForDb, parallelCount);
    owners.set(taskId, userId);
    parallelCounts.set(taskId, parallelCount);
  }

  /** 取并发数:优先内存缓存,否则回退 DB request_json.parallelCount,再否则 1。 */
  async function getParallelCount(taskId) {
    if (parallelCounts.has(taskId)) return parallelCounts.get(taskId);
    const row = await tasksRepo.getById(taskId);
    const n = row && row.requestJson ? Number(row.requestJson.parallelCount) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  /** 解析任务归属:优先内存缓存,否则回退 tasksRepo.getTaskOwner。 */
  async function resolveOwner(taskId) {
    if (owners.has(taskId)) return owners.get(taskId);
    const owner = await tasksRepo.getTaskOwner(taskId);
    return owner === undefined || owner === null ? null : String(owner);
  }

  async function runTask(taskId, apiKey, refImages) {
    const userId = await resolveOwner(taskId);
    if (!userId) return; // 无归属(已删/重启失败) → 跳过
    await engine.runTask(taskId, userId, apiKey, refImages);
  }

  async function serialize(taskId) {
    const row = await tasksRepo.getById(taskId);
    if (!row) return null;
    return store.serialize(taskId, String(row.userId));
  }

  async function deleteTask(taskId) {
    let userId;
    if (owners.has(taskId)) {
      userId = owners.get(taskId);
    } else {
      const row = await tasksRepo.getById(taskId);
      if (!row) return;
      userId = String(row.userId);
    }
    await store.deleteTask(taskId, userId);
    owners.delete(taskId);
    parallelCounts.delete(taskId);
  }

  async function touchExpiry(taskId, expiresAt) {
    await tasksRepo.setExpiry(taskId, expiresAt);
  }

  async function listExpiredIds(now) {
    return store.findExpiredIds(now);
  }

  /** 任务终态后清理运行时缓存(不动持久化)。 */
  function cleanupRuntime(taskId) {
    owners.delete(taskId);
    parallelCounts.delete(taskId);
  }

  /**
   * 重启恢复:把残留的 queued/processing 任务标记为 failed 并设 TTL,
   * 由周期性 TTL 清理顺带删除其 MinIO 对象与 PG 行。返回被中断的 id 列表。
   */
  async function recoverInterrupted({ message, ttlMs }) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    return tasksRepo.failActiveTasks(message, now, expiresAt);
  }

  return {
    getQueueCounts,
    createTask,
    getParallelCount,
    runTask,
    serialize,
    deleteTask,
    touchExpiry,
    listExpiredIds,
    cleanupRuntime,
    recoverInterrupted,
  };
}

module.exports = { createPgTaskGateway };
