/**
 * 提示词广场单张图片的展示状态。
 *
 * 背景:图片可能因数据源里的死链(上游 404 → 代理 502)永远 loadTo 不成功,
 * 旧逻辑只有 onLoad、没有 onError,导致死链图一直转圈。引入 error 态后,
 * 加载失败显示占位符而非无限 spinner。
 */
export type ImageDisplayState = 'loading' | 'loaded' | 'error';

/**
 * 根据加载/出错标记推导展示状态。error 优先,避免出错后仍残留 loading/loaded。
 * @param {{ loaded: boolean, errored: boolean }} flags
 * @returns {ImageDisplayState}
 */
export function resolveImageDisplayState(flags: { loaded: boolean; errored: boolean }): ImageDisplayState {
  if (flags.errored) return 'error';
  if (flags.loaded) return 'loaded';
  return 'loading';
}
