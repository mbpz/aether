import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    exclude: ['**/dist/**', '**/node_modules/**'],
    pool: 'forks',
  },
  resolve: {
    // 让 @aether/* package 跨包 import 在测试期解析到 src/，免 build
    conditions: ['development'],
  },
});
