'use strict';

/**
 * 联调冒烟:对真实 PG + MinIO + Redis 跑通核心路径。
 * 不计入单测覆盖,仅手动运行:node tests/live-smoke.cjs
 */
const drizzle = require('drizzle-orm');
const { loadConfig } = require('../src/config');
const { getDb, closeDb } = require('../src/db/client');
const { getStorage, resetStorage } = require('../src/storage/client');
const { getRedis, closeRedis } = require('../src/cache/redis');
const { createTasksRepo } = require('../src/repos/tasks');
const { createMultiUserTaskStore } = require('../src/tasks/multi-user-store');
const { createTaskImageService } = require('../src/tasks/task-images');

function loadEnv() {
  const fs = require('fs');
  const path = require('path');
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

async function main() {
  loadEnv();
  const config = loadConfig(process.env);
  const { db } = getDb(config.databaseUrl);
  const storage = getStorage(config);
  const redis = getRedis(config.redisUrl);
  const repo = createTasksRepo({ db, ops: drizzle });
  const images = createTaskImageService({ storage, fetchImpl: fetch });
  const store = createMultiUserTaskStore({ tasksRepo: repo, images, storage });

  const userA = 'smoke-user-a';
  const userB = 'smoke-user-b';
  const results = [];
  const t = (name, ok, extra) => { results.push({ name, ok, extra }); console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`); };

  // 1. Redis 连通
  const pong = await redis.ping();
  t('Redis ping', pong === 'PONG', pong);

  // 2. MinIO 直传 + 预签名读
  const png = Buffer.from('89504e470d0a1a0a', 'hex'); // 假 PNG 头
  const { objectKey } = await storage.putObject(userA, 'generation', 'png', png, 'image/png');
  t('MinIO putObject', objectKey.startsWith(`${userA}/generation/`), objectKey);
  const got = await storage.presignGet(userA, objectKey);
  t('MinIO presignGet(owner)', typeof got.url === 'string' && got.url.includes(objectKey));
  let denied = false;
  try { await storage.presignGet(userB, objectKey); } catch { denied = true; }
  t('MinIO presignGet 跨用户拒绝', denied);

  // 3. PG repo:建任务/子项,带 user_id 隔离
  const taskId = `smoke-${Date.now()}`;
  await repo.createTask(userA, { id: taskId, status: 'queued', mode: 'text-to-image', requestJson: { prompt: 'hi' } });
  await repo.createItem(userA, { taskId, itemIndex: 0, status: 'queued' });
  const fetched = await repo.getTask(userA, taskId);
  t('PG createTask + getTask(owner)', fetched && fetched.id === taskId);
  const crossUser = await repo.getTask(userB, taskId);
  t('PG getTask 跨用户不可见', crossUser === null);

  // 4. 子项落 objectKeys 并完成任务
  await repo.updateItem(userA, taskId, 0, { status: 'completed', objectKeys: [objectKey], completedAt: new Date() });
  await repo.updateTask(userA, taskId, { status: 'completed', resultJson: { imageKeys: [objectKey] }, completedAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) });
  const items = await repo.listItems(userA, taskId);
  t('PG listItems 含 objectKeys', items.length === 1 && Array.isArray(items[0].objectKeys) && items[0].objectKeys[0] === objectKey);

  // 5. store.serialize 产出预签名 url
  const serialized = await store.serialize(taskId, userA);
  t('store.serialize 产出图片 url', serialized && serialized.result && Array.isArray(serialized.result.images) && serialized.result.images.length === 1);

  // 6. WS 鉴权:getTaskOwner
  const owner = await repo.getTaskOwner(taskId);
  t('repo.getTaskOwner', owner === userA, owner);

  // 7. TTL purge:删 PG 行
  await repo.purgeTask(taskId);
  const afterPurge = await repo.getTask(userA, taskId);
  t('PG purgeTask 删除任务行', afterPurge === null);

  // 8. 清理 MinIO 测试对象
  await storage.removeObject(userA, objectKey);
  // 探测删除后仍可访问与否(best-effort,仅触发副作用,不断言返回值)
  try { await storage.presignGet(userA, objectKey); } catch { /* 已删除则签名/访问失败,符合预期 */ }
  t('MinIO removeObject(清理)', true);

  await closeRedis();
  await closeDb();
  resetStorage();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) { console.error('失败:', failed.map((r) => r.name).join(', ')); process.exit(1); }
  process.exit(0);
}

main().catch((e) => { console.error('冒烟异常:', e); process.exit(1); });
