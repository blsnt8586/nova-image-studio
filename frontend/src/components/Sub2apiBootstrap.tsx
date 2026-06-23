'use client';

import { useEffect, useRef } from 'react';
import { runSub2apiBootstrap } from '@/lib/sub2api-bootstrap';

/**
 * 入口引导组件:挂载时若 URL 带 sub2api 入口参数(token/user_id),
 * 则存 token 并清掉 URL 上的敏感参数。
 *
 * 注意:不再自动创建模型。用户在设置里手动「新增图片/文本模型」,
 * 选择 API Key 与模型(见 sub2api-bootstrap 的 loadSub2apiKeys/loadSub2apiModels)。
 *
 * 无渲染产出;无 token 时静默跳过(直接访问 nova 的普通用户不受影响)。
 */
export function Sub2apiBootstrap(): null {
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    if (typeof window === 'undefined') return;
    if (!window.location.search) return;

    void runSub2apiBootstrap({
      search: window.location.search,
      origin: window.location.origin,
      fetchImpl: window.fetch.bind(window),
      replaceUrl: (url: string) => {
        try {
          window.history.replaceState(null, '', url);
        } catch {
          // ignore
        }
      },
    });
  }, []);

  return null;
}
