'use strict';

const { ok, fail, send } = require('../http/response');
const { withAuth } = require('../auth/with-auth');

/**
 * 多用户任务路由(阶段 4)。从 server.js 的单机 SQLite 任务接口迁出,
 * 全部经 withAuth 鉴权,userId 取自代验身份;仓储/存储强制按 user_id 隔离。
 *
 *   GET    /api/tasks        列出当前用户的任务
 *   GET    /api/tasks/:id    取任务详情(含子项与图片预签名 GET url)
 *   DELETE /api/tasks/:id    删除任务(先删 MinIO 图片,再删 PG 记录)
 *
 * @param {object} deps
 * @param {Function} deps.verify
 * @param {object} deps.tasksRepo
 * @param {{ deleteKeys: Function }} deps.images
 * @param {{ presignGet: Function }} deps.storage
 * @returns {{ handle: (req, res, pathname) => Promise<boolean> }}
 */
function createTaskRoutes(deps) {
  const { verify, tasksRepo, images, storage } = deps;

  function itemKeys(item) {
    return Array.isArray(item.objectKeys) ? item.objectKeys : [];
  }

  async function listCollection(req, res, ctx) {
    if (req.method !== 'GET') return send(res, 405, fail('方法不允许'));
    const rows = await tasksRepo.listTasks(ctx.userId);
    return send(res, 200, ok(rows));
  }

  async function getItem(req, res, ctx, id) {
    if (req.method === 'GET') {
      const task = await tasksRepo.getTask(ctx.userId, id);
      if (!task) return send(res, 404, fail('任务不存在'));
      const items = await tasksRepo.listItems(ctx.userId, id);
      const withUrls = await Promise.all(items.map(async (item) => {
        const urls = await Promise.all(itemKeys(item).map(async (key) => {
          const out = await storage.presignGet(ctx.userId, key);
          return out.url;
        }));
        return { ...item, urls };
      }));
      return send(res, 200, ok({ ...task, items: withUrls }));
    }

    if (req.method === 'DELETE') {
      const task = await tasksRepo.getTask(ctx.userId, id);
      if (!task) return send(res, 404, fail('任务不存在'));
      const items = await tasksRepo.listItems(ctx.userId, id);
      const keys = items.flatMap(itemKeys);
      try {
        await images.deleteKeys(ctx.userId, keys);
      } catch (err) {
        // 尽力删图,失败仍继续删记录,避免脏数据
        console.warn('[tasks] 删除图片失败,仍删任务记录:', err && err.message ? err.message : err);
      }
      await tasksRepo.removeTask(ctx.userId, id);
      return send(res, 200, ok({ id, deleted: true }));
    }

    return send(res, 405, fail('方法不允许'));
  }

  const authed = (h) => withAuth(h, { verify });
  const collectionH = authed((req, res, ctx) => listCollection(req, res, ctx));
  const itemH = (id) => authed((req, res, ctx) => getItem(req, res, ctx, id));

  async function handle(req, res, pathname) {
    const path = pathname.replace(/\/+$/, '') || '/';

    if (path === '/api/tasks') {
      await collectionH(req, res);
      return true;
    }
    if (path.startsWith('/api/tasks/')) {
      const id = decodeURIComponent(path.slice('/api/tasks/'.length));
      if (id) {
        await itemH(id)(req, res);
        return true;
      }
    }
    return false;
  }

  return { handle };
}

module.exports = { createTaskRoutes };
