import { beforeEach, describe, expect, it } from 'vitest';
import {
  getSub2apiUserId,
  setSub2apiUserId,
  clearSub2apiUserId,
} from '@/lib/sub2api-user';

describe('sub2api-user', () => {
  beforeEach(() => {
    clearSub2apiUserId();
    window.sessionStorage.clear();
  });

  it('stores and reads the user id from sessionStorage', () => {
    setSub2apiUserId('42');
    expect(getSub2apiUserId()).toBe('42');
    expect(window.sessionStorage.getItem('sub2api-user-id')).toBe('42');
  });

  it('returns null when no user id is set', () => {
    expect(getSub2apiUserId()).toBeNull();
  });

  it('reads the user id back from sessionStorage without an in-memory copy', () => {
    window.sessionStorage.setItem('sub2api-user-id', '7');
    expect(getSub2apiUserId()).toBe('7');
  });

  it('clears the user id from memory and sessionStorage', () => {
    setSub2apiUserId('9');
    clearSub2apiUserId();
    expect(getSub2apiUserId()).toBeNull();
    expect(window.sessionStorage.getItem('sub2api-user-id')).toBeNull();
  });

  it('ignores empty/whitespace ids on set', () => {
    setSub2apiUserId('   ');
    expect(getSub2apiUserId()).toBeNull();
  });

  it('normalizes numeric ids to their string form', () => {
    // 入口参数可能以数字传入,统一存字符串
    setSub2apiUserId(42 as unknown as string);
    expect(getSub2apiUserId()).toBe('42');
  });
});
