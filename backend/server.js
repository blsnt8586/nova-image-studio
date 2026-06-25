const http = require('http');
const { createHash, randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const { parse: parseLegacyUrl } = require('url');
const next = require('next');
const { WebSocketServer } = require('ws');
const { createMultiUserRouter } = require('./src/routes');
const { createTaskEngine } = require('./src/tasks/task-engine');
const { createPgTaskGateway } = require('./src/tasks/pg-task-gateway');
const { extractToken } = require('./src/auth/with-auth');
const { createImageProxyHandler } = require('./src/proxy/image-proxy');
const { createGptImageRequestInit } = require('./src/proxy/gpt-image-request');

const ENV_FILE_PATH = path.join(process.cwd(), '.env');
const GLOBAL_TASK_CONCURRENCY = 50;
const DEFAULT_LIMIT_CONFIG = {
  maxQueueSize: 200,
  rateLimitWindowMs: 60 * 1000,
  maxRequestsPerIp: 20,
  maxRequestsPerApiKey: 20,
  maxPendingTasksPerIp: 20,
  maxPendingTasksPerApiKey: 10,
  retryAfterSeconds: 30,
};
const LIMIT_ERROR_MESSAGES = {
  queueFull: '当前排队任务较多，请稍后再试。',
  rateLimited: '请求太频繁，请稍后再试。',
  tooManyPending: '你已有较多任务正在排队或生成，请稍后再提交。',
  notAcceptingTasks: '服务器正在升级维护，暂不接受新任务。未完成任务将继续完成。',
};

function parseEnvFile(filePath = ENV_FILE_PATH) {
  if (!fs.existsSync(filePath)) return {};

  const values = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, '');
    values[key] = value;
  }
  return values;
}

// .env 运行期读取加 1 秒 TTL 缓存：原本每次调用都同步 readFileSync，而
// getQueueStats / 建任务 / 队列广播 / WS 订阅 / 出图前都走它（单次 getQueueStats
// 触发 3 次读盘），在事件循环上造成不必要的同步 IO。1 秒对"改 .env 实时生效"
// 而言对人类无感，符合 README 承诺。
let _runtimeEnvCache = { values: null, expiresAt: 0 };

function getRuntimeEnv() {
  const now = Date.now();
  if (!_runtimeEnvCache.values || now >= _runtimeEnvCache.expiresAt) {
    _runtimeEnvCache = {
      values: { ...process.env, ...parseEnvFile() },
      expiresAt: now + 1000,
    };
  }
  return _runtimeEnvCache.values;
}

