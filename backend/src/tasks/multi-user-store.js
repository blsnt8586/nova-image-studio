'use strict';

/**
 * multi-user TaskStore(阶段 4)。task-engine 通过此契约持久化生图任务:
 * 持久化走 PG(tasksRepo,强制 user_id 隔离),图片本体落 MinIO(images 服务),
 * task_items 存 object_keys;序列化时为每个 key 签发预签名 GET url。
 *
 * @param {object} deps
 * @param {object} deps.tasksRepo 阶段4 仓储(含 getTaskOwner)
 * @param {{ saveBuffer, saveFromUrl, deleteKeys }} deps.images
 * @param {{ presignGet }} deps.storage
 */
function createMultiUserTaskStore(deps) {
  const { tasksRepo, images, storage } = deps;

  async function insertTask(taskId, userId, mode, requestForDb, parallelCount) {
    await tasksRepo.createTask(userId, {
      id: taskId,
      status: 'queued',
      mode,
      requestJson: requestForDb,
    });
    for (let index = 0; index < parallelCount; index += 1) {
      await tasksRepo.createItem(userId, { taskId, itemIndex: index, status: 'queued' });
    }
  }

  async function getRequest(taskId, userId) {
    const task = await tasksRepo.getTask(userId, taskId);
    if (!task) return { request: null, status: null };
    return { request: task.requestJson, status: task.status };
  }

  async function markProcessing(taskId, userId, parallelCount) {
    await tasksRepo.updateTask(userId, taskId, { status: 'processing' });
    for (let index = 0; index < parallelCount; index += 1) {
      await tasksRepo.updateItem(userId, taskId, index, { status: 'processing' });
    }
  }

  async function saveItemImages(taskId, userId, index, imageList) {
    const keys = [];
    for (const img of imageList) {
      let key;
      if (img.kind === 'url') {
        key = await images.saveFromUrl(userId, img.data);
      } else {
        const buffer = Buffer.from(img.data, 'base64');
        key = await images.saveBuffer(userId, buffer, img.mime || 'image/png');
      }
      keys.push(key);
    }
    await tasksRepo.updateItem(userId, taskId, index, {
      status: 'completed',
      objectKeys: keys,
      completedAt: new Date(),
    });
    return keys;
  }

  async function markItemFailed(taskId, userId, index, message) {
    await tasksRepo.updateItem(userId, taskId, index, {
      status: 'failed',
      error: message,
      completedAt: new Date(),
    });
  }

  async function finalizeTask(taskId, userId, { images: keys, errors, ttlMs }) {
    const expiresAt = new Date(Date.now() + ttlMs);
    if (keys.length > 0) {
      const warning = errors.length > 0 ? `${errors.length} 张图片生成失败: ${errors.join('; ')}` : null;
      await tasksRepo.updateTask(userId, taskId, {
        status: 'completed',
        resultJson: { imageKeys: keys },
        warning,
        completedAt: new Date(),
        expiresAt,
      });
    } else {
      await tasksRepo.updateTask(userId, taskId, {
        status: 'failed',
        error: `所有图片生成失败: ${errors.join('; ')}`,
        completedAt: new Date(),
        expiresAt,
      });
    }
  }

  async function collectKeys(userId, taskId) {
    const items = await tasksRepo.listItems(userId, taskId);
    return items.flatMap((it) => (Array.isArray(it.objectKeys) ? it.objectKeys : []));
  }

  async function serialize(taskId, userId) {
    const task = await tasksRepo.getTask(userId, taskId);
    if (!task) return null;
    if (task.expiresAt && new Date(task.expiresAt).getTime() <= Date.now()) {
      return { id: task.id, status: 'expired', error: '该任务已超出取回时间' };
    }
    let result;
    if (task.status === 'completed') {
      const keys = await collectKeys(userId, taskId);
      const urls = await Promise.all(keys.map(async (key) => {
        const out = await storage.presignGet(userId, key);
        // 加 URL: 前缀:告诉前端这是远程图片,需先下载缓存为本地 blob 再 ack。
        // 预签名 URL 是临时的(ack 后约 2 分钟服务端清理对象),不加前缀前端会走
        // "已是本地持久图"快路径直接存裸 URL 并立即 ack,清理后图就 404 了。
        return `URL:${out.url}`;
      }));
      result = { images: urls };
    }
    return {
      id: task.id,
      status: task.status,
      mode: task.mode,
      result,
      error: task.error,
      warning: task.warning,
      createdAt: task.createdAt,
      completedAt: task.completedAt,
      expiresAt: task.expiresAt,
    };
  }

  async function deleteTask(taskId, userId) {
    const keys = await collectKeys(userId, taskId);
    try {
      await images.deleteKeys(userId, keys);
    } catch (err) {
      console.warn('[multi-user-store] 删除图片失败,仍删任务记录:', err && err.message ? err.message : err);
    }
    await tasksRepo.removeTask(userId, taskId);
  }

  async function findExpiredIds(now) {
    const rows = await tasksRepo.findExpired(now);
    return rows.map((r) => r.id);
  }

  async function getOwner(taskId) {
    const owner = await tasksRepo.getTaskOwner(taskId);
    return owner === undefined || owner === null ? null : String(owner);
  }

  return {
    insertTask,
    getRequest,
    markProcessing,
    saveItemImages,
    markItemFailed,
    finalizeTask,
    serialize,
    deleteTask,
    findExpiredIds,
    getOwner,
  };
}

module.exports = { createMultiUserTaskStore };
