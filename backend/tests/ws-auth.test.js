import { describe, it, expect, vi } from 'vitest';
import { createTaskSubscriptionGuard } from '../src/tasks/ws-auth.js';

describe('ws-auth task subscription guard (multi-user mode)', () => {
  it('allows subscribing to a task owned by the connection user', async () => {
    const getOwner = vi.fn(async (taskId) => (taskId === 't1' ? '42' : null));
    const guard = createTaskSubscriptionGuard({ multiUser: true, getTaskOwner: getOwner });
    expect(await guard.canSubscribe('42', 't1')).toBe(true);
  });

  it('denies subscribing to another user task', async () => {
    const getOwner = vi.fn(async () => '7');
    const guard = createTaskSubscriptionGuard({ multiUser: true, getTaskOwner: getOwner });
    expect(await guard.canSubscribe('42', 't1')).toBe(false);
  });

  it('denies when connection has no verified user', async () => {
    const getOwner = vi.fn(async () => '42');
    const guard = createTaskSubscriptionGuard({ multiUser: true, getTaskOwner: getOwner });
    expect(await guard.canSubscribe(null, 't1')).toBe(false);
    expect(await guard.canSubscribe('', 't1')).toBe(false);
    expect(getOwner).not.toHaveBeenCalled();
  });

  it('denies when the task does not exist (no owner)', async () => {
    const getOwner = vi.fn(async () => null);
    const guard = createTaskSubscriptionGuard({ multiUser: true, getTaskOwner: getOwner });
    expect(await guard.canSubscribe('42', 'ghost')).toBe(false);
  });

  it('treats a thrown owner lookup as denial (fail closed)', async () => {
    const getOwner = vi.fn(async () => { throw new Error('db down'); });
    const guard = createTaskSubscriptionGuard({ multiUser: true, getTaskOwner: getOwner });
    expect(await guard.canSubscribe('42', 't1')).toBe(false);
  });
});

describe('ws-auth task subscription guard (single-user / legacy mode)', () => {
  it('allows any subscription when multiUser is off (back-compat)', async () => {
    const getOwner = vi.fn();
    const guard = createTaskSubscriptionGuard({ multiUser: false, getTaskOwner: getOwner });
    expect(await guard.canSubscribe(null, 't1')).toBe(true);
    expect(getOwner).not.toHaveBeenCalled();
  });
});

describe('ws-auth identity extraction', () => {
  it('extracts userId (as string) from a verified token in the upgrade query', async () => {
    const verify = vi.fn(async (token) => (token === 'good' ? { userId: 42 } : null));
    const guard = createTaskSubscriptionGuard({ multiUser: true, getTaskOwner: vi.fn(), verify });
    const userId = await guard.identify('wss://h/api/nova/ws?token=good');
    expect(userId).toBe('42');
  });

  it('returns null for a missing/invalid token', async () => {
    const verify = vi.fn(async () => null);
    const guard = createTaskSubscriptionGuard({ multiUser: true, getTaskOwner: vi.fn(), verify });
    expect(await guard.identify('wss://h/api/nova/ws')).toBeNull();
    expect(await guard.identify('wss://h/api/nova/ws?token=bad')).toBeNull();
  });

  it('returns null when verify throws (fail closed)', async () => {
    const verify = vi.fn(async () => { throw new Error('boom'); });
    const guard = createTaskSubscriptionGuard({ multiUser: true, getTaskOwner: vi.fn(), verify });
    expect(await guard.identify('wss://h/api/nova/ws?token=x')).toBeNull();
  });

  it('returns null when verify is not provided', async () => {
    const guard = createTaskSubscriptionGuard({ multiUser: true, getTaskOwner: vi.fn() });
    expect(await guard.identify('wss://h/api/nova/ws?token=x')).toBeNull();
  });

  it('returns null when identity has no userId', async () => {
    const verify = vi.fn(async () => ({ role: 'user' }));
    const guard = createTaskSubscriptionGuard({ multiUser: true, getTaskOwner: vi.fn(), verify });
    expect(await guard.identify('wss://h/api/nova/ws?token=x')).toBeNull();
  });
});

describe('ws-auth identifyToken (post-connect auth message; token not in URL)', () => {
  it('verifies a raw token and returns the userId as string', async () => {
    const verify = vi.fn(async (token) => (token === 'good' ? { userId: 42 } : null));
    const guard = createTaskSubscriptionGuard({ multiUser: true, getTaskOwner: vi.fn(), verify });
    expect(await guard.identifyToken('good')).toBe('42');
    expect(verify).toHaveBeenCalledWith('good');
  });

  it('trims the token before verifying', async () => {
    const verify = vi.fn(async (token) => (token === 'good' ? { userId: 7 } : null));
    const guard = createTaskSubscriptionGuard({ multiUser: true, getTaskOwner: vi.fn(), verify });
    expect(await guard.identifyToken('  good  ')).toBe('7');
  });

  it('returns null for empty/non-string/missing token', async () => {
    const verify = vi.fn(async () => ({ userId: 1 }));
    const guard = createTaskSubscriptionGuard({ multiUser: true, getTaskOwner: vi.fn(), verify });
    expect(await guard.identifyToken('')).toBeNull();
    expect(await guard.identifyToken('   ')).toBeNull();
    expect(await guard.identifyToken(undefined)).toBeNull();
    expect(await guard.identifyToken(null)).toBeNull();
    expect(verify).not.toHaveBeenCalled();
  });

  it('returns null when verify rejects the token', async () => {
    const verify = vi.fn(async () => null);
    const guard = createTaskSubscriptionGuard({ multiUser: true, getTaskOwner: vi.fn(), verify });
    expect(await guard.identifyToken('bad')).toBeNull();
  });

  it('returns null when verify throws (fail closed)', async () => {
    const verify = vi.fn(async () => { throw new Error('boom'); });
    const guard = createTaskSubscriptionGuard({ multiUser: true, getTaskOwner: vi.fn(), verify });
    expect(await guard.identifyToken('x')).toBeNull();
  });

  it('returns null when verify is not provided', async () => {
    const guard = createTaskSubscriptionGuard({ multiUser: true, getTaskOwner: vi.fn() });
    expect(await guard.identifyToken('x')).toBeNull();
  });

  it('returns null when identity has no userId', async () => {
    const verify = vi.fn(async () => ({ role: 'user' }));
    const guard = createTaskSubscriptionGuard({ multiUser: true, getTaskOwner: vi.fn(), verify });
    expect(await guard.identifyToken('x')).toBeNull();
  });
});
