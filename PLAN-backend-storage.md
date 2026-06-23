# Nova Image Studio 后端存储 + sub2api 接入 + 用户隔离 实施计划

> 目标:把 nova-image-studio 从「纯单机 + localStorage/SQLite」改造成「接入 sub2api 账户、按用户隔离、数据落 PostgreSQL + MinIO」的多用户平台。sub2api 仅作为账户/计费网关与入口,nova 独立部署。
> 架构既定:nova 现有 Node.js `server.js` 后端 + 自托管 MinIO + PostgreSQL + Redis;身份复用 sub2api(入口链接由 sub2api 内置 `buildEmbeddedUrl` 注入 `token`/`user_id` + 后端代验)。
> 开发方式:TDD(先写测试 RED → 最小实现 GREEN → 重构),目标覆盖率 80%+。
> 交付方式:分阶段实现,每阶段完成后暂停,交付审查,确认后再进入下一阶段。
> 蓝本:复用 infinite-canvas 已跑通的代验 + 仓储 + 预签名架构(`infinite-canvas/web/src/server/*`)。

---

## 0. 全局设计与约束(所有阶段共同遵守)

### 0.1 核心铁律
- **大文件走 MinIO 直传直读**:图片/GIF 本体永不进 PG、永不经过 Node 应用服务器常驻内存。前端向后端要预签名 URL,直接 PUT/GET MinIO。应用层只处理 KB 级元数据。这是 nova 当前最大的技术债——现在图片以 base64 塞在 SQLite/localStorage,无法持续。
- **权限在后端验**:前端拿到的 `role` 仅用于「是否显示入口」。每个 `/api/admin/*` 接口都必须在后端重新确认 `role === "admin"`,否则 403。前端 role 一律不可信。
- **URL 的 `user_id` 不可信**:入口链接里的 `user_id` 仅作 UI 提示,**绝不**用于隔离查询。所有隔离的 `user_id` 一律以后端代验 JWT 解出的 `data.id` 为准,杜绝伪造 `user_id` 越权。
- **数据按用户隔离**:PG 每张业务表带 `user_id`,MinIO 对象 key 带 `user_id` 前缀。所有读写查询强制按当前 token 解出的 `user_id` 过滤,杜绝越权。
- **不可变数据**:所有更新创建新对象,不 mutate。
- **多小文件**:单文件 200–400 行典型,800 上限。按 feature/domain 组织。
- **输入校验**:所有接口入参用 zod 校验。
- **错误处理**:统一 ApiResponse 信封 `{ success, data?, error?, meta? }`。

### 0.2 身份验证机制(已对照 sub2api 源码核实,修正 infinite-canvas 的错误端点)
- sub2api 的会话凭证为 **JWT session token**(HS256),通过 `JWTAuthMiddleware` 校验(`Authorization: Bearer <jwt>`)。
- **代验接口是 `GET /api/v1/user/profile`**(经核实:`user.go` 路由 + `user_handler.go` 的 `GetProfile`)。⚠️ infinite-canvas 的 verify.ts 指向的 `/api/v1/auth/me` 在 sub2api 中**不存在**,照搬会失败,本计划已纠正。
  - 响应:`response.Success(c, profileResp)` → `{code/success, data: userProfileResponse}`,`userProfileResponse` 内嵌 `dto.User`(含 `id`/`role`/`email`)+ 身份绑定字段。
- **不采用本地共享 secret 验签**(生产 secret 可能自动生成存库、且本地验签感知不到吊销)。
- **采用「代验」**:nova 后端拿 JWT 调 `SUB2API_BASE_URL/api/v1/user/profile`,由 sub2api 完成验签 + 查库 + 封号校验,返回 `data.id`(user_id)、`data.role`、`data.email`。
- **Redis 缓存** `jwt → {userId, role, email}` 60s,绝大多数请求不真正打 sub2api,支撑高并发。
- JWT 失效返回 401,前端引导重新从 sub2api 入口进入。

### 0.2.1 入口链接由 sub2api 内置能力提供(已核实,无需 sub2api 后端改造)
> 经核实 sub2api 前端已有现成的「外链菜单 + 自动注入用户身份」能力,**不需要为本方案改 sub2api 后端**。

- **机制**:sub2api 管理员在后台配置一个「自定义菜单项(custom menu item)」,URL 填 nova 地址。前端 `frontend/src/utils/embedded-url.ts` 的 `buildEmbeddedUrl()` 会自动把当前登录用户的身份拼进 query。已核实于 `views/user/CustomPageView.vue:177`:`buildEmbeddedUrl(menuItem.url, authStore.user?.id, authStore.token, ...)`。
- **生成的真实参数名(务必对齐,不要自造名)**:
  ```
  {nova地址}?user_id={id}&token={JWT}&theme={light|dark}&lang={zh}&ui_mode=embedded&src_host=...&src_url=...
  ```
  - `token` = `authStore.token`,即 localStorage 里的 `auth_token`,正是 `JWTAuthMiddleware` 认的 `Bearer <jwt>`。
  - `user_id` = 当前用户 id。
  - token 由 sub2api auth store 自动刷新(提前 120s,`TOKEN_REFRESH_BUFFER`),跳转时拿到的是有效 token。
