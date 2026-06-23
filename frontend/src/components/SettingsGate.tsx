'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { hydrateSettings, installSettingsWriteThrough } from '@/lib/settings-sync';

/**
 * 设置同步门:挂载时先从后端水合第二档偏好到 localStorage,完成后再渲染子树。
 *
 * 为什么要「门」:WorkspaceShell 及其子组件在挂载时**同步**读 localStorage
 * (loadRegistry / 各 *_SETTINGS_KEY),若不先水合,换设备/换 origin 首屏会读到空。
 * 期间整屏由 #app-boot-loader 遮罩覆盖(由 useWideMode 在挂载后移除),无白屏。
 *
 * 无 sub2api 会话时 hydrateSettings 立即返回,门几乎瞬间放行(纯本地行为不变)。
 */
export function SettingsGate({ children }: { children: ReactNode }): ReactNode {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // 先装写回钩子,确保水合后用户的任何改动都会同步
    installSettingsWriteThrough();
    void hydrateSettings().finally(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) return null;
  return children;
}
