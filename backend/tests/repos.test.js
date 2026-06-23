import { describe, it, expect } from 'vitest';
import { createCanvasesRepo } from '../src/repos/canvases.js';
import { createGenerationsRepo } from '../src/repos/generations.js';
import { createAssetsRepo } from '../src/repos/assets.js';

/**
 * 录制型 fake db:模拟 Drizzle 链式 API,把每次查询的 where 条件录下来供断言。
 * 注入的 ops.eq/and 产出可检视的纯对象。
 */
function makeFakeDb(rows = []) {
  const calls = [];
  const result = { rows };

  function chain(kind) {
    const state = { kind, table: null, where: null, values: null, set: null, order: null, limitN: null };
    calls.push(state);
    const builder = {
      from(table) { state.table = table; return builder; },
      where(cond) { state.where = cond; return builder; },
      values(v) { state.values = v; return builder; },
      set(v) { state.set = v; return builder; },
      orderBy(o) { state.order = o; return builder; },
      limit(n) { state.limitN = n; return builder; },
      returning() { state._returning = true; return Promise.resolve(result.rows); },
      then(resolve, reject) { return Promise.resolve(result.rows).then(resolve, reject); },
    };
    return builder;
  }

  return {
    calls,
    result,
    select() { return chain('select'); },
    insert() { return chain('insert'); },
    update() { return chain('update'); },
    delete() { return chain('delete'); },
  };
}

// 可检视的关系算子
const ops = {
  eq: (col, val) => ({ op: 'eq', col, val }),
  and: (...conds) => ({ op: 'and', conds }),
  desc: (col) => ({ op: 'desc', col }),
  count: () => ({ op: 'count' }),
};

// 假表:列以可识别字符串表示
const tables = {
  canvases: { __table: 'canvases', id: 'canvases.id', userId: 'canvases.user_id', createdAt: 'canvases.created_at', updatedAt: 'canvases.updated_at' },
  generations: { __table: 'generations', id: 'generations.id', userId: 'generations.user_id', contentHash: 'generations.content_hash', createdAt: 'generations.created_at' },
  assets: { __table: 'assets', id: 'assets.id', userId: 'assets.user_id', contentHash: 'assets.content_hash', createdAt: 'assets.created_at' },
};

/** 在一个 where 条件树里递归找是否存在 user_id 的 eq 约束。 */
function whereHasUserId(cond, userId) {
  if (!cond) return false;
  if (cond.op === 'eq') return /user_id$/.test(cond.col) && cond.val === userId;
  if (cond.op === 'and') return cond.conds.some((c) => whereHasUserId(c, userId));
  return false;
}

/** 在一个 where 条件树里递归找是否存在 content_hash 的 eq 约束(值匹配)。 */
function whereHasHash(cond, hash) {
  if (!cond) return false;
  if (cond.op === 'eq') return /content_hash$/.test(cond.col) && cond.val === hash;
  if (cond.op === 'and') return cond.conds.some((c) => whereHasHash(c, hash));
  return false;
}

describe('canvasesRepo isolation', () => {
  it('list filters by user_id', async () => {
    const db = makeFakeDb();
    const repo = createCanvasesRepo({ db, table: tables.canvases, ops });
    await repo.list('42');
    const sel = db.calls.find((c) => c.kind === 'select' && c.where);
    expect(whereHasUserId(sel.where, '42')).toBe(true);
  });

  it('getById filters by both id and user_id', async () => {
    const db = makeFakeDb();
    const repo = createCanvasesRepo({ db, table: tables.canvases, ops });
    await repo.getById('42', 'c1');
    const sel = db.calls.find((c) => c.kind === 'select' && c.where);
    expect(whereHasUserId(sel.where, '42')).toBe(true);
    // 同时含 id 约束
    const flat = JSON.stringify(sel.where);
    expect(flat).toContain('c1');
  });

  it('create injects user_id into the row', async () => {
    const db = makeFakeDb();
    const repo = createCanvasesRepo({ db, table: tables.canvases, ops, uuid: () => 'new-id' });
    await repo.create('42', { name: 'My', snapshotJson: { a: 1 } });
    const ins = db.calls.find((c) => c.kind === 'insert');
    expect(ins.values.userId).toBe('42');
    expect(ins.values.id).toBe('new-id');
    expect(ins.values.name).toBe('My');
  });

  it('update scopes by user_id (cannot touch another user row)', async () => {
    const db = makeFakeDb();
    const repo = createCanvasesRepo({ db, table: tables.canvases, ops });
    await repo.update('42', 'c1', { name: 'x' });
    const upd = db.calls.find((c) => c.kind === 'update');
    expect(whereHasUserId(upd.where, '42')).toBe(true);
  });

  it('remove scopes by user_id', async () => {
    const db = makeFakeDb();
    const repo = createCanvasesRepo({ db, table: tables.canvases, ops });
    await repo.remove('42', 'c1');
    const del = db.calls.find((c) => c.kind === 'delete');
    expect(whereHasUserId(del.where, '42')).toBe(true);
  });
});

