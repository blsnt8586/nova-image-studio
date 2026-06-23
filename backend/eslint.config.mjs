import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import globals from "globals";

const eslintConfig = defineConfig([
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      globals: globals.node,
      ecmaVersion: "latest",
      sourceType: "commonjs",
    },
    rules: {
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    },
  },
  {
    // 测试文件由 Vitest 以 ESM 转译运行,这里按 module 解析以匹配 import/export
    files: ["tests/**/*.js", "**/*.test.js"],
    languageOptions: {
      globals: { ...globals.node, ...globals.vitest },
      ecmaVersion: "latest",
      sourceType: "module",
    },
  },
  {
    // 手动联调冒烟脚本(CommonJS .cjs):需要 Node 全局变量(process/console/Buffer/__dirname 等)
    files: ["**/*.cjs"],
    languageOptions: {
      globals: globals.node,
      ecmaVersion: "latest",
      sourceType: "commonjs",
    },
    rules: {
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    },
  },
  {
    // ESM 配置文件(.mjs,如 drizzle.config.mjs / eslint.config.mjs):Node 全局 + import/export
    files: ["**/*.mjs"],
    languageOptions: {
      globals: globals.node,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    },
  },
  globalIgnores([
    "node_modules/**",
    "*.sqlite",
    "*.sqlite-wal",
    "*.sqlite-shm",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
