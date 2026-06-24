import { describe, it, expect } from 'vitest';

import { proxyImage } from '@/lib/proxy-image';

describe('proxyImage', () => {
  it('把第三方绝对 http(s) 图片地址改写为走后端代理', () => {
    const src = 'https://raw.githubusercontent.com/u/r/main/a.png';
    expect(proxyImage(src)).toBe(`/api/nova/img-proxy?url=${encodeURIComponent(src)}`);
  });

  it('正确编码含 query/特殊字符的地址', () => {
    const src = 'https://pbs.twimg.com/media/x.jpg?name=large&v=1';
    expect(proxyImage(src)).toBe(`/api/nova/img-proxy?url=${encodeURIComponent(src)}`);
  });

  it('空值原样返回(避免生成无效代理地址)', () => {
    expect(proxyImage('')).toBe('');
    expect(proxyImage(undefined as unknown as string)).toBe('');
    expect(proxyImage(null as unknown as string)).toBe('');
  });

  it('已经是本站相对地址的不再代理', () => {
    expect(proxyImage('/api/nova/img-proxy?url=x')).toBe('/api/nova/img-proxy?url=x');
    expect(proxyImage('/local/a.png')).toBe('/local/a.png');
  });

  it('data: / blob: 地址不代理(本地资源)', () => {
    expect(proxyImage('data:image/png;base64,xxx')).toBe('data:image/png;base64,xxx');
    expect(proxyImage('blob:https://x/abc')).toBe('blob:https://x/abc');
  });
});