function loadEnvFile() {
  const values = parseEnvFile();
  for (const [key, value] of Object.entries(values)) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

function normalizeBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function normalizeProtocolBaseUrl(protocol, url) {
  const normalized = normalizeBaseUrl(url);
  if (!normalized) return '';
  if (protocol === 'google') {
    return normalized.endsWith('/v1beta') ? normalized.slice(0, -7) : normalized;
  }
  return normalized.endsWith('/v1') ? normalized.slice(0, -3) : normalized;
}

function resolveNovaApiBaseUrl() {
  return normalizeBaseUrl(getRuntimeEnv().NOVA_API_BASE_URL) || 'https://api.openai.com';
}

function hashPromptGalleryPassword(password) {
  return createHash('sha256')
    .update(`${PROMPT_GALLERY_PASSWORD_SALT}${String(password || '')}`)
    .digest('hex');
}

const PORT = Number(process.env.PORT || 3000);
const HOSTNAME = process.env.HOSTNAME || '0.0.0.0';
const TASK_TTL_MS = 12 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
// 开源版：不再硬编码模型列表，由前端通过 protocol 字段指定协议类型
const VALID_PROTOCOLS = new Set(['google', 'openai']);
const PROMPT_GALLERY_PASSWORD_SALT = 'nova-pg-2026';
const IS_DEV = process.env.NODE_ENV !== 'production';
const STATIC_DIR = path.join(__dirname, '..', 'frontend', 'out');
const taskRefImages = new Map();
// 智能重绘 mask:与参考图同属大 base64,仅运行时内存透传,绝不落 PG。
const taskMasks = new Map();
// 无 JWT 入口(默认单机使用)的任务归属:同一命名空间,行为等同原单用户。
// 有 JWT 时按代验身份隔离。sentinel 不含 '/',可安全作为 MinIO key 前缀。
const STANDALONE_USER_ID = '__standalone__';

// 提示词广场图片代理:浏览器 → 本服务器(国外 CN 精品链路)→ 第三方图床,
// 绕开国内直连第三方被墙的问题。带白名单 + SSRF 防护,见 image-proxy.js。
const imageProxyHandler = createImageProxyHandler({ fetchImpl: globalThis.fetch });

const app = next({ dev: IS_DEV, hostname: HOSTNAME, port: PORT, dir: path.join(__dirname, '..', 'frontend') });
const handle = app.getRequestHandler();
// 任务持久化全部走 PG 网关(由 startServer 注入);verify 用于从 JWT 解析归属。
let taskGateway = null;
let verifyToken = null;
const apiKeys = new Map();
const taskSources = new Map(); // taskId -> { ip, apiKeyHash }
const rateLimitBuckets = new Map(); // key -> { windowStart: number, count: number }
const pendingCountByIp = new Map(); // ip -> count
const pendingCountByApiKeyHash = new Map(); // apiKeyHash -> count
const queue = []; // [{ taskId, slots }]
let activeCount = 0;

// ===== WebSocket subscription state =====
const taskSubscriptions = new Map(); // WebSocket -> Set<taskId>
const queueSubscribers = new Set(); // Set<WebSocket>
const wsAlive = new WeakMap(); // WebSocket -> { lastPong: number, missed: number }
const WS_HEARTBEAT_INTERVAL_MS = 30 * 1000;
const WS_PONG_GRACE_MS = 10 * 1000;
// 单条 subscribeTasks 消息最多处理的 taskId 数，以及单连接订阅总量上限，
// 防止一条消息被放大成大量 DB 查询（DoS 面）。
const WS_MAX_TASK_IDS_PER_MESSAGE = 200;
const WS_MAX_SUBSCRIPTIONS_PER_SOCKET = 500;
// 握手后等待 {type:'auth'} 消息的上限;超时则按未认证处理(多用户模式下订阅会被拒)。
// 仅为兜底,避免 identityReady 在客户端从不发 auth 时永久挂起。
const WS_AUTH_TIMEOUT_MS = 10 * 1000;
let queueBroadcastTimer = null;
let queueBroadcastPending = false;

// WS 任务订阅鉴权守卫。多用户模式下由 startServer 注入(代验身份+归属比对);
// 老单机模式保持默认:身份解析返回 null、订阅一律放行(向后兼容)。
let taskSubscriptionGuard = {
  identify: async () => null,
  canSubscribe: async () => true,
};

function getMaxServerConcurrency() {
  const configured = Number(getRuntimeEnv().NOVA_TASK_CONCURRENCY || GLOBAL_TASK_CONCURRENCY);
  const safeConfigured = Number.isFinite(configured) ? configured : GLOBAL_TASK_CONCURRENCY;
  return Math.max(1, Math.min(GLOBAL_TASK_CONCURRENCY, safeConfigured));
}

function parseIntegerEnv(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function getLimitConfig() {
  const env = getRuntimeEnv();
  return {
    maxQueueSize: parseIntegerEnv(env.NOVA_MAX_QUEUE_SIZE, DEFAULT_LIMIT_CONFIG.maxQueueSize, { min: 0, max: 100000 }),
    rateLimitWindowMs: parseIntegerEnv(env.NOVA_RATE_LIMIT_WINDOW_MS, DEFAULT_LIMIT_CONFIG.rateLimitWindowMs, { min: 1000, max: 24 * 60 * 60 * 1000 }),
    maxRequestsPerIp: parseIntegerEnv(env.NOVA_RATE_LIMIT_MAX_REQUESTS_PER_IP, DEFAULT_LIMIT_CONFIG.maxRequestsPerIp, { min: 0, max: 100000 }),
    maxRequestsPerApiKey: parseIntegerEnv(env.NOVA_RATE_LIMIT_MAX_REQUESTS_PER_API_KEY, DEFAULT_LIMIT_CONFIG.maxRequestsPerApiKey, { min: 0, max: 100000 }),
    maxPendingTasksPerIp: parseIntegerEnv(env.NOVA_MAX_PENDING_TASKS_PER_IP, DEFAULT_LIMIT_CONFIG.maxPendingTasksPerIp, { min: 0, max: 100000 }),
    maxPendingTasksPerApiKey: parseIntegerEnv(env.NOVA_MAX_PENDING_TASKS_PER_API_KEY, DEFAULT_LIMIT_CONFIG.maxPendingTasksPerApiKey, { min: 0, max: 100000 }),
    retryAfterSeconds: parseIntegerEnv(env.NOVA_RATE_LIMIT_RETRY_AFTER_SECONDS, DEFAULT_LIMIT_CONFIG.retryAfterSeconds, { min: 1, max: 24 * 60 * 60 }),
  };
}

function createHttpError(statusCode, code, message, retryAfterSeconds) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.retryAfter = retryAfterSeconds;
  return error;
}

function isHttpError(error) {
  return error && typeof error.statusCode === 'number' && typeof error.code === 'string';
}

function getClientIp(req) {
  const forwardedFor = req?.headers?.['x-forwarded-for'];
  const firstForwarded = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const ip = String(firstForwarded || '').split(',')[0].trim()
    || req?.socket?.remoteAddress
    || 'unknown';
  return ip.replace(/^::ffff:/, '');
}

function hashApiKey(apiKey) {
  return createHash('sha256').update(String(apiKey || '')).digest('hex').slice(0, 24);
}

function cleanupTaskRuntimeState(taskId) {
  const source = taskSources.get(taskId);
  if (source) {
    // 递减 IP 计数
    if (source.ip) {
      const ipCount = pendingCountByIp.get(source.ip) || 0;
      if (ipCount <= 1) {
        pendingCountByIp.delete(source.ip);
      } else {
        pendingCountByIp.set(source.ip, ipCount - 1);
      }
    }
    // 递减 apiKeyHash 计数
    if (source.apiKeyHash) {
      const hashCount = pendingCountByApiKeyHash.get(source.apiKeyHash) || 0;
      if (hashCount <= 1) {
        pendingCountByApiKeyHash.delete(source.apiKeyHash);
      } else {
        pendingCountByApiKeyHash.set(source.apiKeyHash, hashCount - 1);
      }
    }
  }
  apiKeys.delete(taskId);
  taskRefImages.delete(taskId);
  taskMasks.delete(taskId);
  taskSources.delete(taskId);
}

function getPendingCountForSource(fieldName, value) {
  if (!value) return 0;
  // O(1) 查找：使用独立计数器代替遍历 taskSources
  if (fieldName === 'ip') return pendingCountByIp.get(value) || 0;
  if (fieldName === 'apiKeyHash') return pendingCountByApiKeyHash.get(value) || 0;
  // fallback：未知字段仍用遍历（不应发生）
  let count = 0;
  for (const source of taskSources.values()) {
    if (source?.[fieldName] === value) count++;
  }
  return count;
}

function consumeRateLimit(bucketKey, maxRequests, windowMs) {
  if (maxRequests <= 0) {
    return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }
  const now = Date.now();
  const existing = rateLimitBuckets.get(bucketKey);
  if (!existing || now - existing.windowStart >= windowMs) {
    rateLimitBuckets.set(bucketKey, { windowStart: now, count: 1 });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (existing.count >= maxRequests) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - existing.windowStart)) / 1000)) };
  }
  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

function cleanupRateLimitBuckets() {
  const now = Date.now();
  const maxWindowMs = getLimitConfig().rateLimitWindowMs;
  for (const [key, bucket] of rateLimitBuckets) {
    if (!bucket || now - bucket.windowStart > maxWindowMs * 2) {
      rateLimitBuckets.delete(key);
    }
  }
}

function enforceRateLimit(req, body, config) {
  const ip = getClientIp(req);
  const apiKeyHash = hashApiKey(body.apiKey);
  const ipLimit = consumeRateLimit(`ip:${ip}`, config.maxRequestsPerIp, config.rateLimitWindowMs);
  if (!ipLimit.allowed) {
    throw createHttpError(429, 'RATE_LIMITED', LIMIT_ERROR_MESSAGES.rateLimited, Math.max(config.retryAfterSeconds, ipLimit.retryAfterSeconds));
  }
  const apiKeyLimit = consumeRateLimit(`api:${apiKeyHash}`, config.maxRequestsPerApiKey, config.rateLimitWindowMs);
  if (!apiKeyLimit.allowed) {
    throw createHttpError(429, 'RATE_LIMITED', LIMIT_ERROR_MESSAGES.rateLimited, Math.max(config.retryAfterSeconds, apiKeyLimit.retryAfterSeconds));
  }
  return { ip, apiKeyHash };
}

