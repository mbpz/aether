import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    exclude: ['**/dist/**', '**/node_modules/**'],
    pool: 'forks',
    // B6-8: v8 coverage（已装 @vitest/coverage-v8）。先跑出 baseline，
    // 后续 batch 设 80% threshold gate（v0.2 路线）。
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      reportsDirectory: './coverage',
      include: [
        'packages/*/src/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/dist/**',
        '**/node_modules/**',
        '**/types.ts',  // 纯类型文件无运行时覆盖
      ],
    },
  },
  resolve: {
    // 让 @aether/* package 跨包 import 在测试期解析到 src/，免 build
    conditions: ['development'],
  },
});