describe('generationsRepo isolation', () => {
  it('list filters by user_id', async () => {
    const db = makeFakeDb();
    const repo = createGenerationsRepo({ db, table: tables.generations, ops });
    await repo.list('7');
    const sel = db.calls.find((c) => c.kind === 'select' && c.where);
    expect(whereHasUserId(sel.where, '7')).toBe(true);
  });

  it('create injects user_id and object_key', async () => {
    const db = makeFakeDb();
    const repo = createGenerationsRepo({ db, table: tables.generations, ops, uuid: () => 'g1' });
    await repo.create('7', { mode: 'text-to-image', modelId: 'm', prompt: 'p', objectKey: '7/generation/x.png' });
    const ins = db.calls.find((c) => c.kind === 'insert');
    expect(ins.values.userId).toBe('7');
    expect(ins.values.objectKey).toBe('7/generation/x.png');
  });

  it('remove scopes by user_id', async () => {
    const db = makeFakeDb();
    const repo = createGenerationsRepo({ db, table: tables.generations, ops });
    await repo.remove('7', 'g1');
    const del = db.calls.find((c) => c.kind === 'delete');
    expect(whereHasUserId(del.where, '7')).toBe(true);
  });
});

describe('assetsRepo isolation', () => {
  it('list filters by user_id', async () => {
    const db = makeFakeDb();
    const repo = createAssetsRepo({ db, table: tables.assets, ops });
    await repo.list('9');
    const sel = db.calls.find((c) => c.kind === 'select' && c.where);
    expect(whereHasUserId(sel.where, '9')).toBe(true);
  });

  it('create injects user_id', async () => {
    const db = makeFakeDb();
    const repo = createAssetsRepo({ db, table: tables.assets, ops, uuid: () => 'a1' });
    await repo.create('9', { objectKey: '9/asset/x.png', mime: 'image/png', size: 10, kind: 'image', name: 'x' });
    const ins = db.calls.find((c) => c.kind === 'insert');
    expect(ins.values.userId).toBe('9');
    expect(ins.values.size).toBe(10);
  });

  it('getById filters by user_id', async () => {
    const db = makeFakeDb();
    const repo = createAssetsRepo({ db, table: tables.assets, ops });
    await repo.getById('9', 'a1');
    const sel = db.calls.find((c) => c.kind === 'select' && c.where);
    expect(whereHasUserId(sel.where, '9')).toBe(true);
  });

  it('remove scopes by user_id', async () => {
    const db = makeFakeDb();
    const repo = createAssetsRepo({ db, table: tables.assets, ops });
    await repo.remove('9', 'a1');
    const del = db.calls.find((c) => c.kind === 'delete');
    expect(whereHasUserId(del.where, '9')).toBe(true);
  });
});

