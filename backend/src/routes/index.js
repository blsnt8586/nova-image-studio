'use strict';

const { loadConfig } = require('../config');
const { createVerify } = require('../auth/create-verify');
const { createKeysClient } = require('../auth/keys');
const { createProfileClient } = require('../auth/profile');
const { getRedis } = require('../cache/redis');
const { createMeHandler } = require('./me');
const { createKeysHandler } = require('./keys');
const { createAccountStatusHandler } = require('./account-status');
const { createProxyHandler } = require('../proxy/handler');
const { PROXY_PREFIX } = require('../proxy/target');
const { getDb } = require('../db/client');
const { getStorage } = require('../storage/client');
const { createCanvasesRepo } = require('../repos/canvases');
const { createGenerationsRepo } = require('../repos/generations');
const { createAssetsRepo } = require('../repos/assets');
const { createSettingsRepo } = require('../repos/settings');
const { createTasksRepo } = require('../repos/tasks');
const { createResourceRoutes } = require('./resources');
const { createTaskRoutes } = require('./tasks');
const { createTaskImageService } = require('../tasks/task-images');
const { createTaskSubscriptionGuard } = require('../tasks/ws-auth');
const { createMultiUserTaskStore } = require('../tasks/multi-user-store');

/**
 * 尝试构建「多用户后端」路由分发器。
 * 若新基础设施环境变量未配置(老单机模式),返回 null,server.js 据此跳过挂载,
 * 保证不破坏现有部署。
 *
 * @param {Record<string,string|undefined>} [env=process.env]
 * @returns {null | { handle: (req, res, pathname: string) => Promise<boolean> }}
 *   handle 返回 true 表示已处理该请求。
 */
function createMultiUserRouter(env = process.env) {
  let config;
  try {
    config = loadConfig(env);
  } catch (err) {
    // 未配置后端基础设施:维持老单机模式,不挂载多用户路由
    console.warn('[multi-user] 未启用(缺少环境变量):', err.message);
    return null;
  }

  const verify = createVerify(config);
  const meHandler = createMeHandler({ verify });

  // sub2api API Key 客户端:列表脱敏 + keyId→sk- 代查(sk- key 不出后端)。
  const keysClient = createKeysClient({
    fetchImpl: globalThis.fetch,
    baseUrl: config.sub2apiBaseUrl,
    redis: getRedis(config.redisUrl),
    cacheTtl: config.tokenCacheTtl,
  });
  const keysHandler = createKeysHandler({ verify, keysClient });

  // 账户状态客户端:用 JWT 查 sub2api 余额/订阅,算出是否「没钱」供前端提示。
  const profileClient = createProfileClient({
    fetchImpl: globalThis.fetch,
    baseUrl: config.sub2apiBaseUrl,
  });
  const accountStatusHandler = createAccountStatusHandler({ verify, profileClient });
  const proxyHandler = createProxyHandler({
    fetchImpl: globalThis.fetch,
    verify,
    keysClient,
    sub2apiBaseUrl: config.sub2apiBaseUrl,
  });

  // 业务资源路由(阶段 3)。db/storage 惰性连接(首个真实请求时才建连)。
  const { db } = getDb(config.databaseUrl);
  const storage = getStorage(config);
  const resourceRoutes = createResourceRoutes({
    verify,
    canvasesRepo: createCanvasesRepo({ db }),
    generationsRepo: createGenerationsRepo({ db }),
    assetsRepo: createAssetsRepo({ db }),
    settingsRepo: createSettingsRepo({ db }),
    storage,
    limits: config.limits,
  });

  // 任务队列路由(阶段 4)。图片本体落 MinIO,task_items 存 object_key。
  const tasksRepo = createTasksRepo({ db });
  const taskImages = createTaskImageService({ storage });
  const taskRoutes = createTaskRoutes({ verify, tasksRepo, images: taskImages, storage });

  // WS 任务订阅鉴权(多用户模式):订阅前用代验身份比对任务归属。
  const taskSubscriptionGuard = createTaskSubscriptionGuard({
    multiUser: true,
    verify,
    getTaskOwner: (taskId) => tasksRepo.getTaskOwner(taskId),
  });

  // 多用户生图 TaskStore(供 server.js 生图引擎在多用户模式下使用)。
  const multiUserTaskStore = createMultiUserTaskStore({ tasksRepo, images: taskImages, storage });

  async function handle(req, res, pathname) {
    const path = pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'GET' && path === '/api/me') {
      await meHandler(req, res);
      return true;
    }

    // 当前用户的 sub2api API Key 列表(脱敏),供前端下拉选择 keyId
    if (req.method === 'GET' && path === '/api/keys') {
      await keysHandler(req, res);
      return true;
    }

    // 账户状态(余额/订阅):前端据此提示「余额不足,请联系管理员充值」
    if (req.method === 'GET' && path === '/api/account-status') {
      await accountStatusHandler(req, res);
      return true;
    }

    // 生图/列模型代理:/api/proxy/* → sub2api(持用户 JWT)
    if (path === PROXY_PREFIX || path.startsWith(PROXY_PREFIX + '/')) {
      return proxyHandler(req, res);
    }

    // 业务资源:canvases / generations / assets / storage presign
    if (await resourceRoutes.handle(req, res, pathname)) {
      return true;
    }

    // 任务队列:/api/tasks(列表/详情/删除)
    if (await taskRoutes.handle(req, res, pathname)) {
      return true;
    }

    // 仅接管本路由器负责的前缀,其余交回 server.js
    return false;
  }

  return { handle, config, taskSubscriptionGuard, multiUserTaskStore, tasksRepo, taskImages, storage, verify };
}

module.exports = { createMultiUserRouter };
