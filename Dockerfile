# Nova Image Studio 生产镜像
# 多阶段:1) 构建前端静态产物(frontend/out) 2) 组装后端运行时(server.js + frontend/out)
# 依赖的 PostgreSQL / Redis / MinIO 由外部提供(通过环境变量连接),不在此镜像内。

# ---------- 阶段 1:构建前端静态导出 ----------
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app/frontend

# 仅复制依赖清单,利用层缓存。
# 用 npm install 而非 npm ci:sharp 的 WASM fallback 可选传递依赖(@emnapi/*)用浮动版本,
# 不同 npm 版本/平台解析出的具体版本不同,npm ci 的严格比对会失败;npm install 会自我校准。
COPY frontend/package.json frontend/package-lock.json ./
RUN npm install --no-audit --no-fund

# 复制源码并构建(next.config.ts 在生产下 output:"export" → 产出 frontend/out)。
# next.config.ts 会读取根目录 package.json 取版本号注入,故需把根 package.json 放到 /app。
COPY package.json /app/package.json
COPY frontend/ ./
ENV NODE_ENV=production
RUN npm run build

# ---------- 阶段 2:后端运行时 ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app/backend
ENV NODE_ENV=production

# sharp 在 slim 镜像下需要的运行库由其预编译二进制自带;如遇缺库可在此补 apt 安装。
# 先装后端生产依赖(用 npm install --omit=dev,容忍可选依赖版本漂移)。
COPY backend/package.json backend/package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund
# 再单独装迁移工具 drizzle-kit(迁移在启动时执行,需常驻镜像)。
# 必须独立成层 + --include=dev:NODE_ENV=production 下 npm 默认 --omit=dev 会跳过它(它是 devDependency);
# 同一 RUN 与生产依赖合并时也会被 npm 对齐 lockfile 清掉。
RUN npm install --no-audit --no-fund --include=dev drizzle-kit@^0.30.0

# 复制后端源码
COPY backend/ ./

# 从阶段 1 取前端静态产物到 server.js 期望的位置(../frontend/out)
COPY --from=frontend-build /app/frontend/out /app/frontend/out

# server.js 默认 PORT=3000
EXPOSE 3000

# 启动前先跑数据库迁移(幂等:已应用的会跳过),再起服务。
CMD ["sh", "-c", "npx --no-install drizzle-kit migrate --config=drizzle.config.mjs && node server.js"]