describe('repos return-value & defaulting branches', () => {
  it('canvases.getById returns the first row when found', async () => {
    const db = makeFakeDb([{ id: 'c1', userId: '42' }]);
    const repo = createCanvasesRepo({ db, table: tables.canvases, ops });
    expect(await repo.getById('42', 'c1')).toEqual({ id: 'c1', userId: '42' });
  });

  it('canvases.getById returns null when no row', async () => {
    const db = makeFakeDb([]);
    const repo = createCanvasesRepo({ db, table: tables.canvases, ops });
    expect(await repo.getById('42', 'c9')).toBeNull();
  });

  it('canvases.create returns the returned row when present', async () => {
    const db = makeFakeDb([{ id: 'srv', userId: '42' }]);
    const repo = createCanvasesRepo({ db, table: tables.canvases, ops, uuid: () => 'x' });
    expect(await repo.create('42', { snapshotJson: {} })).toEqual({ id: 'srv', userId: '42' });
  });

  it('canvases.create defaults name to empty string when missing', async () => {
    const db = makeFakeDb([]);
    const repo = createCanvasesRepo({ db, table: tables.canvases, ops, uuid: () => 'x' });
    await repo.create('42', { snapshotJson: { a: 1 } });
    const ins = db.calls.find((c) => c.kind === 'insert');
    expect(ins.values.name).toBe('');
  });

  it('canvases.update returns null when no row updated', async () => {
    const db = makeFakeDb([]);
    const repo = createCanvasesRepo({ db, table: tables.canvases, ops });
    expect(await repo.update('42', 'c1', { name: 'x' })).toBeNull();
  });

  it('canvases.update sets snapshotJson when provided', async () => {
    const db = makeFakeDb([{ id: 'c1' }]);
    const repo = createCanvasesRepo({ db, table: tables.canvases, ops });
    await repo.update('42', 'c1', { snapshotJson: { z: 9 } });
    const upd = db.calls.find((c) => c.kind === 'update');
    expect(upd.set.snapshotJson).toEqual({ z: 9 });
  });

  it('generations.getById returns row / null', async () => {
    const found = createGenerationsRepo({ db: makeFakeDb([{ id: 'g1' }]), table: tables.generations, ops });
    expect(await found.getById('7', 'g1')).toEqual({ id: 'g1' });
    const none = createGenerationsRepo({ db: makeFakeDb([]), table: tables.generations, ops });
    expect(await none.getById('7', 'g9')).toBeNull();
  });

  it('generations.create defaults optional fields', async () => {
    const db = makeFakeDb([]);
    const repo = createGenerationsRepo({ db, table: tables.generations, ops, uuid: () => 'g' });
    await repo.create('7', { objectKey: '7/generation/x.png' });
    const ins = db.calls.find((c) => c.kind === 'insert');
    expect(ins.values.mode).toBe('');
    expect(ins.values.modelId).toBe('');
    expect(ins.values.prompt).toBe('');
  });

  it('assets.getById returns row / null', async () => {
    const found = createAssetsRepo({ db: makeFakeDb([{ id: 'a1' }]), table: tables.assets, ops });
    expect(await found.getById('9', 'a1')).toEqual({ id: 'a1' });
    const none = createAssetsRepo({ db: makeFakeDb([]), table: tables.assets, ops });
    expect(await none.getById('9', 'a9')).toBeNull();
  });

  it('assets.create coerces invalid size to 0 and defaults strings', async () => {
    const db = makeFakeDb([]);
    const repo = createAssetsRepo({ db, table: tables.assets, ops, uuid: () => 'a' });
    await repo.create('9', { objectKey: '9/asset/x.png', size: -5 });
    const ins = db.calls.find((c) => c.kind === 'insert');
    expect(ins.values.size).toBe(0);
    expect(ins.values.mime).toBe('');
    expect(ins.values.kind).toBe('');
    expect(ins.values.name).toBe('');
  });

  it('assets.create with NaN size falls back to 0', async () => {
    const db = makeFakeDb([]);
    const repo = createAssetsRepo({ db, table: tables.assets, ops, uuid: () => 'a' });
    await repo.create('9', { objectKey: '9/asset/x.png', size: 'oops' });
    const ins = db.calls.find((c) => c.kind === 'insert');
    expect(ins.values.size).toBe(0);
  });

  it('repos fall back to default schema table when none injected', () => {
    // 不传 table,走 require 的真实 schema 分支
    expect(() => createCanvasesRepo({ db: makeFakeDb([]) })).not.toThrow();
    expect(() => createGenerationsRepo({ db: makeFakeDb([]) })).not.toThrow();
    expect(() => createAssetsRepo({ db: makeFakeDb([]) })).not.toThrow();
  });
});

