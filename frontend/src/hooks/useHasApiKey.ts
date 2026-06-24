'use client';

import { useEffect, useState } from 'react';

import { MODEL_REGISTRY_UPDATED_EVENT, hasAnyApiKey } from '@/lib/settings-storage';

/**
 * 「是否已配置可用模型」的实时状态。
 *
 * 单纯 `useState(() => hasAnyApiKey())` 只在挂载时算一次,会导致
 * 「在设置里配置完模型、但不刷新页面,工作台/agent 仍提示未配置」。
 * 这里额外监听设置保存派发的 {@link MODEL_REGISTRY_UPDATED_EVENT} 与跨标签页
 * `storage` 事件,事件触发即重算,无需重新挂载组件。
 *
 * @returns 当前是否已同时配置完整的图片与文本模型。
 */
export function useHasApiKey(): boolean {
  const [hasApiKey, setHasApiKey] = useState(() => hasAnyApiKey());

  useEffect(() => {
    const recompute = () => setHasApiKey(hasAnyApiKey());
    // 挂载后立即同步一次:防止 SSR 初值(false)与客户端实际配置不一致。
    recompute();
    window.addEventListener(MODEL_REGISTRY_UPDATED_EVENT, recompute);
    window.addEventListener('storage', recompute);
    return () => {
      window.removeEventListener(MODEL_REGISTRY_UPDATED_EVENT, recompute);
      window.removeEventListener('storage', recompute);
    };
  }, []);

  return hasApiKey;
}
