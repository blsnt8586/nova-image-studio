'use strict';

const { z } = require('zod');
const { ok, fail, send } = require('../http/response');
const { withAuth } = require('../auth/with-auth');
const { readJsonBody } = require('../http/body');
const { isOwnedKey, ALLOWED_TYPES } = require('../storage/s3');

/** 每用户云端图片默认上限(素材库 / 生图历史各自独立计数)。 */
const DEFAULT_USER_LIMIT = 50;

const canvasCreateSchema = z.object({
  name: z.string().max(200).optional(),
  snapshotJson: z.unknown().refine((v) => v !== undefined, '缺少 snapshotJson'),
});

const canvasUpdateSchema = z.object({
  name: z.string().max(200).optional(),
  snapshotJson: z.unknown().optional(),
});

const generationCreateSchema = z.object({
  mode: z.string().min(1),
  modelId: z.string().optional(),
  prompt: z.string().optional(),
  objectKey: z.string().min(1),
  contentHash: z.string().min(1).max(128).optional(),
});

const assetCreateSchema = z.object({
  objectKey: z.string().min(1),
  mime: z.string().optional(),
  size: z.number().nonnegative().optional(),
  kind: z.string().optional(),
  name: z.string().optional(),
  contentHash: z.string().min(1).max(128).optional(),
});

// 单个设置键的值任意可 JSON 序列化;仅限制 key 形态与长度,防滥用。
const settingPutSchema = z.object({
  value: z.unknown().refine((v) => v !== undefined, '缺少 value'),
});

// 设置键白名单:只允许已知的偏好键写入,避免被当成任意 KV 滥用。
const ALLOWED_SETTING_KEYS = Object.freeze([
  'nova-model-registry',
  'nova-t2i-settings',
  'nova-i2i-settings',
  'nova-reverse-prompt-settings',
  'nova-gif-settings',
  'nova-assets-settings',
  'nova-agent-params',
  'nova-agent-web-search',
  'nova-agent-intent-recognition',
  'theme',
  'nova-text-assets',
]);

const presignSchema = z.union([
  z.object({
    op: z.literal('put'),
    type: z.enum(ALLOWED_TYPES),
    ext: z.string().optional(),
    contentType: z.string().optional(),
  }),
  z.object({
    op: z.literal('get'),
    objectKey: z.string().min(1),
  }),
]);

/** 把 zod 解析包成 {ok,data}|{ok:false,error}。 */
function parse(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const msg = result.error.issues.map((i) => i.message).join('; ') || '参数校验失败';
    return { ok: false, error: msg };
  }
  return { ok: true, data: result.data };
}

/**
 * 业务资源路由(canvases/generations/assets/presign)。
 * 全部经 withAuth 鉴权,userId 取自代验身份;仓储强制 user_id 过滤。
 *
 * @param {object} deps
 * @param {Function} deps.verify
 * @param {object} deps.canvasesRepo
 * @param {object} deps.generationsRepo
 * @param {object} deps.assetsRepo
 * @param {{ presignPut, presignGet }} deps.storage
 * @returns {{ handle: (req, res, pathname) => Promise<boolean> }}
 */
