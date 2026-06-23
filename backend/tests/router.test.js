import { describe, it, expect, vi } from 'vitest';
import { createMultiUserRouter } from '../src/routes/index.js';

const goodEnv = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/nova',
  REDIS_URL: 'redis://localhost:6379',
  SUB2API_BASE_URL: 'https://sub2api.test',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY: 'ak',
  S3_SECRET_KEY: 'sk',
  S3_BUCKET: 'nova',
};

function makeRes() {
  const state = { status: null, body: null };
  return {
    state,
    writeHead(status) {
      state.status = status;
    },
    end(payload) {
      state.body = payload ? JSON.parse(payload) : null;
    },
  };
}

describe('routes/index — createMultiUserRouter', () => {
  it('returns null when infra env vars are missing (legacy mode preserved)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(createMultiUserRouter({})).toBeNull();
    warn.mockRestore();
  });

  it('builds a router that handles GET /api/me when configured', async () => {
    const router = createMultiUserRouter(goodEnv);
    expect(router).not.toBeNull();
    expect(typeof router.handle).toBe('function');

    // 无 token → 401(说明 /api/me 确被本路由接管)
    const res = makeRes();
    const handled = await router.handle(
      { method: 'GET', headers: {}, url: '/api/me' },
      res,
      '/api/me',
    );
    expect(handled).toBe(true);
    expect(res.state.status).toBe(401);
  });

  it('does not handle unrelated paths (returns false)', async () => {
    const router = createMultiUserRouter(goodEnv);
    const res = makeRes();
    const handled = await router.handle(
      { method: 'GET', headers: {}, url: '/api/nova/config' },
      res,
      '/api/nova/config',
    );
    expect(handled).toBe(false);
    expect(res.state.status).toBeNull();
  });

  it('treats trailing slash on /api/me/ as the same route', async () => {
    const router = createMultiUserRouter(goodEnv);
    const res = makeRes();
    const handled = await router.handle(
      { method: 'GET', headers: {}, url: '/api/me/' },
      res,
      '/api/me/',
    );
    expect(handled).toBe(true);
    expect(res.state.status).toBe(401);
  });

  it('dispatches /api/proxy/* to the proxy handler (401 without token)', async () => {
    const router = createMultiUserRouter(goodEnv);
    const res = makeRes();
    const handled = await router.handle(
      { method: 'POST', headers: {}, url: '/api/proxy/v1/responses' },
      res,
      '/api/proxy/v1/responses',
    );
    expect(handled).toBe(true);
    expect(res.state.status).toBe(401);
  });

  it('dispatches GET /api/keys to the keys handler (401 without token)', async () => {
    const router = createMultiUserRouter(goodEnv);
    const res = makeRes();
    const handled = await router.handle(
      { method: 'GET', headers: {}, url: '/api/keys' },
      res,
      '/api/keys',
    );
    expect(handled).toBe(true);
    expect(res.state.status).toBe(401);
  });

  it('dispatches /api/canvases to resource routes (401 without token)', async () => {
    const router = createMultiUserRouter(goodEnv);
    const res = makeRes();
    const handled = await router.handle(
      { method: 'GET', headers: {}, url: '/api/canvases' },
      res,
      '/api/canvases',
    );
    expect(handled).toBe(true);
    expect(res.state.status).toBe(401);
  });

  it('dispatches /api/storage/presign to resource routes (401 without token)', async () => {
    const router = createMultiUserRouter(goodEnv);
    const res = makeRes();
    const handled = await router.handle(
      { method: 'POST', headers: {}, url: '/api/storage/presign' },
      res,
      '/api/storage/presign',
    );
    expect(handled).toBe(true);
    expect(res.state.status).toBe(401);
  });
});