describe('dedup: findByHash + create persists content_hash', () => {
  it('generations.create persists contentHash', async () => {
    const db = makeFakeDb([]);
    const repo = createGenerationsRepo({ db, table: tables.generations, ops, uuid: () => 'g' });
    await repo.create('7', { objectKey: '7/generation/x.png', contentHash: 'abc123' });
    const ins = db.calls.find((c) => c.kind === 'insert');
    expect(ins.values.contentHash).toBe('abc123');
  });

  it('generations.create defaults contentHash to null when missing', async () => {
    const db = makeFakeDb([]);
    const repo = createGenerationsRepo({ db, table: tables.generations, ops, uuid: () => 'g' });
    await repo.create('7', { objectKey: '7/generation/x.png' });
    const ins = db.calls.find((c) => c.kind === 'insert');
    expect(ins.values.contentHash).toBeNull();
  });

  it('generations.findByHash filters by user_id and content_hash', async () => {
    const db = makeFakeDb([{ id: 'g1', userId: '7', contentHash: 'abc' }]);
    const repo = createGenerationsRepo({ db, table: tables.generations, ops });
    const row = await repo.findByHash('7', 'abc');
    const sel = db.calls.find((c) => c.kind === 'select' && c.where);
    expect(whereHasUserId(sel.where, '7')).toBe(true);
    expect(whereHasHash(sel.where, 'abc')).toBe(true);
    expect(row).toEqual({ id: 'g1', userId: '7', contentHash: 'abc' });
  });

  it('generations.findByHash returns null on empty hash (no query)', async () => {
    const db = makeFakeDb([{ id: 'g1' }]);
    const repo = createGenerationsRepo({ db, table: tables.generations, ops });
    expect(await repo.findByHash('7', '')).toBeNull();
    expect(db.calls.some((c) => c.kind === 'select')).toBe(false);
  });

  it('assets.create persists contentHash', async () => {
    const db = makeFakeDb([]);
    const repo = createAssetsRepo({ db, table: tables.assets, ops, uuid: () => 'a' });
    await repo.create('9', { objectKey: '9/asset/x.png', contentHash: 'hh' });
    const ins = db.calls.find((c) => c.kind === 'insert');
    expect(ins.values.contentHash).toBe('hh');
  });

  it('assets.findByHash filters by user_id and content_hash', async () => {
    const db = makeFakeDb([{ id: 'a1', userId: '9', contentHash: 'zz' }]);
    const repo = createAssetsRepo({ db, table: tables.assets, ops });
    const row = await repo.findByHash('9', 'zz');
    const sel = db.calls.find((c) => c.kind === 'select' && c.where);
    expect(whereHasUserId(sel.where, '9')).toBe(true);
    expect(whereHasHash(sel.where, 'zz')).toBe(true);
    expect(row).toEqual({ id: 'a1', userId: '9', contentHash: 'zz' });
  });
});

describe('countByUser', () => {
  it('generations.countByUser scopes by user_id and returns numeric count', async () => {
    const db = makeFakeDb([{ count: 3 }]);
    const repo = createGenerationsRepo({ db, table: tables.generations, ops });
    const n = await repo.countByUser('7');
    const sel = db.calls.find((c) => c.kind === 'select' && c.where);
    expect(whereHasUserId(sel.where, '7')).toBe(true);
    expect(n).toBe(3);
  });

  it('generations.countByUser returns 0 when no rows', async () => {
    const db = makeFakeDb([]);
    const repo = createGenerationsRepo({ db, table: tables.generations, ops });
    expect(await repo.countByUser('7')).toBe(0);
  });

  it('assets.countByUser scopes by user_id and coerces string count', async () => {
    const db = makeFakeDb([{ count: '5' }]);
    const repo = createAssetsRepo({ db, table: tables.assets, ops });
    const n = await repo.countByUser('9');
    const sel = db.calls.find((c) => c.kind === 'select' && c.where);
    expect(whereHasUserId(sel.where, '9')).toBe(true);
    expect(n).toBe(5);
  });
});