function createResourceRoutes(deps) {
  const { verify, canvasesRepo, generationsRepo, assetsRepo, settingsRepo, storage } = deps;

  // 每用户云端图片上限(素材/生图各自独立)。可由 deps.limits 覆盖,缺省 50。
  const limits = {
    generations: Number(deps.limits && deps.limits.generations) || DEFAULT_USER_LIMIT,
    assets: Number(deps.limits && deps.limits.assets) || DEFAULT_USER_LIMIT,
  };

  /**
   * 写入前的去重 + 上限闸门。
   * - 命中去重(同用户同 contentHash 已存在):返回 { dedup: true, row }。
   * - 未命中但已达上限:返回 { overLimit: true, limit }。
   * - 否则返回 { ok: true }(调用方继续 create)。
   */
  async function gateCreate(repo, userId, contentHash, limit) {
    if (contentHash) {
      const existing = await repo.findByHash(userId, contentHash);
      if (existing) return { dedup: true, row: existing };
    }
    const count = await repo.countByUser(userId);
    if (count >= limit) return { overLimit: true, limit };
    return { ok: true };
  }

  const limitMessage = (limit) =>
    `云端图片已达上限(${limit} 张),新图片已保留在本地但未同步到云端。请先导出/备份后删除部分旧图片再继续。`;

  // ---- canvases ----
  async function canvasesCollection(req, res, ctx) {
    if (req.method === 'GET') {
      const rows = await canvasesRepo.list(ctx.userId);
      return send(res, 200, ok(rows));
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const v = parse(canvasCreateSchema, body);
      if (!v.ok) return send(res, 400, fail(v.error));
      const row = await canvasesRepo.create(ctx.userId, v.data);
      return send(res, 201, ok(row));
    }
    return send(res, 405, fail('方法不允许'));
  }

  async function canvasesItem(req, res, ctx, id) {
    if (req.method === 'GET') {
      const row = await canvasesRepo.getById(ctx.userId, id);
      if (!row) return send(res, 404, fail('画布不存在'));
      return send(res, 200, ok(row));
    }
    if (req.method === 'PUT') {
      const body = await readJsonBody(req);
      const v = parse(canvasUpdateSchema, body);
      if (!v.ok) return send(res, 400, fail(v.error));
      const row = await canvasesRepo.update(ctx.userId, id, v.data);
      if (!row) return send(res, 404, fail('画布不存在'));
      return send(res, 200, ok(row));
    }
    if (req.method === 'DELETE') {
      await canvasesRepo.remove(ctx.userId, id);
      return send(res, 200, ok({ id }));
    }
    return send(res, 405, fail('方法不允许'));
  }

  // ---- generations ----
  async function generationsCollection(req, res, ctx) {
    if (req.method === 'GET') {
      const rows = await generationsRepo.list(ctx.userId);
      return send(res, 200, ok(rows));
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const v = parse(generationCreateSchema, body);
      if (!v.ok) return send(res, 400, fail(v.error));
      if (!isOwnedKey(ctx.userId, v.data.objectKey)) {
        return send(res, 400, fail('objectKey 不属于当前用户'));
      }
      const gate = await gateCreate(generationsRepo, ctx.userId, v.data.contentHash, limits.generations);
      if (gate.dedup) return send(res, 200, ok(gate.row));
      if (gate.overLimit) return send(res, 409, fail(limitMessage(gate.limit)));
      const row = await generationsRepo.create(ctx.userId, v.data);
      return send(res, 201, ok(row));
    }
    return send(res, 405, fail('方法不允许'));
  }

  async function generationsItem(req, res, ctx, id) {
    if (req.method === 'DELETE') {
      await generationsRepo.remove(ctx.userId, id);
      return send(res, 200, ok({ id }));
    }
    return send(res, 405, fail('方法不允许'));
  }

  // ---- assets ----
  async function assetsCollection(req, res, ctx) {
    if (req.method === 'GET') {
      const rows = await assetsRepo.list(ctx.userId);
      return send(res, 200, ok(rows));
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const v = parse(assetCreateSchema, body);
      if (!v.ok) return send(res, 400, fail(v.error));
      if (!isOwnedKey(ctx.userId, v.data.objectKey)) {
        return send(res, 400, fail('objectKey 不属于当前用户'));
      }
      const gate = await gateCreate(assetsRepo, ctx.userId, v.data.contentHash, limits.assets);
      if (gate.dedup) return send(res, 200, ok(gate.row));
      if (gate.overLimit) return send(res, 409, fail(limitMessage(gate.limit)));
      const row = await assetsRepo.create(ctx.userId, v.data);
      return send(res, 201, ok(row));
    }
    return send(res, 405, fail('方法不允许'));
  }

  async function assetsItem(req, res, ctx, id) {
    if (req.method === 'DELETE') {
      await assetsRepo.remove(ctx.userId, id);
      return send(res, 200, ok({ id }));
    }
    return send(res, 405, fail('方法不允许'));
  }

  // ---- settings (用户偏好 KV) ----
  async function settingsCollection(req, res, ctx) {
    if (req.method === 'GET') {
      const rows = settingsRepo ? await settingsRepo.list(ctx.userId) : [];
      // 投影成 { key: value } 字典,前端直接水合 localStorage
      const map = {};
      for (const row of rows) map[row.key] = row.value;
      return send(res, 200, ok(map));
    }
    return send(res, 405, fail('方法不允许'));
  }

  async function settingsItem(req, res, ctx, key) {
    if (!ALLOWED_SETTING_KEYS.includes(key)) {
      return send(res, 400, fail('不支持的设置键'));
    }
    if (!settingsRepo) return send(res, 503, fail('设置存储未启用'));
    if (req.method === 'PUT') {
      const body = await readJsonBody(req);
      const v = parse(settingPutSchema, body);
      if (!v.ok) return send(res, 400, fail(v.error));
      await settingsRepo.put(ctx.userId, key, v.data.value);
      return send(res, 200, ok({ key }));
    }
    if (req.method === 'DELETE') {
      await settingsRepo.remove(ctx.userId, key);
      return send(res, 200, ok({ key }));
    }
    return send(res, 405, fail('方法不允许'));
  }

  // ---- presign ----
  async function presign(req, res, ctx) {
    if (req.method !== 'POST') return send(res, 405, fail('方法不允许'));
    const body = await readJsonBody(req);
    const v = parse(presignSchema, body);
    if (!v.ok) return send(res, 400, fail(v.error));
    try {
      if (v.data.op === 'put') {
        const out = await storage.presignPut(ctx.userId, v.data.type, v.data.ext || 'bin', v.data.contentType);
        return send(res, 200, ok(out));
      }
      const out = await storage.presignGet(ctx.userId, v.data.objectKey);
      return send(res, 200, ok(out));
    } catch (err) {
      // 存储层对越权 key 抛错 → 403
      return send(res, 403, fail(err && err.message ? err.message : '无权访问该对象'));
    }
  }

  // 路由表:把 collection/item handler 用 withAuth 包好
  const authed = (h) => withAuth(h, { verify });

  const canvasesCollectionH = authed((req, res, ctx) => canvasesCollection(req, res, ctx));
  const generationsCollectionH = authed((req, res, ctx) => generationsCollection(req, res, ctx));
  const assetsCollectionH = authed((req, res, ctx) => assetsCollection(req, res, ctx));
  const settingsCollectionH = authed((req, res, ctx) => settingsCollection(req, res, ctx));
  const presignH = authed((req, res, ctx) => presign(req, res, ctx));

  function itemHandler(itemFn, id) {
    return authed((req, res, ctx) => itemFn(req, res, ctx, id));
  }

  async function handle(req, res, pathname) {
    const path = pathname.replace(/\/+$/, '') || '/';

    if (path === '/api/storage/presign') { await presignH(req, res); return true; }

    if (path === '/api/canvases') { await canvasesCollectionH(req, res); return true; }
    if (path.startsWith('/api/canvases/')) {
      const id = decodeURIComponent(path.slice('/api/canvases/'.length));
      if (id) { await itemHandler(canvasesItem, id)(req, res); return true; }
    }

    if (path === '/api/generations') { await generationsCollectionH(req, res); return true; }
    if (path.startsWith('/api/generations/')) {
      const id = decodeURIComponent(path.slice('/api/generations/'.length));
      if (id) { await itemHandler(generationsItem, id)(req, res); return true; }
    }

    if (path === '/api/assets') { await assetsCollectionH(req, res); return true; }
    if (path.startsWith('/api/assets/')) {
      const id = decodeURIComponent(path.slice('/api/assets/'.length));
      if (id) { await itemHandler(assetsItem, id)(req, res); return true; }
    }

    if (path === '/api/settings') { await settingsCollectionH(req, res); return true; }
    if (path.startsWith('/api/settings/')) {
      const key = decodeURIComponent(path.slice('/api/settings/'.length));
      if (key) { await itemHandler(settingsItem, key)(req, res); return true; }
    }

    return false;
  }

  return { handle };
}

module.exports = { createResourceRoutes };
