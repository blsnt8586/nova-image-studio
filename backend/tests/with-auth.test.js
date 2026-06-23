import { describe, it, expect, vi } from 'vitest';
import { extractToken, withAuth, withAdmin } from '../src/auth/with-auth.js';

function makeReq({ authHeader, url = '/api/me' } = {}) {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
    url,
  };
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

describe('auth/with-auth', () => {
  describe('extractToken', () => {
    it('reads a Bearer token from the Authorization header', () => {
      expect(extractToken(makeReq({ authHeader: 'Bearer abc.def' }))).toBe('abc.def');
    });

    it('reads token from the ?token= query param', () => {
      const req = makeReq({ url: '/api/me?token=qtok&foo=1' });
      expect(extractToken(req)).toBe('qtok');
    });

    it('prefers the Authorization header over the query param', () => {
      const req = makeReq({ authHeader: 'Bearer hdr', url: '/api/me?token=qry' });
      expect(extractToken(req)).toBe('hdr');
    });

    it('returns null when no token is present', () => {
      expect(extractToken(makeReq())).toBeNull();
    });
  });

  describe('withAuth', () => {
    it('injects identity and calls the handler on a valid token', async () => {
      const verify = vi.fn().mockResolvedValue({ userId: 5, role: 'user', email: 'a@b.com' });
      const handler = vi.fn(async (req, res, ctx) => {
        res.writeHead(200);
        res.end(JSON.stringify({ uid: ctx.userId }));
      });
      const req = makeReq({ authHeader: 'Bearer ok' });
      const res = makeRes();

      await withAuth(handler, { verify })(req, res);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(res.state.status).toBe(200);
      expect(res.state.body).toEqual({ uid: 5 });
    });

    it('returns 401 when no token is present and does not call handler', async () => {
      const verify = vi.fn();
      const handler = vi.fn();
      const res = makeRes();

      await withAuth(handler, { verify })(makeReq(), res);

      expect(res.state.status).toBe(401);
      expect(res.state.body.success).toBe(false);
      expect(handler).not.toHaveBeenCalled();
      expect(verify).not.toHaveBeenCalled();
    });

    it('returns 401 when the token is invalid (verify -> null)', async () => {
      const verify = vi.fn().mockResolvedValue(null);
      const handler = vi.fn();
      const res = makeRes();

      await withAuth(handler, { verify })(makeReq({ authHeader: 'Bearer bad' }), res);

      expect(res.state.status).toBe(401);
      expect(handler).not.toHaveBeenCalled();
    });

    it('returns 503 when verify throws an upstream error', async () => {
      const err = Object.assign(new Error('down'), { status: 503 });
      const verify = vi.fn().mockRejectedValue(err);
      const res = makeRes();

      await withAuth(vi.fn(), { verify })(makeReq({ authHeader: 'Bearer x' }), res);

      expect(res.state.status).toBe(503);
      expect(res.state.body.success).toBe(false);
    });

    it('returns 500 when verify throws a non-upstream error', async () => {
      const verify = vi.fn().mockRejectedValue(new Error('boom'));
      const res = makeRes();

      await withAuth(vi.fn(), { verify })(makeReq({ authHeader: 'Bearer x' }), res);

      expect(res.state.status).toBe(500);
      expect(res.state.body.success).toBe(false);
    });
  });

  describe('withAdmin', () => {
    it('calls the handler when role is admin', async () => {
      const verify = vi.fn().mockResolvedValue({ userId: 1, role: 'admin', email: 'a@b.com' });
      const handler = vi.fn(async (req, res) => {
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      });
      const res = makeRes();

      await withAdmin(handler, { verify })(makeReq({ authHeader: 'Bearer adm' }), res);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(res.state.status).toBe(200);
    });

    it('returns 403 when an authenticated user is not admin', async () => {
      const verify = vi.fn().mockResolvedValue({ userId: 2, role: 'user', email: 'u@b.com' });
      const handler = vi.fn();
      const res = makeRes();

      await withAdmin(handler, { verify })(makeReq({ authHeader: 'Bearer usr' }), res);

      expect(res.state.status).toBe(403);
      expect(handler).not.toHaveBeenCalled();
    });

    it('returns 401 when not authenticated', async () => {
      const verify = vi.fn().mockResolvedValue(null);
      const handler = vi.fn();
      const res = makeRes();

      await withAdmin(handler, { verify })(makeReq({ authHeader: 'Bearer no' }), res);

      expect(res.state.status).toBe(401);
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