- **非 iframe 入口已支持**:`CustomPageView.vue:98-106` 有 `<a target="_blank" :href="embeddedUrl">「在新标签打开」`,即「点击跳转、新开 nova 页面」——正是本方案要的入口形态。

### 0.2.2 凭证流程:JWT 进、apiKey 不进链接(关键设计决策)
- 内置入口链接**只带 `token`(JWT)+ `user_id`**,**不带 `apiKey`/`baseUrl`**。
- **JWT session token**:nova 后端 API 鉴权 + 代验身份的依据(`/api/v1/user/profile`),用户隔离靠它。
- **生图凭证策略(采用方案 A:后端用 JWT 代理生图)**:
  - nova 后端持用户 JWT,代用户向 sub2api 发起生图/列模型请求,计费自然落到该用户的 sub2api 账户。
  - 优点:用户**无需暴露 `sk-xxx` key**;无需在链接里传 key,杜绝 key 泄露面;「每用户用自己账户计费」天然成立。
  - 备选方案 B(不采用):nova 拿 JWT 调 sub2api 拉该用户的 key 再注入前端 registry——多一跳且把 key 暴露到前端,放弃。
- 因此前端 registry 中模型的「凭证」不再是裸 key,而是「经 nova 后端代理」;baseUrl 指向 nova 自己的代理端点。

### 0.3 入口与配置注入(sub2api → nova)
- sub2api 后台配一个外链菜单指向 nova;前端跳转时自动生成带 `token`/`user_id` 的 URL(见 0.2.1,无需改 sub2api 后端)。
- 前端启动组件 `Sub2apiBootstrap`:
  1. 读 URL 的 `token`(JWT)与 `user_id`(以及 `theme`/`lang`/`ui_mode` 作 UI 适配)。
  2. `token` 存入内存 + sessionStorage,作为所有后端 API 调用的 `Authorization`。
  3. 调 nova 后端 `GET /api/me` 用 token 代验,确认身份可用。
  4. 调 nova 后端代理的列模型端点拉取可用模型,写进 `nova-model-registry`(协议指向 nova 代理端点),设默认模型。
  5. 立即 `history.replaceState` 清掉 URL 里的 `token`,防止泄露。
  6. 兜底:拉不到列表则建一个默认图片模型指向 nova 代理端点。
- 计费:生图经 nova 后端用各用户 JWT 代理到 sub2api,计费走各自账户。

### 0.4 技术选型
| 项 | 选型 | 理由 |
|---|---|---|
| 后端 | 沿用 nova `server.js`(Node http) | 不引入新框架,扩展现有结构 |
| ORM/迁移 | Drizzle ORM + drizzle-kit | 轻量、TS 原生、迁移清晰 |
| 对象存储 | 自托管 MinIO(S3 兼容) | `@aws-sdk/client-s3` + 预签名 |
| 缓存 | Redis(`ioredis`) | token 代验缓存 |
| 校验 | zod | 全局规范 |
| 测试 | Vitest(nova 已用) | 与现有测试栈一致 |
| E2E(后置) | Playwright | 关键流程,阶段 5 引入 |

### 0.5 环境变量(新增 `backend/.env`,不入库)
```
DATABASE_URL=postgres://...            # PG 连接
REDIS_URL=redis://...                  # Redis 连接
SUB2API_BASE_URL=https://sub2api.x.com # 代验(/api/v1/user/profile)+ 生图代理(/v1/*)的目标
S3_ENDPOINT=http://minio:9000          # MinIO
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_BUCKET=nova
S3_REGION=us-east-1
S3_PUBLIC_BASE_URL=...                 # 预签名读取的公开访问域名(可选 CDN)
TOKEN_CACHE_TTL=60                      # token 代验缓存秒数
```

### 0.6 目录规划(在 nova `backend/` 下新增,拆分单体 server.js)
```
backend/
  server.js              入口,组装路由(瘦身,逻辑下沉到 src/)
  src/
    auth/        verify.ts(代验+Redis缓存)、with-auth.ts(withAuth/withAdmin)
    db/          schema.ts、client.ts、migrations/
    storage/     s3.ts(MinIO 客户端 + 预签名签发)
    repositories/ canvases / generations / assets / tasks 仓储
    services/    业务编排(任务队列改造、生图落库、sub2api 生图代理)
    http/        response.ts(ApiResponse 信封)、errors.ts、validate.ts(zod)
    routes/      me / models(代理) / generate(代理) / canvases / generations / assets / storage / admin
  tests/         单元 + 集成测试
```

