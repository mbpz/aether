# ADR-004 — package.json `exports` 作为跨包通信契约

- **状态**：Accepted
- **日期**：2026-06-20
- **作用域**：所有 `packages/*/package.json`、`packages/gateway/src/sandbox/bridge.ts`
- **相关**：roadmap.md、[ADR-003](003-firecracker-single-implementation.md)

## 背景

monorepo 内 gateway 需要用 skill-loader 和 sandbox 的内部模块。历史上出现两种反模式：

1. **相对路径穿透包边界**（B0 修掉）：
   ```ts
   import { SkillParser } from '../../../skill-loader/src/parser/skill-parser.js';
   ```
   触发 `rootDir` 越界编译错，且把消费方耦合到生产方的物理目录结构。

2. **内联复制**（B3 修掉）：gateway 在 `bridge.ts` 里重写了一份 `SecurityPolicy`，
   和 `@aether/sandbox` 的定义同名同义不同体——两份必然漂移（sandbox 的版本有
   `checkModule` + SAFE_MODULES 白名单，gateway 的没有）。

## 决策

**用 `package.json` 的 `exports` 字段定义每个包对外暴露的子路径，作为唯一跨包接口契约。**

格式（含 `development` 条件，让开发/测试期免 build 直读 `src/`）：

```jsonc
{
  "exports": {
    ".":          { "development": "./src/index.ts",            "default": "./dist/index.js" },
    "./security": { "development": "./src/security/policy.ts",  "default": "./dist/security/policy.js" },
    "./codeact":  { "development": "./src/codeact/engine.ts",   "default": "./dist/codeact/engine.js" }
  }
}
```

配套：

- 消费方 tsconfig 加 `"customConditions": ["development"]`，tsc 解析子路径到 `src/`。
- 根 `vitest.config.ts` 加 `resolve.conditions: ['development']`，测试期同样直读 `src/`。
- 生产构建走 `default` 条件指向 `dist/`。

已落地：
- `@aether/skill-loader`：`.` / `./parser` / `./audit`（B0）
- `@aether/sandbox`：`.` / `./security` / `./codeact`（B3）

## 后果

- ✅ 跨包 import 用包名子路径：`import { SecurityPolicy } from '@aether/sandbox/security'`。
- ✅ 包的内部文件结构可自由重构，只要 `exports` 映射不变。
- ✅ 没列进 `exports` 的文件对外不可见——边界显式。
- ✅ 开发期免 build（`development` 条件直读 src）、生产用编译产物。
- 📌 **约定**：新加跨包依赖必须走 `exports`。新增子模块需要被别的包用时，先在 `exports` 注册，再 import。禁止相对路径穿透、禁止内联复制。

## 验证

```bash
grep -rn "\.\./\.\./\.\." packages/gateway/src/        # 0 命中
grep -rc "class SecurityPolicy" packages/*/src/**/*.ts # 仅 sandbox/security/policy.ts = 1
npm run build                                          # exit 0
```

## 不再做

- ~~TypeScript `paths` 别名~~ —— 仅编译期存在、运行时不生效、与 `exports` 冲突时行为不可预测。`exports` 是 Node 标准且运行期/编译期一致（理由详见 review 时的分叉 3 对比）。
