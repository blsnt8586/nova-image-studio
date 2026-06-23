'use strict';

const PROFILE_PATH = '/api/v1/user/profile';
const ACTIVE_SUBSCRIPTIONS_PATH = '/api/v1/subscriptions/active';

/**
 * 构造携带 HTTP 状态语义的错误(供上层映射 503)。
 */
function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * sub2api 用户 Profile 客户端:用用户 JWT 调 `/api/v1/user/profile`,
 * 取回余额/订阅等账户信息。仅用于后端内部,按需脱敏后回前端。
 *
 * @param {object} deps
 * @param {typeof fetch} deps.fetchImpl
 * @param {string} deps.baseUrl sub2api 基地址
 * @returns {{ fetchProfile: (token: string) => Promise<object|null> }}
 */
function createProfileClient(deps) {
  const { fetchImpl, baseUrl } = deps;

  /**
   * 拉取当前用户 profile。401/403 → null;不可达/异常抛 503。
   * @param {string} token 用户 JWT
   * @returns {Promise<object|null>} sub2api data 对象(含 balance、subscriptions 等)
   */
  async function fetchProfile(token) {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${PROFILE_PATH}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      throw httpError(`sub2api unreachable: ${err.message}`, 503);
    }

    if (res.status === 401 || res.status === 403) {
      return null;
    }
    if (!res.ok) {
      throw httpError(`sub2api profile failed: ${res.status}`, 503);
    }

    let body;
    try {
      body = await res.json();
    } catch {
      throw httpError('sub2api profile: 响应解析失败', 503);
    }
    // sub2api 统一响应形如 { code, data: {...} }
    const data = body && typeof body === 'object' ? body.data : null;
    return data && typeof data === 'object' ? data : null;
  }

  /**
   * 拉取当前用户的有效订阅列表。401/403 → null;不可达/异常抛 503。
   * @param {string} token 用户 JWT
   * @returns {Promise<Array<object>|null>}
   */
  async function fetchActiveSubscriptions(token) {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${ACTIVE_SUBSCRIPTIONS_PATH}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      throw httpError(`sub2api unreachable: ${err.message}`, 503);
    }

    if (res.status === 401 || res.status === 403) {
      return null;
    }
    if (!res.ok) {
      throw httpError(`sub2api subscriptions failed: ${res.status}`, 503);
    }

    let body;
    try {
      body = await res.json();
    } catch {
      throw httpError('sub2api subscriptions: 响应解析失败', 503);
    }
    const data = body && typeof body === 'object' ? body.data : null;
    return Array.isArray(data) ? data : [];
  }

  /**
   * 计算账户状态:余额 ≤ 0 且无有效订阅 → outOfFunds=true。
   * 余额数值不外泄,只回前端展示所需的最小信息。
   *
   * @param {string} token 用户 JWT
   * @returns {Promise<{ outOfFunds: boolean, hasActiveSubscription: boolean } | null>}
   *   401/403(身份无效)→ null,交由上层处理。
   */
  async function getAccountStatus(token) {
    const [profile, subscriptions] = await Promise.all([
      fetchProfile(token),
      fetchActiveSubscriptions(token),
    ]);
    // 任一返回 null 表示身份无效
    if (profile === null || subscriptions === null) {
      return null;
    }
    const balance = typeof profile.balance === 'number' ? profile.balance : 0;
    const hasActiveSubscription = subscriptions.length > 0;
    const outOfFunds = balance <= 0 && !hasActiveSubscription;
    return { outOfFunds, hasActiveSubscription };
  }

  return { fetchProfile, fetchActiveSubscriptions, getAccountStatus };
}

module.exports = { createProfileClient, PROFILE_PATH, ACTIVE_SUBSCRIPTIONS_PATH };
