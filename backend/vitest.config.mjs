import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.js'],
    // CommonJS 源在多测试文件间会被各自实例化。v8 覆盖率按实例合并会丢失命中
    // (一个模块被多个测试 require 时,未命中的实例可能覆盖已命中的)。
    // 改用 istanbul provider:直接对源码插桩,不受多实例合并影响。
    isolate: false,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.js'],
      // 纯连接工厂(打开真实 PG/Redis 连接),由 docker-compose + 实跑 /api/me 验收,不做单测
      exclude: ['src/cache/redis.js', 'src/db/client.js', 'src/storage/client.js', 'src/db/schema.js'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
