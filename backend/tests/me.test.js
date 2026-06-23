import { describe, it, expect, vi } from 'vitest';
import { createMeHandler } from '../src/routes/me.js';

function makeReq(authHeader) {
  return { headers: authHeader ? { authorization: authHeader } : {}, url: '/api/me' };
}

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

describe('routes/me', () => {
  it('returns the current identity for a valid token', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 11, role: 'user', email: 'm@n.com' });
    const res = makeRes();

    await createMeHandler({ verify })(makeReq('Bearer good'), res);

    expect(res.state.status).toBe(200);
    expect(res.state.body).toEqual({
      success: true,
      data: { userId: 11, role: 'user', email: 'm@n.com' },
    });
  });

  it('returns 401 without a token', async () => {
    const verify = vi.fn();
    const res = makeRes();

    await createMeHandler({ verify })(makeReq(), res);

    expect(res.state.status).toBe(401);
    expect(res.state.body.success).toBe(false);
  });

  it('does not leak the raw token in the response', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 1, role: 'user', email: 'a@b.com' });
    const res = makeRes();

    await createMeHandler({ verify })(makeReq('Bearer secret-jwt'), res);

    expect(JSON.stringify(res.state.body)).not.toContain('secret-jwt');
  });
});