async function enforceQueueCapacity(source, config) {
  const stats = await getQueueStats();
  if (stats.pendingCount >= config.maxQueueSize) {
    throw createHttpError(503, 'QUEUE_FULL', LIMIT_ERROR_MESSAGES.queueFull, config.retryAfterSeconds);
  }
  if (getPendingCountForSource('ip', source.ip) >= config.maxPendingTasksPerIp) {
    throw createHttpError(429, 'TOO_MANY_PENDING_TASKS', LIMIT_ERROR_MESSAGES.tooManyPending, config.retryAfterSeconds);
  }
  if (getPendingCountForSource('apiKeyHash', source.apiKeyHash) >= config.maxPendingTasksPerApiKey) {
    throw createHttpError(429, 'TOO_MANY_PENDING_TASKS', LIMIT_ERROR_MESSAGES.tooManyPending, config.retryAfterSeconds);
  }
}

function isRejectNewTasksEnabled() {
  const env = getRuntimeEnv();
  const rejectSwitch = String(env.NOVA_REJECT_NEW_TASKS || '').trim().toLowerCase();
  const acceptSwitch = String(env.NOVA_ACCEPT_NEW_TASKS || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(rejectSwitch) || acceptSwitch === 'false' || acceptSwitch === '0';
}

async function getQueueStats() {
  const config = getLimitConfig();
  const { queuedCount, processingCount } = await taskGateway.getQueueCounts();
  const totalActiveTasks = processingCount + queuedCount;
  const acceptingNewTasks = !isRejectNewTasksEnabled();

  return {
    concurrencyLimit: GLOBAL_TASK_CONCURRENCY,
    configuredConcurrency: getMaxServerConcurrency(),
    processingCount,
    queuedCount,
    pendingCount: totalActiveTasks,
    maxQueueSize: config.maxQueueSize,
    remainingQueueSlots: Math.max(0, config.maxQueueSize - totalActiveTasks),
    displayConcurrency: Math.min(GLOBAL_TASK_CONCURRENCY, totalActiveTasks),
    displayQueued: Math.max(0, totalActiveTasks - GLOBAL_TASK_CONCURRENCY),
    acceptingNewTasks,
    rateLimitWindowMs: config.rateLimitWindowMs,
    rateLimitMaxRequestsPerIp: config.maxRequestsPerIp,
    rateLimitMaxRequestsPerApiKey: config.maxRequestsPerApiKey,
    retryAfterSeconds: config.retryAfterSeconds,
    serverMessage: acceptingNewTasks ? undefined : LIMIT_ERROR_MESSAGES.notAcceptingTasks,
  };
}

// ===== 任务持久化(PG + MinIO,经 taskGateway)=====
// 图片本体落 MinIO,前端用预签名 URL 读取;不再有本地磁盘图片与磁盘清理逻辑。

function sendJson(res, statusCode, body, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

function sendHttpError(res, error) {
  const headers = {};
  if (error.retryAfter) {
    headers['Retry-After'] = String(error.retryAfter);
  }
  // 413 时请求体可能仍在上传，保持 keep-alive 会让残留入站数据干扰下个请求；
  // 显式关闭连接，确保客户端能干净收到这条错误响应。
  if (error.statusCode === 413) {
    headers['Connection'] = 'close';
  }
  sendJson(res, error.statusCode, {
    error: normalizeError(error),
    code: error.code,
    retryAfter: error.retryAfter,
  }, headers);
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
  }[ext] || 'application/octet-stream';
}

// 统一的文件流响应：必须挂 'error' 监听，否则流中途出错（文件被删 / EACCES /
// 磁盘错）会抛出未捕获异常拖垮整个进程。头已发出时只能断开连接。
function pipeFileToResponse(res, filePath, statusCode, headers) {
  const stream = fs.createReadStream(filePath);
  stream.on('error', error => {
    console.warn(`[static] 文件流读取失败: ${filePath}`, error?.message || error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal Server Error');
    } else {
      res.destroy(error);
    }
  });
  res.writeHead(statusCode, headers);
  stream.pipe(res);
}

function serveStatic(_req, res, pathname) {
  if (!fs.existsSync(STATIC_DIR)) return false;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname || '/');
  } catch {
    decodedPath = (pathname || '/').replace(/%(?![0-9a-fA-F]{2})/g, '');
  }
  // 路径遍历防护：规范化后检测 .. 路径段，提前拒绝
  const normalizedPath = path.normalize(decodedPath);
  if (normalizedPath.includes('..')) return false;

  const candidates = [];
  if (normalizedPath.endsWith('/') || normalizedPath.endsWith(path.sep)) {
    candidates.push(path.join(STATIC_DIR, normalizedPath, 'index.html'));
  } else {
    candidates.push(path.join(STATIC_DIR, normalizedPath));
    candidates.push(path.join(STATIC_DIR, `${normalizedPath}.html`));
    candidates.push(path.join(STATIC_DIR, normalizedPath, 'index.html'));
  }

  const staticDirResolved = path.resolve(STATIC_DIR) + path.sep;
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!resolved.startsWith(staticDirResolved) && resolved !== staticDirResolved.slice(0, -1)) continue;
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) continue;
    pipeFileToResponse(res, resolved, 200, { 'Content-Type': getContentType(resolved) });
    return true;
  }

  const notFound = path.join(STATIC_DIR, '404.html');
  if (fs.existsSync(notFound)) {
    pipeFileToResponse(res, notFound, 404, { 'Content-Type': 'text/html; charset=utf-8' });
    return true;
  }
  return false;
}

const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024; // 10MB

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let aborted = false;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      if (aborted) return;
      raw += chunk;
      if (raw.length > MAX_REQUEST_BODY_BYTES) {
        aborted = true;
        raw = ''; // 释放已缓冲内存
        // 不再 req.destroy()：直接重置连接会让客户端收到 ERR_CONNECTION_RESET，
        // 看不到任何错误信息。改为排空剩余入站数据，并以 413 优雅返回（catch -> sendHttpError）。
        req.resume();
        reject(createHttpError(413, 'PAYLOAD_TOO_LARGE', '请求体过大：参考图过多或分辨率过高，请减少参考图数量或降低分辨率后重试。'));
      }
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('请求 JSON 格式无效'));
      }
    });
    req.on('error', reject);
  });
}

function normalizeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/failed to fetch|fetch failed|networkerror|network request failed|load failed|network connection was lost|econnreset|socket hang up|terminated/i.test(message)) {
    return '网络连接失败。请检查服务器网络连接或稍后重试。';
  }
  if (/abort|timeout|timed out/i.test(message)) {
    return `请求超时（${REQUEST_TIMEOUT_MS / 1000}秒）。高分辨率图片生成需要更长时间，请稍后重试。`;
  }
  // 截断非预定义错误消息，避免泄露内部信息（文件路径、堆栈等）
  return message.length > 200 ? message.slice(0, 200) + '…' : message;
}

function validateCreatePayload(body) {
  if (!body || typeof body !== 'object') throw new Error('请求体不能为空');
  if (typeof body.apiKey !== 'string' || body.apiKey.trim().length === 0) throw new Error('缺少 API 密钥');
  if (typeof body.baseUrl !== 'string' || body.baseUrl.trim().length === 0) throw new Error('缺少 API 基础地址');
  if (!VALID_PROTOCOLS.has(body.protocol)) throw new Error('协议类型无效，必须为 google 或 openai');
  if (body.mode !== 'text-to-image' && body.mode !== 'image-to-image') throw new Error('任务模式无效');
  if (typeof body.prompt !== 'string' || body.prompt.trim().length === 0) throw new Error('提示词不能为空');
  if (typeof body.model !== 'string' || body.model.trim().length === 0) throw new Error('模型名称不能为空');
  if (!Number.isInteger(body.parallelCount) || body.parallelCount < 1 || body.parallelCount > 4) throw new Error('并发数量无效');

  if (!Array.isArray(body.images)) body.images = [];
  body.baseUrl = normalizeProtocolBaseUrl(body.protocol, body.baseUrl);
  if (!body.baseUrl) throw new Error('缺少 API 基础地址');
  // 开源版：不做模型级参数规范化，前端负责传递正确的参数，后端无条件透传
}

/**
 * 解析任务归属 userId:有合法 JWT 用代验身份(按用户隔离),否则用单机命名空间。
 * 代验失败/不可达一律回退单机命名空间(不阻断默认无登录使用)。
 */
async function resolveTaskUserId(req) {
  if (!verifyToken) return STANDALONE_USER_ID;
  const token = extractToken(req);
  if (!token) return STANDALONE_USER_ID;
  try {
    const identity = await verifyToken(token);
    if (identity && identity.userId !== undefined && identity.userId !== null) {
      return String(identity.userId);
    }
  } catch {
    // 代验不可达:回退单机命名空间
  }
  return STANDALONE_USER_ID;
}

async function createTask(body, req) {
  validateCreatePayload(body);
  const limitConfig = getLimitConfig();
  if (isRejectNewTasksEnabled()) {
    throw createHttpError(503, 'SERVER_NOT_ACCEPTING_TASKS', LIMIT_ERROR_MESSAGES.notAcceptingTasks, limitConfig.retryAfterSeconds);
  }
  const source = enforceRateLimit(req, body, limitConfig);
  await enforceQueueCapacity(source, limitConfig);

  const userId = await resolveTaskUserId(req);
  const taskId = randomUUID();
  const requestForDb = {
    mode: body.mode,
    source: 'nova',
    protocol: body.protocol,
    baseUrl: body.baseUrl,
    prompt: body.prompt,
    outputSize: body.outputSize,
    customSize: body.customSize,
    aspectRatio: body.aspectRatio,
    temperature: body.temperature,
    model: body.model,
    gptImageQuality: body.gptImageQuality,
    gptImageStyle: body.gptImageStyle,
    gptImageBackground: body.gptImageBackground,
    parallelCount: body.parallelCount,
    images: body.images.map(img => ({ mimeType: img.mimeType })),
    // sub2api 模型选中的 API Key id;loopback 到 /api/proxy 时作为 X-Sub2api-Key-Id 头转发
    ...(typeof body.keyId === 'string' && body.keyId.trim() ? { keyId: body.keyId.trim() } : {}),
  };
  await taskGateway.createTask(userId, {
    taskId,
    mode: body.mode,
    requestForDb,
    parallelCount: body.parallelCount,
  });

  apiKeys.set(taskId, body.apiKey);
  taskRefImages.set(taskId, body.images);
  // 智能重绘 mask:仅运行时内存暂存,与参考图一样不写入 requestForDb / PG。
  if (body.mask && typeof body.mask.data === 'string' && body.mask.data.length > 0) {
    taskMasks.set(taskId, { data: body.mask.data, mimeType: body.mask.mimeType || 'image/png' });
  }
  taskSources.set(taskId, source);
  // 递增 pending 计数
  if (source.ip) pendingCountByIp.set(source.ip, (pendingCountByIp.get(source.ip) || 0) + 1);
  if (source.apiKeyHash) pendingCountByApiKeyHash.set(source.apiKeyHash, (pendingCountByApiKeyHash.get(source.apiKeyHash) || 0) + 1);
  queue.push({ taskId, slots: body.parallelCount || 1 });
  await broadcastTask(taskId);
  broadcastQueueStatus();
  drainQueue();
  return taskId;
}

function parseJsonSafely(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isLikelyHtmlResponse(text) {
  const trimmed = String(text || '').trim().toLowerCase();
  return trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html') || trimmed.startsWith('<head') || trimmed.startsWith('<body');
}

function summarizeUnexpectedResponse(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  if (isLikelyHtmlResponse(trimmed)) {
    return '上游返回了 HTML 页面而不是 JSON。通常是 baseUrl 配置错误、请求被站点网关拦截，或该地址并非兼容的图片 API。';
  }
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
}

function getMessageFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message.trim();

  const error = payload.error;
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error && typeof error === 'object') {
    if (typeof error.message === 'string' && error.message.trim()) return error.message.trim();
    if (typeof error.code === 'string' && error.code.trim()) return error.code.trim();
  }

  return '';
}

function getErrorMessageFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (payload.error) return getMessageFromPayload(payload);

  const type = typeof payload.type === 'string' ? payload.type.toLowerCase() : '';
  if (type === 'error' || type === 'upstream_error') return getMessageFromPayload(payload);

  return '';
}

function getUpstreamErrorText(text) {
  const trimmed = String(text || '').trim();
  const data = parseJsonSafely(trimmed);
  const message = getErrorMessageFromPayload(data) || getMessageFromPayload(data);
  if (message) return message;
  return trimmed.length > 500 ? `${trimmed.slice(0, 500)}…` : trimmed;
}

