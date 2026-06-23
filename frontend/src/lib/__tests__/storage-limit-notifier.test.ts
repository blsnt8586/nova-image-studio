import { describe, it, expect, vi } from 'vitest';
import { onStorageLimit, notifyStorageLimit } from '@/lib/storage-limit-notifier';

describe('storage-limit-notifier', () => {
  it('delivers a limit event to subscribers', () => {
    const seen: Array<{ kind: string; message: string }> = [];
    const off = onStorageLimit(e => seen.push(e));
    notifyStorageLimit({ kind: 'asset', message: '已达上限' });
    expect(seen).toEqual([{ kind: 'asset', message: '已达上限' }]);
    off();
  });

  it('stops delivering after unsubscribe', () => {
    const fn = vi.fn();
    const off = onStorageLimit(fn);
    off();
    notifyStorageLimit({ kind: 'generation', message: 'x' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('isolates a throwing subscriber from the others', () => {
    const good = vi.fn();
    const offBad = onStorageLimit(() => { throw new Error('boom'); });
    const offGood = onStorageLimit(good);
    expect(() => notifyStorageLimit({ kind: 'asset', message: 'm' })).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    offBad();
    offGood();
  });
});
