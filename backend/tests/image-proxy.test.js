import { describe, it, expect, vi } from 'vitest';
import {
  validateImageProxyTarget,
  DEFAULT_IMAGE_PROXY_HOSTS,
  createImageProxyHandler,
} from '../src/proxy/image-proxy.js';

describe('proxy/image-proxy — validateImageProxyTarget', () => {
  it('接受白名单内的 https 图片地址', () => {
    expect(
      validateImageProxyTarget('https://raw.githubusercontent.com/u/r/main/a.png'),
    ).toBe('https://raw.githubusercontent.com/u/r/main/a.png');
  });

  it('接受白名单域名的子域(后缀匹配,带点边界)', () => {
    expect(
      validateImageProxyTarget('https://pbs.twimg.com/media/x.jpg'),
    ).toBe('https://pbs.twimg.com/media/x.jpg');
  });

  it('接受公共代理 proxy.ccode.vip', () => {
    const u = 'https://proxy.ccode.vip/https/raw.githubusercontent.com/u/r/main/a.png';
    expect(validateImageProxyTarget(u)).toBe(u);
  });

  it('拒绝不在白名单的主机(防开放代理)', () => {
    expect(validateImageProxyTarget('https://evil.com/x.png')).toBeNull();
  });

  it('拒绝伪装成白名单后缀的主机(evil-githubusercontent.com)', () => {
    expect(
      validateImageProxyTarget('https://evilgithubusercontent.com/x.png'),
    ).toBeNull();
    expect(
      validateImageProxyTarget('https://raw.githubusercontent.com.evil.com/x.png'),
    ).toBeNull();
  });

  it('拒绝非 http(s) 协议(防 file:// / data: / SSRF)', () => {
    expect(validateImageProxyTarget('file:///etc/passwd')).toBeNull();
    expect(validateImageProxyTarget('data:image/png;base64,xxx')).toBeNull();
    expect(validateImageProxyTarget('ftp://raw.githubusercontent.com/x')).toBeNull();
  });

  it('拒绝指向内网/本机的地址(防 SSRF)', () => {
    expect(validateImageProxyTarget('http://localhost/x.png')).toBeNull();
    expect(validateImageProxyTarget('http://127.0.0.1/x.png')).toBeNull();
    expect(validateImageProxyTarget('http://169.254.169.254/latest/meta-data')).toBeNull();
    expect(validateImageProxyTarget('http://10.0.0.1/x.png')).toBeNull();
    expect(validateImageProxyTarget('http://192.168.1.1/x.png')).toBeNull();
  });

  it('对空/非字符串输入返回 null', () => {
    expect(validateImageProxyTarget('')).toBeNull();
    expect(validateImageProxyTarget(null)).toBeNull();
    expect(validateImageProxyTarget(undefined)).toBeNull();
    expect(validateImageProxyTarget(123)).toBeNull();
  });

  it('暴露默认白名单常量', () => {
    expect(Array.isArray(DEFAULT_IMAGE_PROXY_HOSTS)).toBe(true);
    expect(DEFAULT_IMAGE_PROXY_HOSTS).toContain('githubusercontent.com');
  });
});

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    chunks: [],
    writeHead(code, headers) {
      this.statusCode = code;
      Object.assign(this.headers, headers || {});
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(chunk) {
      if (chunk) this.chunks.push(chunk);
      this.ended = true;
    },
  };
}

describe('proxy/image-proxy — createImageProxyHandler', () => {
  it('缺少 url 参数返回 400', async () => {
    const handler = createImageProxyHandler({ fetchImpl: vi.fn() });
    const res = mockRes();
    await handler({ method: 'GET', url: '/api/nova/img-proxy' }, res);
    expect(res.statusCode).toBe(400);
  });

  it('url 不在白名单返回 400 且不发起请求', async () => {
    const fetchImpl = vi.fn();
    const handler = createImageProxyHandler({ fetchImpl });
    const res = mockRes();
    await handler(
      { method: 'GET', url: '/api/nova/img-proxy?url=' + encodeURIComponent('https://evil.com/x.png') },
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('白名单地址:拉取成功后透传图片字节与 content-type,并带长缓存头', async () => {
    const body = new Uint8Array([1, 2, 3]);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'image/png']]),
      arrayBuffer: async () => body.buffer,
    }));
    const handler = createImageProxyHandler({ fetchImpl });
    const res = mockRes();
    const target = 'https://raw.githubusercontent.com/u/r/main/a.png';
    await handler(
      { method: 'GET', url: '/api/nova/img-proxy?url=' + encodeURIComponent(target) },
      res,
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toBe(target);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('image/png');
    expect(String(res.headers['Cache-Control'])).toMatch(/max-age/);
  });

  it('上游返回非 2xx 时透传为 502', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 404,
      headers: new Map(),
      arrayBuffer: async () => new ArrayBuffer(0),
    }));
    const handler = createImageProxyHandler({ fetchImpl });
    const res = mockRes();
    await handler(
      {
        method: 'GET',
        url: '/api/nova/img-proxy?url=' + encodeURIComponent('https://raw.githubusercontent.com/u/r/main/a.png'),
      },
      res,
    );
    expect(res.statusCode).toBe(502);
  });
});