function normalizeImagePayloadValue(imageData) {
  if (!imageData || typeof imageData !== 'string') return undefined;
  if (imageData.startsWith('data:image')) return imageData.split(',')[1] || imageData;
  if (/^https?:\/\//i.test(imageData)) return `URL:${imageData}`;
  return imageData;
}

function getImagePayloadValue(data, depth = 0) {
  if (!data || depth > 3) return undefined;
  if (Array.isArray(data)) {
    for (const item of data) {
      const value = getImagePayloadValue(item, depth + 1);
      if (value) return value;
    }
    return undefined;
  }
  if (typeof data !== 'object') return undefined;

  const firstImage = Array.isArray(data.data)
    ? data.data.find(item => item && typeof item === 'object' && (item.b64_json || item.url || item.image_url))
    : undefined;
  const imageData = firstImage?.b64_json || firstImage?.url || firstImage?.image_url
    || data.b64_json || data.url || data.image_url;
  if (imageData) return imageData;

  return getImagePayloadValue(data.result, depth + 1)
    || getImagePayloadValue(data.response, depth + 1)
    || getImagePayloadValue(data.output, depth + 1);
}

function extractImagePayload(data) {
  const imageData = normalizeImagePayloadValue(getImagePayloadValue(data));
  if (!imageData) throw new Error('响应中无图片数据');
  return imageData;
}

function parseImageEventStream(text) {
  const payloads = [];
  let dataLines = [];

  const flush = () => {
    if (dataLines.length === 0) return;
    const raw = dataLines.join('\n').trim();
    dataLines = [];
    if (!raw || raw === '[DONE]') return;
    const parsed = parseJsonSafely(raw);
    if (parsed) payloads.push(parsed);
  };

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line === '') {
      flush();
      continue;
    }
    if (line.startsWith(':')) continue;
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  flush();

  return payloads;
}

function isPartialImageEvent(payload) {
  const type = typeof payload?.type === 'string' ? payload.type.toLowerCase() : '';
  return type.includes('partial');
}

function extractImagePayloadFromEventStream(text) {
  const payloads = parseImageEventStream(text);
  const errorMessage = payloads.map(getErrorMessageFromPayload).find(Boolean);

  for (const payload of [...payloads].reverse()) {
    if (isPartialImageEvent(payload)) continue;
    try {
      return extractImagePayload(payload);
    } catch {
      // Keep scanning earlier events.
    }
  }

  if (errorMessage) throw new Error(errorMessage);
  throw new Error('响应中无图片数据');
}

async function parseGptImageResponse(response) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const responseText = await response.text();

  if (!response.ok) {
    const errorText = getUpstreamErrorText(responseText);
    throw new Error(`API 请求失败: ${response.status}${errorText ? ` ${errorText}` : ''}`);
  }

  if (contentType.includes('text/event-stream')) {
    return extractImagePayloadFromEventStream(responseText);
  }

  if (isLikelyHtmlResponse(responseText)) {
    throw new Error('上游返回了 HTML 页面而不是 JSON。通常是 baseUrl 配置错误、请求被站点网关拦截，或该地址并非兼容的图片 API。');
  }

  const data = parseJsonSafely(responseText);
  if (!data) {
    const summary = summarizeUnexpectedResponse(responseText);
    throw new Error(summary ? `响应 JSON 格式无效: ${summary}` : '响应 JSON 格式无效');
  }

  const errorMessage = getErrorMessageFromPayload(data);
  if (errorMessage) throw new Error(errorMessage);

  return extractImagePayload(data);
}

async function requestGptImage(apiKey, request, resolvedSize, options = {}) {
  const baseUrl = options.baseUrl || resolveNovaApiBaseUrl();
  const endpoint = request.mode === 'image-to-image'
    ? '/v1/images/edits'
    : '/v1/images/generations';
  const response = await fetchWithTimeout(
    `${baseUrl}${endpoint}`,
    createGptImageRequestInit(apiKey, request, resolvedSize, options)
  );
  return parseGptImageResponse(response);
}

// ===== 加强网络连接：启用 TCP keepalive，防止 Docker 回环连接被静默断开 =====
// Node.js 内置 fetch 基于 undici，默认不发送 TCP keepalive，
// 导致长时间等待响应（如 4K 图片生成）时连接被 Docker 网络层丢弃。
// 通过 setGlobalDispatcher 配置 undici Agent 的 keepalive 和超时参数。
try {
  const { Agent, setGlobalDispatcher } = require('undici');
  setGlobalDispatcher(new Agent({
    keepAliveTimeout: 60 * 1000,         // 空闲连接保持 60 秒
    keepAliveMaxTimeout: 10 * 60 * 1000, // 最大保持 10 分钟
    connect: {
      keepAlive: true,
      keepAliveInitialDelay: 15000,      // 15 秒后开始发送 TCP keepalive 探测
    },
    bodyTimeout: REQUEST_TIMEOUT_MS,     // 等待响应体的超时（与 abort 超时一致）
    headersTimeout: REQUEST_TIMEOUT_MS,  // 图片生成可能长时间等待响应头，需与任务超时一致
  }));
  console.log('[network] undici Agent 已配置: TCP keepalive=15s, timeout=30min');
} catch (e) {
  console.warn('[network] undici Agent 配置失败，使用默认设置:', e?.message || e);
}

async function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function generateNovaImage(apiKey, request) {
  // 开源版：根据前端传入的 protocol 字段路由到对应的 API 协议
  const baseUrl = request.baseUrl || resolveNovaApiBaseUrl();
  if (request.protocol === 'openai') {
    // sub2api 模型:把选中的 keyId 透传给 loopback 代理(后端据此代查 sk- key)
    return requestGptImage(apiKey, request, undefined, { baseUrl, keyId: request.keyId });
  }
  // 默认走 Google Gemini 协议
  return generateNovaGeminiImage(apiKey, request, { baseUrl });
}

function extractGeminiImagePayload(data) {
  const imagePart = data?.candidates?.[0]?.content?.parts?.find(part => part?.inlineData?.data || part?.inline_data?.data);
  const inlineData = imagePart?.inlineData || imagePart?.inline_data;
  if (!inlineData?.data) throw new Error('响应中无图片数据');
  return inlineData.data;
}

