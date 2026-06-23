'use strict';

/**
 * TTL 清理(阶段 4)。扫描过期任务,先删 MinIO 图片本体,再物理删除 PG 记录。
 * MinIO 删除失败不阻止 PG 清理(尽力而为,避免脏记录永久堆积)。
 *
 * @param {object} deps
 * @param {{ findExpired: Function, listItems: Function, purgeTask: Function }} deps.tasksRepo
 * @param {{ deleteKeys: Function }} deps.images
 */
function createTtlSweeper(deps) {
  const { tasksRepo, images } = deps;

  async function sweep(now = new Date()) {
    const expired = await tasksRepo.findExpired(now);
    let purged = 0;

    for (const task of expired) {
      const items = await tasksRepo.listItems(task.userId, task.id);
      const objectKeys = items.flatMap((item) =>
        Array.isArray(item.objectKeys) ? item.objectKeys : []);

      try {
        await images.deleteKeys(task.userId, objectKeys);
      } catch (error) {
        console.warn(`[ttl-sweep] MinIO 清理失败,仍将清理 PG: taskId=${task.id}`, error?.message || error);
      }

      await tasksRepo.purgeTask(task.id);
      purged += 1;
    }

    return { tasks: purged };
  }

  return { sweep };
}

module.exports = { createTtlSweeper };
