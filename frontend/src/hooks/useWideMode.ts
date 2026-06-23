'use client';

import { useEffect, useState } from 'react';

// 宽屏（侧栏）布局基于 xl 断点设计。视口窄于该宽度时，侧栏会与顶部 Header 重复、
// 纵向 Tab 布局错位，因此窄视口下必须自动关闭宽屏；变宽后自动恢复。
export const WIDE_MODE_MIN_WIDTH = 1280;

function viewportAllowsWide(): boolean {
  if (typeof window === 'undefined') return true;
  return window.innerWidth >= WIDE_MODE_MIN_WIDTH;
}

function dismissBootLoader(): void {
  const el = document.getElementById('app-boot-loader');
  if (el) el.remove();
}

/** 将宽度模式状态同步到 <html> 属性，确保 CSS 选择器始终有效 */
function syncHtmlAttribute(enabled: boolean): void {
  if (typeof document === 'undefined') return;
  if (enabled) {
    document.documentElement.setAttribute('data-wide-mode', '');
  } else {
    document.documentElement.removeAttribute('data-wide-mode');
  }
}

export function useWideMode() {
  // 初始渲染必须与静态导出 HTML 一致（wideMode=false），否则 wide-mode-init 内联脚本
  // 设置的 html[data-wide-mode] 会让客户端首屏读到 true，与构建期 HTML 不符而触发
  // React #418 文本水合错误。真实值在挂载后的 effect 中读取；期间由 #app-boot-loader 遮罩覆盖。
  const [wideMode, setWideModeState] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      // 宽屏现为默认布局，只要视口够宽即开启，无需用户偏好。
      setWideModeState(viewportAllowsWide());
      setMounted(true);
      dismissBootLoader();
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // 视口宽度跨越阈值时双向同步：变窄自动关闭以避免重复 Header 的坏状态，变宽自动恢复。
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mql = window.matchMedia(`(min-width: ${WIDE_MODE_MIN_WIDTH}px)`);

    const apply = (isWide: boolean) => {
      setWideModeState(current => (current === isWide ? current : isWide));
    };

    apply(mql.matches);
    const listener = (event: MediaQueryListEvent) => apply(event.matches);
    mql.addEventListener('change', listener);

    return () => mql.removeEventListener('change', listener);
  }, []);

  // 将 wideMode 状态同步到 <html> 属性，使 CSS 选择器 html[data-wide-mode] 始终有效
  useEffect(() => {
    syncHtmlAttribute(wideMode);
  }, [wideMode]);

  return {
    wideMode,
    mounted,
  };
}