async function generateNovaGeminiImage(apiKey, request, options = {}) {
  const baseUrl = options.baseUrl || resolveNovaApiBaseUrl();
  const parts = [
    { text: request.prompt },
    ...request.images.map(img => ({ inlineData: { data: img.data, mimeType: img.mimeType } })),
  ];
  const response = await fetchWithTimeout(`${baseUrl}/v1beta/models/${encodeURIComponent(request.model)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: request.temperature,
        responseModalities: ['IMAGE'],
        imageConfig: { imageSize: request.outputSize, aspectRatio: request.aspectRatio },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API 请求失败: ${response.status} ${errorText}`);
  }

  const responseText = await response.text();
  if (isLikelyHtmlResponse(responseText)) {
    throw new Error('上游返回了 HTML 页面而不是 JSON。通常是 baseUrl 配置错误、请求被站点网关拦截，或该地址并非兼容的图片 API。');
  }
  const data = parseJsonSafely(responseText);
  if (!data) {
    const summary = summarizeUnexpectedResponse(responseText);
    throw new Error(summary ? `响应 JSON 格式无效: ${summary}` : '响应 JSON 格式无效');
  }
  return extractGeminiImagePayload(data);
}

function drainQueue() {
  const maxConcurrency = getMaxServerConcurrency();
  while (queue.length > 0) {
    const { taskId, slots } = queue[0];
    const imageSlots = slots || 1;

    // 容量足够 → 放行。容量不足时唯一例外：当前空闲（activeCount===0）且该任务
    // 自身就超过总并发，允许其独占运行（否则永远无法被调度）；其余情况一律等待
    // 在飞任务腾出名额。
    const fitsWithinLimit = activeCount + imageSlots <= maxConcurrency;
    const oversizedTaskCanRunAlone = activeCount === 0 && imageSlots > maxConcurrency;
    if (!fitsWithinLimit && !oversizedTaskCanRunAlone) break;

    queue.shift();
    activeCount += imageSlots;
    runTask(taskId).finally(() => {
      activeCount -= imageSlots;
      drainQueue();
    });
  }
}

// runTask 委托给 PG 任务网关(multi-user store: PG + MinIO)。
// 队列/并发/限流/运行时计数仍留在 server.js(与存储后端正交)。
async function runTask(taskId) {
  const apiKey = apiKeys.get(taskId);
  const refImages = taskRefImages.get(taskId);
  const mask = taskMasks.get(taskId);
  try {
    // 网关按归属 userId 跑引擎(状态校验→生成→落 MinIO→收尾)。
    await taskGateway.runTask(taskId, apiKey, refImages, mask);
  } finally {
    taskGateway.cleanupRuntime(taskId);
    cleanupTaskRuntimeState(taskId);
    broadcastQueueStatus();
  }
}

async function deleteTask(taskId) {
  // 网关删除 PG 记录 + MinIO 对象(best-effort)。
  await taskGateway.deleteTask(taskId);
  cleanupTaskRuntimeState(taskId);
  broadcastQueueStatus();
}

async function cleanupExpiredTasks() {
  let ids;
  try {
    ids = await taskGateway.listExpiredIds(new Date());
  } catch (error) {
    console.warn('[cleanup] 列举过期任务失败:', error?.message || error);
    return;
  }
  let successCount = 0;
  let failCount = 0;
  for (const id of ids) {
    broadcastTaskExpired(id);
    try {
      await deleteTask(id);
      successCount++;
    } catch (error) {
      failCount++;
      console.warn(`[cleanup] 过期任务删除失败: taskId=${id}`, error?.message || error);
    }
  }
  if (ids.length > 0) {
    console.log(`[cleanup] 本轮过期清理: 检查${ids.length}个任务, 成功${successCount}个, 失败${failCount}个`);
  }
}

// ===== WebSocket broadcasting =====

function safeSendJson(ws, payload) {
  try {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify(payload));
  } catch (error) {
    console.warn('[ws] send failed', error?.message || error);
  }
}

async function broadcastTask(taskId) {
  if (!taskId) return;
  let cachedPayload;
  for (const [ws, set] of taskSubscriptions) {
    if (!set.has(taskId)) continue;
    if (cachedPayload === undefined) {
      const task = await taskGateway.serialize(taskId) || { id: taskId, status: 'expired', error: '该任务已超出取回时间' };
      cachedPayload = { type: 'task', task };
    }
    safeSendJson(ws, cachedPayload);
    if (cachedPayload.task.status === 'completed' || cachedPayload.task.status === 'failed' || cachedPayload.task.status === 'expired') {
      set.delete(taskId);
    }
  }
}

function broadcastTaskExpired(taskId) {
  const payload = { type: 'task', task: { id: taskId, status: 'expired', error: '该任务已超出取回时间' } };
  for (const [ws, set] of taskSubscriptions) {
    if (!set.has(taskId)) continue;
    safeSendJson(ws, payload);
    set.delete(taskId);
  }
}

async function flushQueueBroadcast() {
  queueBroadcastTimer = null;
  if (!queueBroadcastPending) return;
  queueBroadcastPending = false;
  if (queueSubscribers.size === 0) return;
  let stats;
  try {
    stats = await getQueueStats();
  } catch (error) {
    console.warn('[ws] 队列状态广播失败:', error?.message || error);
    return;
  }
  const payload = { type: 'queueStatus', stats };
  for (const ws of queueSubscribers) {
    safeSendJson(ws, payload);
  }
}

function broadcastQueueStatus() {
  queueBroadcastPending = true;
  if (queueBroadcastTimer) return;
  queueBroadcastTimer = setTimeout(() => { flushQueueBroadcast(); }, 200);
}

async function handleSubscribeTasks(ws, taskIds) {
  if (!Array.isArray(taskIds)) return;
  // 等待握手期身份解析完成(竞态保护),再做归属鉴权。
  if (ws.identityReady) {
    try { await ws.identityReady; } catch { /* 身份解析失败按未认证处理 */ }
  }
  let set = taskSubscriptions.get(ws);
  if (!set) {
    set = new Set();
    taskSubscriptions.set(ws, set);
  }
  for (const id of taskIds.slice(0, WS_MAX_TASK_IDS_PER_MESSAGE)) {
    if (typeof id !== 'string' || !id) continue;
    // 已达单连接订阅上限且是新 id 时停止，避免无限增长。
    if (!set.has(id) && set.size >= WS_MAX_SUBSCRIPTIONS_PER_SOCKET) break;
    // 多用户模式:仅允许订阅自己拥有的任务(fail-closed)。老单机模式恒放行。
    const allowed = await taskSubscriptionGuard.canSubscribe(ws.userId, id);
    if (!allowed) {
      safeSendJson(ws, { type: 'error', code: 'FORBIDDEN', message: '无权订阅该任务' });
      continue;
    }
    set.add(id);
    const task = await taskGateway.serialize(id) || { id, status: 'expired', error: '该任务已超出取回时间' };
    safeSendJson(ws, { type: 'task', task });
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'expired') {
      set.delete(id);
    }
  }
}

