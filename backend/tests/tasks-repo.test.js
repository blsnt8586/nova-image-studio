import { describe, it, expect } from 'vitest';
import { createTasksRepo } from '../src/repos/tasks.js';

/**
 * 录制型 fake db:模拟 Drizzle 链式 API,把每次查询的 where / values / set 录下来供断言。
 */
function makeFakeDb(rows = []) {
  const calls = [];
  const result = { rows };

  function chain(kind) {
    const state = { kind, table: null, where: null, values: null, set: null, order: null, limitN: null, group: null };
    calls.push(state);
    const builder = {
      from(table) { state.table = table; return builder; },
      where(cond) { state.where = cond; return builder; },
      values(v) { state.values = v; return builder; },
      set(v) { state.set = v; return builder; },
      orderBy(o) { state.order = o; return builder; },
      groupBy(g) { state.group = g; return builder; },
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

const ops = {
  eq: (col, val) => ({ op: 'eq', col, val }),
  and: (...conds) => ({ op: 'and', conds }),
  desc: (col) => ({ op: 'desc', col }),
  lt: (col, val) => ({ op: 'lt', col, val }),
  inArray: (col, vals) => ({ op: 'inArray', col, vals }),
  count: () => ({ op: 'count' }),
};

const tables = {
  tasks: {
    __table: 'tasks',
    id: 'tasks.id',
    userId: 'tasks.user_id',
    status: 'tasks.status',
    createdAt: 'tasks.created_at',
    expiresAt: 'tasks.expires_at',
  },
  taskItems: {
    __table: 'task_items',
    taskId: 'task_items.task_id',
    itemIndex: 'task_items.item_index',
    userId: 'task_items.user_id',
    status: 'task_items.status',
  },
};

function whereHasUserId(cond, userId) {
  if (!cond) return false;
  if (cond.op === 'eq') return /user_id$/.test(cond.col) && cond.val === userId;
  if (cond.op === 'and') return cond.conds.some((c) => whereHasUserId(c, userId));
  return false;
}

function makeRepo(rows = []) {
  const db = makeFakeDb(rows);
  const repo = createTasksRepo({ db, tasksTable: tables.tasks, itemsTable: tables.taskItems, ops, uuid: () => 'new-task' });
  return { db, repo };
}

describe('tasksRepo isolation', () => {
  it('listTasks filters by user_id', async () => {
    const { db, repo } = makeRepo();
    await repo.listTasks('42');
    const sel = db.calls.find((c) => c.kind === 'select' && c.where);
    expect(whereHasUserId(sel.where, '42')).toBe(true);
  });

  it('getTask filters by both id and user_id', async () => {
    const { db, repo } = makeRepo([{ id: 't1', userId: '42' }]);
    await repo.getTask('42', 't1');
    const sel = db.calls.find((c) => c.kind === 'select' && c.where);
    expect(whereHasUserId(sel.where, '42')).toBe(true);
    expect(JSON.stringify(sel.where)).toContain('t1');
  });

  it('getTask returns null when not found', async () => {
    const { repo } = makeRepo([]);
    expect(await repo.getTask('42', 'nope')).toBeNull();
  });

  it('createTask injects user_id and provided fields', async () => {
    const { db, repo } = makeRepo();
    await repo.createTask('42', {
      id: 't1',
      status: 'queued',
      mode: 'text-to-image',
      requestJson: { a: 1 },
      expiresAt: new Date('2030-01-01T00:00:00Z'),
    });
    const ins = db.calls.find((c) => c.kind === 'insert');
    expect(ins.values.userId).toBe('42');
    expect(ins.values.id).toBe('t1');
    expect(ins.values.mode).toBe('text-to-image');
    expect(ins.values.requestJson).toEqual({ a: 1 });
  });

  it('createTask generates id when missing', async () => {
    const { db, repo } = makeRepo();
    await repo.createTask('42', { status: 'queued', mode: 'm', requestJson: {} });
    const ins = db.calls.find((c) => c.kind === 'insert');
    expect(ins.values.id).toBe('new-task');
  });

  it('updateTask scopes by user_id and sets fields', async () => {
    const { db, repo } = makeRepo([{ id: 't1' }]);
    await repo.updateTask('42', 't1', { status: 'completed', resultJson: { ok: true } });
    const upd = db.calls.find((c) => c.kind === 'update');
    expect(whereHasUserId(upd.where, '42')).toBe(true);
    expect(upd.set.status).toBe('completed');
    expect(upd.set.resultJson).toEqual({ ok: true });
  });

  it('removeTask scopes by user_id', async () => {
    const { db, repo } = makeRepo();
    await repo.removeTask('42', 't1');
    const del = db.calls.find((c) => c.kind === 'delete');
    expect(whereHasUserId(del.where, '42')).toBe(true);
  });
});

describe('tasksRepo item operations', () => {
  it('listItems filters by task_id and user_id', async () => {
    const { db, repo } = makeRepo();
    await repo.listItems('42', 't1');
    const sel = db.calls.find((c) => c.kind === 'select' && c.where);
    expect(whereHasUserId(sel.where, '42')).toBe(true);
    expect(JSON.stringify(sel.where)).toContain('t1');
  });

  it('createItem injects user_id and task_id', async () => {
    const { db, repo } = makeRepo();
    await repo.createItem('42', { taskId: 't1', itemIndex: 0, status: 'queued' });
    const ins = db.calls.find((c) => c.kind === 'insert');
    expect(ins.values.userId).toBe('42');
    expect(ins.values.taskId).toBe('t1');
    expect(ins.values.itemIndex).toBe(0);
  });

  it('updateItem scopes by user_id + task_id + item_index', async () => {
    const { db, repo } = makeRepo([{ taskId: 't1' }]);
    await repo.updateItem('42', 't1', 0, { status: 'completed', objectKeys: ['42/generation/x.png'] });
    const upd = db.calls.find((c) => c.kind === 'update');
    expect(whereHasUserId(upd.where, '42')).toBe(true);
    expect(upd.set.objectKeys).toEqual(['42/generation/x.png']);
    const flat = JSON.stringify(upd.where);
    expect(flat).toContain('t1');
    expect(flat).toContain('item_index');
  });
});

describe('tasksRepo TTL sweep', () => {
  it('getTaskOwner returns the user_id by task id (unscoped, for WS guard)', async () => {
    const { db, repo } = makeRepo([{ userId: '42' }]);
    const owner = await repo.getTaskOwner('t1');
    const sel = db.calls.find((c) => c.kind === 'select' && c.where);
    expect(JSON.stringify(sel.where)).toContain('t1');
    expect(owner).toBe('42');
  });

  it('getTaskOwner returns null when task not found', async () => {
    const { repo } = makeRepo([]);
    expect(await repo.getTaskOwner('ghost')).toBeNull();
  });

  it('findExpired selects tasks past expires_at', async () => {
    const now = new Date('2026-06-21T00:00:00Z');
    const { db, repo } = makeRepo([{ id: 't1', userId: '42' }]);
    const expired = await repo.findExpired(now);
    const sel = db.calls.find((c) => c.kind === 'select' && c.where);
    expect(sel.where.op).toBe('lt');
    expect(sel.where.col).toMatch(/expires_at$/);
    expect(expired).toEqual([{ id: 't1', userId: '42' }]);
  });

  it('purgeTask deletes items then task (both scoped to task id)', async () => {
    const { db, repo } = makeRepo();
    await repo.purgeTask('t1');
    const dels = db.calls.filter((c) => c.kind === 'delete');
    expect(dels.length).toBe(2);
    // both deletes reference the task id
    for (const d of dels) {
      expect(JSON.stringify(d.where)).toContain('t1');
    }
  });
});

describe('tasksRepo global queue (cross-user)', () => {
  it('countActiveByStatus groups by status without user filter', async () => {
    const { db, repo } = makeRepo([
      { status: 'queued', count: 3 },
      { status: 'processing', count: 2 },
    ]);
    const counts = await repo.countActiveByStatus(['queued', 'processing']);
    const sel = db.calls.find((c) => c.kind === 'select');
    expect(sel.where.op).toBe('inArray');
    expect(sel.where.col).toMatch(/status$/);
    expect(sel.group).toBeTruthy();
    expect(counts).toEqual({ queued: 3, processing: 2 });
  });

  it('getById fetches a full row unscoped (for broadcast/serialize)', async () => {
    const { db, repo } = makeRepo([{ id: 't1', userId: '42', status: 'completed' }]);
    const row = await repo.getById('t1');
    const sel = db.calls.find((c) => c.kind === 'select' && c.where);
    expect(JSON.stringify(sel.where)).toContain('t1');
    expect(row).toEqual({ id: 't1', userId: '42', status: 'completed' });
  });

  it('getById returns null when not found', async () => {
    const { repo } = makeRepo([]);
    expect(await repo.getById('ghost')).toBeNull();
  });

  it('setExpiry updates expires_at by task id (unscoped, for ack)', async () => {
    const { db, repo } = makeRepo([{ id: 't1' }]);
    const when = new Date('2030-01-01T00:00:00Z');
    await repo.setExpiry('t1', when);
    const upd = db.calls.find((c) => c.kind === 'update');
    expect(JSON.stringify(upd.where)).toContain('t1');
    expect(upd.set.expiresAt).toBe(when);
  });

  it('failActiveTasks marks queued/processing as failed (cross-user, restart recovery)', async () => {
    const { db, repo } = makeRepo([{ id: 't1' }, { id: 't2' }]);
    const failedAt = new Date('2026-06-22T00:00:00Z');
    const expiresAt = new Date('2026-06-22T12:00:00Z');
    const ids = await repo.failActiveTasks('服务器重启，任务已中断', failedAt, expiresAt);
    const upd = db.calls.find((c) => c.kind === 'update');
    expect(upd.set.status).toBe('failed');
    expect(upd.set.error).toBe('服务器重启，任务已中断');
    expect(upd.set.completedAt).toBe(failedAt);
    expect(upd.set.expiresAt).toBe(expiresAt);
    expect(upd.where.op).toBe('inArray');
    expect(upd.where.col).toMatch(/status$/);
    expect(ids).toEqual(['t1', 't2']);
  });
});

describe('tasksRepo defaults', () => {
  it('falls back to default schema tables when none injected', () => {
    expect(() => createTasksRepo({ db: makeFakeDb([]) })).not.toThrow();
  });

  it('createTask applies all defaults when fields omitted', async () => {
    const { db, repo } = makeRepo();
    await repo.createTask('42', {});
    const ins = db.calls.find((c) => c.kind === 'insert');
    expect(ins.values.id).toBe('new-task');
    expect(ins.values.status).toBe('queued');
    expect(ins.values.mode).toBe('');
    expect(ins.values.requestJson).toEqual({});
    expect(ins.values.resultJson).toBeNull();
    expect(ins.values.error).toBeNull();
    expect(ins.values.warning).toBeNull();
    expect(ins.values.completedAt).toBeNull();
    expect(ins.values.expiresAt).toBeNull();
    expect(ins.values.createdAt).toBeInstanceOf(Date);
  });

  it('createTask returns constructed row when returning() yields nothing', async () => {
    const { repo } = makeRepo([]);
    const row = await repo.createTask('42', { id: 't1', mode: 'm', requestJson: {} });
    expect(row.id).toBe('t1');
    expect(row.userId).toBe('42');
  });

  it('updateTask sets each optional field independently', async () => {
    const { db, repo } = makeRepo([{ id: 't1' }]);
    await repo.updateTask('42', 't1', {
      error: 'boom',
      warning: 'careful',
      completedAt: new Date('2030-01-01T00:00:00Z'),
      expiresAt: new Date('2030-02-01T00:00:00Z'),
    });
    const upd = db.calls.find((c) => c.kind === 'update');
    expect(upd.set.error).toBe('boom');
    expect(upd.set.warning).toBe('careful');
    expect(upd.set.completedAt).toBeInstanceOf(Date);
    expect(upd.set.expiresAt).toBeInstanceOf(Date);
    expect(upd.set.status).toBeUndefined();
  });

  it('updateTask returns null when no row updated', async () => {
    const { repo } = makeRepo([]);
    expect(await repo.updateTask('42', 'nope', { status: 'failed' })).toBeNull();
  });

  it('createItem applies defaults when fields omitted', async () => {
    const { db, repo } = makeRepo();
    await repo.createItem('42', { taskId: 't1' });
    const ins = db.calls.find((c) => c.kind === 'insert');
    expect(ins.values.itemIndex).toBe(0);
    expect(ins.values.status).toBe('queued');
    expect(ins.values.objectKeys).toBeNull();
    expect(ins.values.error).toBeNull();
    expect(ins.values.completedAt).toBeNull();
    expect(ins.values.createdAt).toBeInstanceOf(Date);
  });

  it('createItem returns constructed row when returning() yields nothing', async () => {
    const { repo } = makeRepo([]);
    const row = await repo.createItem('42', { taskId: 't1', itemIndex: 2 });
    expect(row.taskId).toBe('t1');
    expect(row.itemIndex).toBe(2);
    expect(row.userId).toBe('42');
  });

  it('updateItem sets error/completedAt independently and returns null when absent', async () => {
    const none = makeRepo([]);
    expect(await none.repo.updateItem('42', 't1', 0, { error: 'x', completedAt: new Date() })).toBeNull();
    const upd = none.db.calls.find((c) => c.kind === 'update');
    expect(upd.set.error).toBe('x');
    expect(upd.set.completedAt).toBeInstanceOf(Date);
    expect(upd.set.status).toBeUndefined();
    expect(upd.set.objectKeys).toBeUndefined();
  });

  it('listItems orders by item_index', async () => {
    const { db, repo } = makeRepo();
    await repo.listItems('42', 't1');
    const sel = db.calls.find((c) => c.kind === 'select');
    expect(sel.order).toBe(tables.taskItems.itemIndex);
  });
});
