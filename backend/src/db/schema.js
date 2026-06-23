'use strict';

const {
  pgTable,
  text,
  integer,
  bigint,
  jsonb,
  timestamp,
  index,
  primaryKey,
} = require('drizzle-orm/pg-core');

/**
 * 业务数据表(阶段 3)。所有表均带 user_id 用于按用户隔离。
 * user_id 取自后端代验 JWT 解出的 data.id(不可信 URL 不参与)。
 *
 * MinIO 对象 key 规范:`{user_id}/{type}/{uuid}.{ext}`。
 * 图片/素材本体存 MinIO,PG 只存 object_key 等元数据。
 */

/** 画布工程:从 localStorage 迁出,snapshot_json 存整张画布快照。 */
const canvases = pgTable(
  'canvases',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    name: text('name').notNull().default(''),
    snapshotJson: jsonb('snapshot_json').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('canvases_user_idx').on(table.userId),
  }),
);

/** 生图历史:图片本体存 MinIO(object_key),这里存生成参数与引用。 */
const generations = pgTable(
  'generations',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    mode: text('mode').notNull(),
    modelId: text('model_id').notNull().default(''),
    prompt: text('prompt').notNull().default(''),
    objectKey: text('object_key').notNull(),
    // 内容 hash(图片本体 SHA-256),用于去重:同用户同 hash 不重复上云/入库。可空(老数据)。
    contentHash: text('content_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('generations_user_idx').on(table.userId),
    userHashIdx: index('generations_user_hash_idx').on(table.userId, table.contentHash),
  }),
);

/** 素材元数据:本体在 MinIO,这里存 object_key/mime/size。 */
const assets = pgTable(
  'assets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    objectKey: text('object_key').notNull(),
    mime: text('mime').notNull().default(''),
    size: bigint('size', { mode: 'number' }).notNull().default(0),
    kind: text('kind').notNull().default(''),
    name: text('name').notNull().default(''),
    // 内容 hash(本体 SHA-256),用于去重:同用户同 hash 不重复上云/入库。可空(老数据)。
    contentHash: text('content_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('assets_user_idx').on(table.userId),
    userHashIdx: index('assets_user_hash_idx').on(table.userId, table.contentHash),
  }),
);

/**
 * 生图任务队列(阶段 4,从 server.js 的 SQLite 迁出)。
 * 带 user_id 隔离;图片本体落 MinIO,task_items 存 object_key 列表。
 */
const tasks = pgTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    status: text('status').notNull(),
    mode: text('mode').notNull(),
    requestJson: jsonb('request_json').notNull(),
    resultJson: jsonb('result_json'),
    error: text('error'),
    warning: text('warning'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => ({
    userIdx: index('tasks_user_idx').on(table.userId),
    statusIdx: index('tasks_status_idx').on(table.status),
    expiresIdx: index('tasks_expires_idx').on(table.expiresAt),
  }),
);

/** 任务子项:每张待生成图片一行。object_keys 存 MinIO 对象 key 列表。 */
const taskItems = pgTable(
  'task_items',
  {
    taskId: text('task_id').notNull(),
    itemIndex: integer('item_index').notNull(),
    userId: text('user_id').notNull(),
    status: text('status').notNull(),
    objectKeys: jsonb('object_keys'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.taskId, table.itemIndex] }),
    userIdx: index('task_items_user_idx').on(table.userId),
    taskIdx: index('task_items_task_idx').on(table.taskId),
  }),
);

/**
 * 用户偏好设置(第二档)。KV 形态:每个 localStorage 键一行,value 存 jsonb。
 * 主键 (user_id, key),按用户隔离;换设备/浏览器登录后整体取回。
 */
const userSettings = pgTable(
  'user_settings',
  {
    userId: text('user_id').notNull(),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.key] }),
    userIdx: index('user_settings_user_idx').on(table.userId),
  }),
);

module.exports = { canvases, generations, assets, tasks, taskItems, userSettings };

