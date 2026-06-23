'use strict';

/**
 * 任务执行引擎(阶段 4 联调)。把 runTask 的「生成→落图→收尾」编排从 server.js 抽出,
 * 通过注入 store / generate / broadcast 解耦,既能被单测覆盖,又能在 legacy 与 multi-user
 * 两种 store 下复用。队列/并发/限流仍留在 server.js(与存储后端正交)。
 *
 * @param {object} deps
 * @param {object} deps.store TaskStore(legacy 或 multi-user)
 * @param {(apiKey, request) => Promise<string>} deps.generate 调上游生成单张图,返回原始 image 串
 * @param {(taskId) => void} deps.broadcast 任务状态变化时通知 WS 订阅者
 * @param {number} deps.ttlMs 完成后任务的存活时长
 * @param {(error) => string} [deps.normalizeError] 错误归一化
 */
function createTaskEngine(deps) {
  const { store, generate, broadcast, ttlMs } = deps;
  const normalizeError = deps.normalizeError || ((e) => (e instanceof Error ? e.message : String(e)));
  // 可排队状态集合(server.js 历史上混用 '排队中' 与 'queued');默认兼容两者。
  const queuedStatuses = new Set(deps.queuedStatuses || ['queued', '排队中']);
  const isQueued = (s) => queuedStatuses.has(s);

  async function generateItem(apiKey, request, taskId, userId, index) {
    try {
      const image = await generate(apiKey, request);
      const imageList = normalizeGeneratedImage(image);
      const keys = await store.saveItemImages(taskId, userId, index, imageList);
      return { success: true, images: keys };
    } catch (error) {
      const message = normalizeError(error);
      await store.markItemFailed(taskId, userId, index, message);
      return { success: false, error: message };
    }
  }

  async function runTask(taskId, userId, apiKey, refImages) {
    const { request, status } = await store.getRequest(taskId, userId);
    if (!request || !apiKey || !isQueued(status)) {
      return;
    }
    if (refImages && refImages.length > 0) {
      request.images = refImages;
    }

    const parallelCount = request.parallelCount || 1;
    await store.markProcessing(taskId, userId, parallelCount);
    broadcast(taskId);

    const itemResults = await Promise.allSettled(
      Array.from({ length: parallelCount }, (_, index) =>
        generateItem(apiKey, request, taskId, userId, index)),
    );

    const images = [];
    const errors = [];
    for (const result of itemResults) {
      if (result.status === 'fulfilled' && result.value.success) {
        images.push(...result.value.images);
      } else {
        const msg = result.status === 'fulfilled' ? result.value.error : normalizeError(result.reason);
        errors.push(msg);
      }
    }

    await store.finalizeTask(taskId, userId, { images, errors, ttlMs });
    broadcast(taskId);
  }

  return { runTask };
}

/**
 * 把上游生成结果归一化为统一的图片列表。
 * 形态:`MULTI_URL:u1|||u2`(多 url)/ `URL:remote`(单 url)/ 其余视为 base64。
 * @param {string} image
 * @returns {Array<{ kind: 'base64'|'url', data: string, mime: string }>}
 */
function normalizeGeneratedImage(image) {
  const expanded = image.startsWith('MULTI_URL:')
    ? image.substring(10).split('|||').map((url) => `URL:${url}`)
    : [image];
  return expanded.map((img) => {
    if (img.startsWith('URL:')) {
      return { kind: 'url', data: img.substring(4), mime: 'image/png' };
    }
    return { kind: 'base64', data: img, mime: 'image/png' };
  });
}

module.exports = { createTaskEngine, normalizeGeneratedImage };
