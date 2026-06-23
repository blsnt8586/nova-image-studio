import { describe, it, expect, vi } from 'vitest';
import { createAccountStatusHandler } from '../src/routes/account-status.js';
import { createProfileClient } from '../src/auth/profile.js';

function makeReq(authHeader) {
  return { headers: authHeader ? { authorization: authHeader } : {}, url: '/api/account-status' };
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

describe('routes/account-status — GET /api/account-status', () => {
  it('returns outOfFunds=true when balance ≤ 0 and no active subscription', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 7, role: 'user', email: 'a@b.com' });
    const profileClient = {
      getAccountStatus: vi.fn().mockResolvedValue({ outOfFunds: true, hasActiveSubscription: false }),
    };
    const res = makeRes();

    await createAccountStatusHandler({ verify, profileClient })(makeReq('Bearer jwt'), res);

    expect(res.state.status).toBe(200);
    expect(res.state.body).toEqual({ success: true, data: { outOfFunds: true, hasActiveSubscription: false } });
    expect(profileClient.getAccountStatus).toHaveBeenCalledWith('jwt');
  });

  it('returns outOfFunds=false when there is an active subscription', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 7, role: 'user', email: 'a@b.com' });
    const profileClient = {
      getAccountStatus: vi.fn().mockResolvedValue({ outOfFunds: false, hasActiveSubscription: true }),
    };
    const res = makeRes();

    await createAccountStatusHandler({ verify, profileClient })(makeReq('Bearer jwt'), res);

    expect(res.state.status).toBe(200);
    expect(res.state.body.data.outOfFunds).toBe(false);
  });

  it('returns 401 without a token, without hitting sub2api', async () => {
    const verify = vi.fn();
    const profileClient = { getAccountStatus: vi.fn() };
    const res = makeRes();

    await createAccountStatusHandler({ verify, profileClient })(makeReq(), res);

    expect(res.state.status).toBe(401);
    expect(profileClient.getAccountStatus).not.toHaveBeenCalled();
  });

  it('returns 503 when the account service is unreachable', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 7, role: 'user', email: 'a@b.com' });
    const profileClient = {
      getAccountStatus: vi.fn().mockRejectedValue(Object.assign(new Error('down'), { status: 503 })),
    };
    const res = makeRes();

    await createAccountStatusHandler({ verify, profileClient })(makeReq('Bearer jwt'), res);

    expect(res.state.status).toBe(503);
    expect(res.state.body.success).toBe(false);
  });

  it('never leaks the raw balance value in the response', async () => {
    const verify = vi.fn().mockResolvedValue({ userId: 7, role: 'user', email: 'a@b.com' });
    const profileClient = {
      getAccountStatus: vi.fn().mockResolvedValue({ outOfFunds: true, hasActiveSubscription: false }),
    };
    const res = makeRes();

    await createAccountStatusHandler({ verify, profileClient })(makeReq('Bearer jwt'), res);

    // 只回布尔,不含 balance 字段
    expect(res.state.body.data).not.toHaveProperty('balance');
  });
});

describe('auth/profile — getAccountStatus', () => {
  function makeFetch(profileData, subsData) {
    return vi.fn(async (url) => {
      if (String(url).includes('/user/profile')) {
        return { ok: true, status: 200, json: async () => ({ code: 0, data: profileData }) };
      }
      if (String(url).includes('/subscriptions/active')) {
        return { ok: true, status: 200, json: async () => ({ code: 0, data: subsData }) };
      }
      throw new Error(`unexpected url: ${url}`);
    });
  }

  it('outOfFunds=true when balance is 0 and no subscriptions', async () => {
    const fetchImpl = makeFetch({ balance: 0 }, []);
    const client = createProfileClient({ fetchImpl, baseUrl: 'https://s2a.test' });
    const status = await client.getAccountStatus('jwt');
    expect(status).toEqual({ outOfFunds: true, hasActiveSubscription: false });
  });

  it('outOfFunds=false when balance is positive', async () => {
    const fetchImpl = makeFetch({ balance: 5.5 }, []);
    const client = createProfileClient({ fetchImpl, baseUrl: 'https://s2a.test' });
    const status = await client.getAccountStatus('jwt');
    expect(status).toEqual({ outOfFunds: false, hasActiveSubscription: false });
  });

  it('outOfFunds=false when balance is 0 but an active subscription exists', async () => {
    const fetchImpl = makeFetch({ balance: 0 }, [{ id: 1, status: 'active' }]);
    const client = createProfileClient({ fetchImpl, baseUrl: 'https://s2a.test' });
    const status = await client.getAccountStatus('jwt');
    expect(status).toEqual({ outOfFunds: false, hasActiveSubscription: true });
  });

  it('returns null when the token is rejected upstream (401)', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    const client = createProfileClient({ fetchImpl, baseUrl: 'https://s2a.test' });
    const status = await client.getAccountStatus('jwt');
    expect(status).toBeNull();
  });

  it('throws a 503-tagged error when sub2api is unreachable', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const client = createProfileClient({ fetchImpl, baseUrl: 'https://s2a.test' });
    await expect(client.getAccountStatus('jwt')).rejects.toMatchObject({ status: 503 });
  });
});