async function handleAuth(ws, token) {
  // 代验 token → 绑定 userId 并 settle identityReady。失败时 settle(null)(未认证),
  // 让多用户订阅守卫 fail-closed。重复 auth 仅首条生效(_settleIdentity 幂等)。
  let userId;
  try {
    userId = await taskSubscriptionGuard.identifyToken(token);
  } catch {
    userId = null;
  }
  if (typeof ws._settleIdentity === 'function') ws._settleIdentity(userId);
}

function handleUnsubscribeTasks(ws, taskIds) {
  const set = taskSubscriptions.get(ws);
  if (!set || !Array.isArray(taskIds)) return;
  for (const id of taskIds) {
    set.delete(id);
  }
}

async function handleSubscribeQueue(ws) {
  queueSubscribers.add(ws);
  try {
    const stats = await getQueueStats();
    safeSendJson(ws, { type: 'queueStatus', stats });
  } catch (error) {
    console.warn('[ws] 初始队列状态发送失败:', error?.message || error);
  }
}

function handleClientMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    safeSendJson(ws, { type: 'error', code: 'INVALID_JSON', message: '消息不是合法 JSON' });
    return;
  }
  if (!msg || typeof msg.type !== 'string') {
    safeSendJson(ws, { type: 'error', code: 'INVALID_TYPE', message: '消息缺少 type' });
    return;
  }
  switch (msg.type) {
    case 'auth':
      // 连接后身份认证(token 不走 URL)。异步代验;错误不影响其余消息处理。
      handleAuth(ws, msg.token).catch((error) => {
        console.warn('[ws] auth failed', error?.message || error);
      });
      break;
    case 'subscribeTasks':
      // 异步守卫鉴权;错误不影响连接其余消息处理。
      handleSubscribeTasks(ws, msg.taskIds).catch((error) => {
        console.warn('[ws] subscribeTasks failed', error?.message || error);
      });
      break;
    case 'unsubscribeTasks':
      handleUnsubscribeTasks(ws, msg.taskIds);
      break;
    case 'subscribeQueue':
      handleSubscribeQueue(ws).catch((error) => {
        console.warn('[ws] subscribeQueue 处理失败:', error?.message || error);
      });
      break;
    case 'unsubscribeQueue':
      queueSubscribers.delete(ws);
      break;
    case 'ping':
      safeSendJson(ws, { type: 'pong' });
      break;
    default:
      safeSendJson(ws, { type: 'error', code: 'UNKNOWN_TYPE', message: `未知的 type: ${msg.type}` });
  }
}

function setupWebSocketServer() {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws, req) => {
    wsAlive.set(ws, { lastPong: Date.now(), missed: 0 });

    // 多用户模式:身份既可来自握手 URL 的 ?token=(老入口首跳兼容),也可来自连接
    // 建立后客户端发送的 {type:'auth', token} 消息(token 不进 URL,符合安全约束)。
    // identityReady 是一个 deferred:任一路径解出 userId 即 resolve;两者都失败或超时
    // 则按未认证处理(ws.userId 保持 null,多用户订阅守卫 fail-closed 拒绝)。
    // handleSubscribeTasks 会 await identityReady,避免订阅消息早于身份解析的竞态。
    ws.userId = null;
    let identityResolved = false;
    let resolveIdentity;
    ws.identityReady = new Promise((resolve) => { resolveIdentity = resolve; });
    ws._settleIdentity = (userId) => {
      if (identityResolved) return;
      identityResolved = true;
      if (userId !== null && userId !== undefined) ws.userId = userId;
      resolveIdentity();
    };
    // 兜底超时:客户端从不发 auth 时,避免 identityReady 永久挂起。
    const authTimer = setTimeout(() => ws._settleIdentity(null), WS_AUTH_TIMEOUT_MS);
    if (authTimer.unref) authTimer.unref();
    // 老入口首跳:URL 带 ?token= 时立即代验(成功才提前 settle,失败留给 auth 消息)。
    taskSubscriptionGuard.identify(req && req.url ? req.url : '')
      .then((userId) => { if (userId) ws._settleIdentity(userId); })
      .catch(() => { /* 留给 auth 消息或超时 */ });

    ws.on('message', data => {
      handleClientMessage(ws, data.toString());
    });

    ws.on('pong', () => {
      const state = wsAlive.get(ws);
      if (state) {
        state.lastPong = Date.now();
        state.missed = 0;
      }
    });

    ws.on('close', () => {
      taskSubscriptions.delete(ws);
      queueSubscribers.delete(ws);
      wsAlive.delete(ws);
    });

    ws.on('error', error => {
      console.warn('[ws] connection error', error?.message || error);
    });
  });

  setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.readyState !== ws.OPEN) continue;
      const state = wsAlive.get(ws);
      if (!state) continue;
      if (Date.now() - state.lastPong > WS_HEARTBEAT_INTERVAL_MS + WS_PONG_GRACE_MS) {
        state.missed += 1;
        if (state.missed >= 2) {
          try { ws.terminate(); } catch { /* ignore */ }
          continue;
        }
      }
      try { ws.ping(); } catch { /* ignore */ }
    }
  }, WS_HEARTBEAT_INTERVAL_MS).unref();

  return wss;
}