### 0.7 数据模型(PG 表,均带 user_id 隔离)
| 表 | 关键列 | 说明 |
|---|---|---|
| `tasks` | id, user_id, status, mode, request_json, created_at, expires_at | 改造现有 SQLite 任务表,加 user_id |
| `task_items` | task_id, item_index, status, object_key, error | 图片本体改存 MinIO,这里只存 object_key |
| `canvases` | id, user_id, name, snapshot_json, updated_at | 画布工程,从 localStorage 迁出 |
| `generations` | id, user_id, mode, model_id, prompt, object_key, created_at | 生图历史 |
| `assets` | id, user_id, object_key, mime, size, created_at | 素材元数据(本体在 MinIO) |

> MinIO 对象 key 规范:`{user_id}/{资源类型}/{uuid}.{ext}`,确保隔离与可清理。

---

## 阶段 1 — 测试基建 + 基础设施 + 鉴权打通

> 目标:跑通「token → user_id + role」整条链路,有可验证的 `GET /api/me`。后续工作的地基。

### 边界(做 / 不做)
- ✅ 做:确认 nova 现有 Vitest 配置可跑后端测试;docker-compose(PG + Redis + MinIO);Drizzle 接 PG(仅建连接,暂不建业务表);Redis 客户端;代验 `verifyToken`;`withAuth`/`withAdmin` 包装;`GET /api/me` 返回 `{userId, role, email}`;ApiResponse 信封与错误映射。
- ❌ 不做:业务表、存储 API、前端改动、MinIO 实际读写(仅起容器备用)。

### 细节与接口
- `src/http/response.ts`:`ok(data, meta?)` / `fail(error, status)`,统一 `{success,data,error,meta}`。
- `src/auth/verify.ts`:`verifyToken(jwt, deps)` → `UserIdentity | null`;调 `SUB2API_BASE_URL/api/v1/user/profile`(`Authorization: Bearer <jwt>`);解析 `data.id`/`data.role`/`data.email`;Redis 缓存 60s;上游不可达抛 503。
- `src/auth/with-auth.ts`:从 `Authorization: Bearer` 或 `?token=` 取 token → 代验 → 注入 `userId`;`withAdmin` 额外校验 `role === "admin"`。
- `GET /api/me`:返回当前用户身份。

### 测试(RED→GREEN)
- `verifyToken`:命中缓存不发请求;401/403 返回 null;上游异常抛 503;成功解析 user_id/role。
- `withAuth`:无 token → 401;有效 token → 注入 userId;`withAdmin` 非 admin → 403。

### 交付物 + 验收
- docker-compose 起 PG/Redis/MinIO;`GET /api/me` 带有效 token 返回身份,无 token 返回 401;测试全绿。

---

## 阶段 2 — sub2api 入口接入(前端配置注入)

> 目标:用户从 sub2api 点链接进 nova,自动持有 token + 配好模型,经 nova 后端代理直接能生图。

### 边界(做 / 不做)
- ✅ 做:`Sub2apiBootstrap` 组件(读 `token`/`user_id` 等 URL 参数、调 `/api/me` 代验、调 nova 代理的列模型端点、写 registry、存 token、清 URL、兜底);挂到根 layout;token 注入到后端 API 调用的 Authorization。nova 后端新增「生图/列模型代理」端点(持用户 JWT 代理到 sub2api,见 0.2.2)。
- ❌ 不做:业务数据落库(仍走 localStorage,阶段 3 迁移)。

### 细节与接口
- `frontend/src/lib/sub2api-bootstrap.ts`:纯逻辑(可测)——解析 `token`/`user_id`(及 `theme`/`lang`/`ui_mode`)、调 `/api/me` 代验、拉模型、构建 registry、兜底。
- `frontend/src/components/Sub2apiBootstrap.tsx`:客户端组件,挂载时调用纯逻辑,清 URL 参数(`token`)。
- token 存 sessionStorage + 内存;封装 `authFetch` 统一带 Authorization。

### 测试(RED→GREEN)
- 解析 `?token=&user_id=&theme=&lang=&ui_mode=` 各种组合;`/api/me` 代验通过/失败分支;模型列表 → registry 注入正确(协议指向 nova 代理端点);拉取失败兜底建默认模型;URL 里的 `token` 被清除。

### 交付物 + 验收
- 本地用带参 URL 打开 nova,模型自动出现在配置里,token 可用于 `/api/me`;地址栏不残留 token;测试全绿。

---

## 阶段 3 — 业务数据迁移(画布/生图/素材 → PG + MinIO)

