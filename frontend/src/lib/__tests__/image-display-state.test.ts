import { describe, it, expect } from 'vitest';
import { resolveImageDisplayState } from '@/lib/image-display-state';

describe('resolveImageDisplayState', () => {
  it('未加载、未出错 → loading', () => {
    expect(resolveImageDisplayState({ loaded: false, errored: false })).toBe('loading');
  });

  it('已加载 → loaded', () => {
    expect(resolveImageDisplayState({ loaded: true, errored: false })).toBe('loaded');
  });

  it('出错(死链/上游 404)→ error,优先于 loading', () => {
    expect(resolveImageDisplayState({ loaded: false, errored: true })).toBe('error');
  });

  it('出错优先于已加载(理论上不会同时,但 error 应胜出避免残留)', () => {
    expect(resolveImageDisplayState({ loaded: true, errored: true })).toBe('error');
  });
});