async function handleApi(req, res, pathname) {
  try {
    const apiPathname = pathname.replace(/\/+$/, '');

    if (req.method === 'GET' && apiPathname === '/api/nova/queue-status') {
      sendJson(res, 200, await getQueueStats());
      return true;
    }

    if (req.method === 'GET' && apiPathname === '/api/nova/img-proxy') {
      await imageProxyHandler(req, res);
      return true;
    }

    if (req.method === 'GET' && apiPathname === '/api/nova/prompts') {
      const promptsPath = path.join(__dirname, 'prompts.json');
      try {
        if (!fs.existsSync(promptsPath)) {
          sendJson(res, 200, []);
          return true;
        }
        const raw = fs.readFileSync(promptsPath, 'utf8');
        const data = JSON.parse(raw);
        sendJson(res, 200, Array.isArray(data) ? data : []);
      } catch {
        sendJson(res, 200, []);
      }
      return true;
    }

    if (req.method === 'GET' && apiPathname === '/api/nova/blacklist') {
      const blacklistPath = path.join(__dirname, 'blacklist.json');
      try {
        if (!fs.existsSync(blacklistPath)) {
          sendJson(res, 200, { keywords: [] });
          return true;
        }
        const raw = fs.readFileSync(blacklistPath, 'utf8');
        const data = JSON.parse(raw);
        sendJson(res, 200, { keywords: Array.isArray(data.keywords) ? data.keywords : [] });
      } catch {
        sendJson(res, 200, { keywords: [] });
      }
      return true;
    }

    if (req.method === 'GET' && apiPathname === '/api/nova/config') {
      const env = getRuntimeEnv();
      const rawMode = String(env.PROMPT_GALLERY_MODE || '2').trim();
      const mode = ['1', '2', '3'].includes(rawMode) ? rawMode : '2';
      sendJson(res, 200, {
        promptGalleryMode: mode,
        promptGalleryPasswordEnabled: String(env.PROMPT_GALLERY_PASSWORD || '').trim().length > 0,
      });
      return true;
    }

    if (req.method === 'POST' && apiPathname === '/api/nova/prompt-gallery/verify') {
      const env = getRuntimeEnv();
      const expected = String(env.PROMPT_GALLERY_PASSWORD || '').trim();
      if (!expected) {
        sendJson(res, 200, { ok: true });
        return true;
      }

      const body = await readJsonBody(req);
      const password = String(body?.password || '');
      const ok = hashPromptGalleryPassword(password) === hashPromptGalleryPassword(expected);
      sendJson(res, 200, { ok });
      return true;
    }

    if (req.method === 'POST' && apiPathname === '/api/nova/tasks') {
      const body = await readJsonBody(req);
      const taskId = await createTask(body, req);
      sendJson(res, 202, { taskId });
      return true;
    }

    const match = apiPathname.match(/^\/api\/nova\/tasks\/([^/]+)(?:\/(ack))?$/);
    if (!match) return false;
    const taskId = decodeURIComponent(match[1]);
    const action = match[2];

    if (req.method === 'GET' && !action) {
      const task = await taskGateway.serialize(taskId);
      sendJson(res, task ? 200 : 404, task || { id: taskId, status: 'expired', error: '该任务已超出取回时间' });
      return true;
    }

    if (req.method === 'POST' && action === 'ack') {
      const ACK_GRACE_MS = 120 * 1000;
      await taskGateway.touchExpiry(taskId, new Date(Date.now() + ACK_GRACE_MS));
      sendJson(res, 200, { ok: true });
      return true;
    }

    sendJson(res, 405, { error: 'Method Not Allowed' });
    return true;
  } catch (error) {
    if (isHttpError(error)) {
      sendHttpError(res, error);
    } else if (error && typeof error.statusCode === 'number') {
      sendJson(res, error.statusCode, { error: normalizeError(error) });
    } else {
      sendJson(res, 400, { error: normalizeError(error) });
    }
    return true;
  }
}

setInterval(cleanupRateLimitBuckets, CLEANUP_INTERVAL_MS).unref();

const startServer = () => {
  const wss = setupWebSocketServer();
  // 多用户后端路由(PG/Redis/MinIO + sub2api 代验)。任务持久化已全量切到 PG,此处必需。
  const multiUserRouter = createMultiUserRouter();
  if (!multiUserRouter) {
    console.error('[fatal] 任务持久化依赖 PostgreSQL/MinIO/Redis,但缺少必要环境变量(DATABASE_URL/REDIS_URL/SUB2API_BASE_URL/S3_*)。请配置 .env 后重启。');
    process.exit(1);
  }
  // WS 订阅鉴权(代验身份 + 任务归属比对)。
  if (multiUserRouter.taskSubscriptionGuard) {
    taskSubscriptionGuard = multiUserRouter.taskSubscriptionGuard;
  }
  verifyToken = multiUserRouter.verify;

  // 生图引擎:multi-user store(PG + MinIO)。queuedStatuses 与 store 内部状态串对齐('queued')。
  const engine = createTaskEngine({
    store: multiUserRouter.multiUserTaskStore,
    generate: generateNovaImage,
    broadcast: (taskId) => { broadcastTask(taskId); broadcastQueueStatus(); },
    ttlMs: TASK_TTL_MS,
    normalizeError,
    queuedStatuses: ['queued'],
  });
  taskGateway = createPgTaskGateway({
    tasksRepo: multiUserRouter.tasksRepo,
    store: multiUserRouter.multiUserTaskStore,
    engine,
  });

  // 重启恢复:把残留 queued/processing 任务标记为 failed(设 TTL,后续清理顺带删 MinIO)。
  taskGateway.recoverInterrupted({ message: '服务器重启，任务已中断，请重新生成', ttlMs: TASK_TTL_MS })
    .then((ids) => { if (ids.length) console.log(`[startup] 已中断 ${ids.length} 个残留任务`); })
    .catch((err) => console.warn('[startup] 中断任务恢复失败:', err?.message || err));
  // 过期清理:启动跑一次 + 周期性。
  cleanupExpiredTasks();
  setInterval(cleanupExpiredTasks, CLEANUP_INTERVAL_MS).unref();

  const httpServer = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || `${HOSTNAME}:${PORT}`}`);
    if (multiUserRouter) {
      const handledByMu = await multiUserRouter.handle(req, res, parsedUrl.pathname || '/');
      if (handledByMu) return;
    }
    if (parsedUrl.pathname?.startsWith('/api/nova/')) {
      const handled = await handleApi(req, res, parsedUrl.pathname);
      if (handled) return;
    }
    if (!IS_DEV) {
      if (serveStatic(req, res, parsedUrl.pathname || '/')) return;
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    // Next 的 dev 请求处理器要求第三参为解析过的 URL 对象(含 pathname/query/search),
    // 传裸字符串会让 Next 内部 new URL('?'+String.prototype.search) 抛 ERR_INVALID_URL。
    handle(req, res, parseLegacyUrl(req.url || '/', true));
  });

  const nextUpgradeHandler = IS_DEV && typeof app.getUpgradeHandler === 'function'
    ? app.getUpgradeHandler()
    : null;

  httpServer.on('upgrade', (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url || '/', `http://${req.headers.host || `${HOSTNAME}:${PORT}`}`).pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname === '/api/nova/ws') {
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
      return;
    }
    if (nextUpgradeHandler) {
      nextUpgradeHandler(req, socket, head);
      return;
    }
    socket.destroy();
  });

  httpServer.listen(PORT, HOSTNAME, () => {
    const localUrl = `http://localhost:${PORT}`;
    const listenUrl = `http://${HOSTNAME}:${PORT}`;
    console.log(`Nova Image server ready on ${localUrl}`);
    if (HOSTNAME !== 'localhost' && HOSTNAME !== '127.0.0.1') {
      console.log(`Listening on ${listenUrl}`);
    }
  });
};

if (IS_DEV) {
  app.prepare().then(startServer);
} else {
  startServer();
}