> 目标:画布、生图历史、素材从 localStorage/base64 迁到 PG 元数据 + MinIO 本体,按 user_id 隔离。

### 边界(做 / 不做)
- ✅ 做:`canvases`/`generations`/`assets` 表 + 迁移;MinIO 预签名签发(`POST /api/storage/presign`);仓储层(强制 user_id 过滤);对应 REST 接口;前端改为调后端 API(替代 localStorage 读写)。
- ❌ 不做:任务队列改造(阶段 4);管理员监管(阶段 5)。

### 细节与接口
- `src/storage/s3.ts`:`presignPut(userId, type, ext)` / `presignGet(objectKey)`;key = `{userId}/{type}/{uuid}.{ext}`,签发前校验 objectKey 前缀属于当前 user。
- 仓储:`canvasesRepo`、`generationsRepo`、`assetsRepo`,所有方法第一参数 `userId`,查询强制 `where user_id = ?`。
- 接口:`GET/POST/PUT/DELETE /api/canvases`、`GET/POST/DELETE /api/generations`、`GET/POST/DELETE /api/assets`、`POST /api/storage/presign`。
- 前端:画布保存/读取、生图入历史、素材上传改为 `authFetch` → 预签名直传 MinIO + 元数据落 PG。

### 测试(RED→GREEN)
- 仓储越权:用户 A 不能读/改用户 B 的画布/生图/素材;预签名 objectKey 前缀校验拒绝跨用户;CRUD 正确。

### 交付物 + 验收
- 换浏览器/设备登录后画布、历史、素材仍在;两个用户数据互不可见;图片本体在 MinIO,PG 仅存元数据;测试全绿。

---

## 阶段 4 — 任务队列改造(SQLite → PG,按用户)

> 目标:现有任务队列(`server.js` 的 tasks/task_items)迁到 PG,带 user_id,图片本体落 MinIO。

### 边界(做 / 不做)
- ✅ 做:`tasks`/`task_items` 表加 user_id;任务创建/查询/WebSocket 推送按 user_id 过滤;生成的图片写 MinIO,task_items 存 object_key;TTL 清理同步删 MinIO 对象。
- ❌ 不做:管理员监管。

### 测试(RED→GREEN)
- 任务按 user_id 隔离;WebSocket 只推自己的任务;TTL 过期清理 PG 记录 + MinIO 对象。

### 交付物 + 验收
- 多用户并发生图互不串台;断线重连只看到自己的任务;过期任务图片从 MinIO 清除;测试全绿。

---

## 阶段 5 — 管理员监管 + E2E

> 目标:sub2api 管理员可监管全平台生图内容;关键流程 E2E 覆盖。

### 边界(做 / 不做)
- ✅ 做:`/api/admin/generations`(withAdmin,跨用户查询 + 分页);管理员审核/封禁内容接口;前端 admin 入口(role 控制显示,后端二次校验);Playwright 覆盖「入口注入→生图→落库→换设备可见→管理员可查」。
- ❌ 不做:超出监管范围的新功能。

### 测试(RED→GREEN)
- 非 admin 调 `/api/admin/*` → 403;admin 可跨用户查询;审核/封禁生效。

### 交付物 + 验收
- 管理员后台可见全平台生图(分页);非管理员越权被拒;E2E 全流程绿;整体覆盖率 80%+。

---

## 风险与注意点
- **base64 历史数据**:nova 老用户 localStorage 里的 base64 图片无对应迁移路径——本计划只保证新数据落 MinIO,旧本地数据按「不迁移、用户重新生成」处理(nova 本就是个人本地工具,无线上历史数据负担)。
- **token 泄露**:URL 注入的 token 必须在前端首屏立即清除,且仅走 sessionStorage,不落 localStorage。
- **预签名越权**:presign 必须校验请求的 objectKey 前缀 == 当前 userId,否则可越权读写他人对象。
- **sub2api 可用性**:代验依赖 sub2api `/api/v1/user/profile`,生图依赖 sub2api `/v1/*` 代理;Redis 缓存降低代验耦合,但 sub2api 全挂时 nova 鉴权与生图均不可用(返回 503),属可接受的强依赖。
- **生图统一经 nova 后端代理**:前端模型 registry 指向 nova 代理端点,不保留任何直连 sub2api 或 Gemini 原生旁路;nova 后端持用户 JWT 转发到 sub2api,确保所有生图计费走该用户账户、且不在前端暴露任何 key。
- **token 时效**:入口 JWT 由 sub2api 自动刷新,但 nova 侧若长时间停留可能遇到 token 过期 → 后端返回 401,前端引导重新从 sub2api 入口进入(不在 nova 侧实现刷新逻辑,避免与 sub2api 刷新机制冲突)。
