import { describe, it, expect } from 'vitest';
import { createSettingsRepo } from '../src/repos/settings.js';

/**
 * 录制型 fake db:模拟 Drizzle 链式 API。settings 用 onConflictDoUpdate upsert,
 * 故额外支持 onConflictDoUpdate 链节点。
 */
function makeFakeDb(rows = []) {
  const calls = [];
  const result = { rows };

  function chain(kind) {
    const state = { kind, table: null, where: null, values: null, set: null, order: null, conflict: null };
    calls.push(state);
    const builder = {
      from(table) { state.table = table; return builder; },
      where(cond) { state.where = cond; return builder; },
      values(v) { state.values = v; return builder; },
      set(v) { state.set = v; return builder; },
      orderBy(o) { state.order = o; return builder; },
      onConflictDoUpdate(c) { state.conflict = c; return builder; },
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

const ops = {
  eq: (col, val) => ({ op: 'eq', col, val }),
  and: (...conds) => ({ op: 'and', conds }),
  desc: (col) => ({ op: 'desc', col }),
};

const table = {
  __table: 'user_settings',
  userId: 'user_settings.user_id',
  key: 'user_settings.key',
  value: 'user_settings.value',
  updatedAt: 'user_settings.updated_at',
};

function whereHasUserId(cond, userId) {
  if (!cond) return false;
  if (cond.op === 'eq') return /user_id$/.test(cond.col) && cond.val === userId;
  if (cond.op === 'and') return cond.conds.some((c) => whereHasUserId(c, userId));
  return false;
}

describe('settingsRepo isolation', () => {
  it('list filters by user_id', async () => {
    const db = makeFakeDb();
    const repo = createSettingsRepo({ db, table, ops });
    await repo.list('42');
    const sel = db.calls.find((c) => c.kind === 'select' && c.where);
    expect(whereHasUserId(sel.where, '42')).toBe(true);
  });

  it('put injects user_id/key/value and upserts on conflict', async () => {
    const db = makeFakeDb();
    const repo = createSettingsRepo({ db, table, ops });
    await repo.put('42', 'theme', 'dark');
    const ins = db.calls.find((c) => c.kind === 'insert');
    expect(ins.values.userId).toBe('42');
    expect(ins.values.key).toBe('theme');
    expect(ins.values.value).toBe('dark');
    // 必须 upsert,否则同键二次写入会主键冲突
    expect(ins.conflict).toBeTruthy();
    expect(ins.conflict.set.value).toBe('dark');
  });

  it('put accepts object values (jsonb)', async () => {
    const db = makeFakeDb();
    const repo = createSettingsRepo({ db, table, ops });
    await repo.put('42', 'nova-model-registry', { imageModels: [] });
    const ins = db.calls.find((c) => c.kind === 'insert');
    expect(ins.values.value).toEqual({ imageModels: [] });
  });

  it('remove scopes by user_id and key', async () => {
    const db = makeFakeDb();
    const repo = createSettingsRepo({ db, table, ops });
    await repo.remove('42', 'theme');
    const del = db.calls.find((c) => c.kind === 'delete');
    expect(whereHasUserId(del.where, '42')).toBe(true);
    expect(JSON.stringify(del.where)).toContain('theme');
  });

  it('list returns rows from db', async () => {
    const db = makeFakeDb([{ key: 'theme', value: 'dark' }]);
    const repo = createSettingsRepo({ db, table, ops });
    expect(await repo.list('42')).toEqual([{ key: 'theme', value: 'dark' }]);
  });

  it('falls back to default schema table when none injected', () => {
    expect(() => createSettingsRepo({ db: makeFakeDb([]) })).not.toThrow();
  });
});
