import { describe, it, expect, vi } from 'vitest';
import { createTtlSweeper } from '../src/tasks/ttl-sweep.js';

function makeRepo(expiredTasks, itemsByTask) {
  return {
    findExpired: vi.fn(async () => expiredTasks),
    listItems: vi.fn(async (userId, taskId) => itemsByTask[taskId] || []),
    purgeTask: vi.fn(async () => {}),
  };
}

describe('ttl-sweep', () => {
  it('deletes MinIO objects then purges PG rows for each expired task', async () => {
    const repo = makeRepo(
      [{ id: 't1', userId: '42' }, { id: 't2', userId: '7' }],
      {
        t1: [{ objectKeys: ['42/generation/a.png'] }, { objectKeys: ['42/generation/b.png'] }],
        t2: [{ objectKeys: ['7/generation/c.png'] }],
      },
    );
    const images = { deleteKeys: vi.fn(async () => ({ total: 1, success: 1, failed: 0 })) };
    const sweeper = createTtlSweeper({ tasksRepo: repo, images });

    const summary = await sweeper.sweep(new Date('2026-06-21T00:00:00Z'));

    // 每个任务都按其 user_id 删除自己的 object keys
    expect(images.deleteKeys).toHaveBeenCalledWith('42', ['42/generation/a.png', '42/generation/b.png']);
    expect(images.deleteKeys).toHaveBeenCalledWith('7', ['7/generation/c.png']);
    // 删 MinIO 后才 purge PG
    expect(repo.purgeTask).toHaveBeenCalledWith('t1');
    expect(repo.purgeTask).toHaveBeenCalledWith('t2');
    expect(summary.tasks).toBe(2);
  });

  it('skips items without object keys', async () => {
    const repo = makeRepo([{ id: 't1', userId: '42' }], { t1: [{ objectKeys: null }, {}] });
    const images = { deleteKeys: vi.fn(async () => ({ total: 0, success: 0, failed: 0 })) };
    const sweeper = createTtlSweeper({ tasksRepo: repo, images });
    await sweeper.sweep(new Date());
    expect(images.deleteKeys).toHaveBeenCalledWith('42', []);
    expect(repo.purgeTask).toHaveBeenCalledWith('t1');
  });

  it('still purges PG even if MinIO deletion throws (best-effort)', async () => {
    const repo = makeRepo([{ id: 't1', userId: '42' }], { t1: [{ objectKeys: ['42/generation/a.png'] }] });
    const images = { deleteKeys: vi.fn(async () => { throw new Error('minio down'); }) };
    const sweeper = createTtlSweeper({ tasksRepo: repo, images });
    const summary = await sweeper.sweep(new Date());
    expect(repo.purgeTask).toHaveBeenCalledWith('t1');
    expect(summary.tasks).toBe(1);
  });

  it('returns zero summary when nothing expired', async () => {
    const repo = makeRepo([], {});
    const images = { deleteKeys: vi.fn() };
    const sweeper = createTtlSweeper({ tasksRepo: repo, images });
    const summary = await sweeper.sweep(new Date());
    expect(summary.tasks).toBe(0);
    expect(images.deleteKeys).not.toHaveBeenCalled();
  });

  it('defaults now to current time when no argument passed', async () => {
    const repo = makeRepo([], {});
    const images = { deleteKeys: vi.fn() };
    const sweeper = createTtlSweeper({ tasksRepo: repo, images });
    await sweeper.sweep();
    expect(repo.findExpired).toHaveBeenCalledWith(expect.any(Date));
  });
});
