# Contributing to Aether

> 本仓库走 SDD（Spec → Tests → Implementation → Verification → Doc）流程。
> 决策见 [ADR-005](docs/adr/005-sdd-batches.md)。本文是给写 PR 的人看的速查。

---

## 提交前的硬约束

任何 PR 在 merge 前都必须满足：

- [ ] `npm run build` 退出码 0
- [ ] `npm test` 退出码 0
- [ ] 新功能或修复都有对应的测试（修 bug 必须先有复现测试，TDD red 后 green）
- [ ] CI 工作流通过（`.github/workflows/ci.yml`）
- [ ] 跨包用包名 import，不用 `../../../` 相对路径（[ADR-004](docs/adr/004-package-exports-contract.md)）
- [ ] 改 roadmap 的任何 ✅ 状态必须配 verification 命令
- [ ] 涉及架构决策的写 ADR（设计层面"为什么这么做"+"拒绝了什么"）

CI 强制这些约束。本地修不通就不要 push。

---

## SDD 流程速查

写 PR 前依次：

### 1. Spec（要做 / 不做 / 验收）

在 PR 描述里写清楚：

```
## 要做的
- ...

## 不做的
- ...

## 验收条件
- npm test -- <test path> 通过
- grep -rn '<pattern>' packages/ 命中 X 处
```

### 2. Tests（先红后绿）

- 修 bug → 先写一个能复现 bug 的失败测试
- 加功能 → 先写期望的 API 用法（即使运行时还没实现）
- 测试要能在 `npm test` 下跑通

### 3. Implementation

最小改动让测试变绿。**不要**顺手做无关重构——重构走单独 PR。

### 4. Verification

提 PR 前本地跑：

```bash
npm run build          # exit 0
npm test               # exit 0
git status             # 干净（无误提交的产物）
```

### 5. Doc

- commit message 必须含 `Verification:` 块（参考 B0–B4 的 commit 写法）
- 影响架构决策的写 ADR（`docs/adr/NNN-kebab-title.md`）
- 标记 roadmap.md 状态时配可机器执行的命令

---

## Commit message 范式

```
<type>(<scope>): <summary>

<改动总览 — 按模块或文件分段，说明 why>

<关键设计决定 / 拒绝的备选>

Verification:
  npm run build                    # exit 0
  npm test                         # 168 passed | 4 skipped
  grep -rn '...' packages/         # 0 命中
```

`<type>`：`feat` / `fix` / `refactor` / `chore` / `docs` / `test`
`<scope>`：用 batch 标签或包名，如 `B3`、`sandbox`、`gateway`

参考已合入的 commits：

```bash
git log --oneline -5
# 787828e refactor(B3): single firecracker impl + exports contract + dedup SecurityPolicy
# e943eb0 feat(B2): real-test fixes + CI guardrail
# 9a74c96 feat(B1): security regression — fail-closed sandbox + wasmtime guard
# 621a0e3 chore(B0): stop-the-bleeding — restore build + test green
```

---

## 跨包 import

用 `package.json` `exports` 字段定义的子路径。**禁止**相对路径穿透：

```ts
// ✅ 正确
import { SecurityPolicy } from '@aether/sandbox/security';
import { SkillParser } from '@aether/skill-loader/parser';

// ❌ 禁止
import { SecurityPolicy } from '../../../sandbox/src/security/policy.js';
```

新增子模块需要被别的包用时，先在 `packages/<pkg>/package.json` 的 `exports` 字段注册。详见 [ADR-004](docs/adr/004-package-exports-contract.md)。

---

## 沙箱安全的强不变量

**永远不要**回归这些路径（CI grep 守护）：

- `new Function(code)` / `eval(code)` 作为沙箱执行回退（[ADR-001](docs/adr/001-no-safe-eval.md)）
- `require('safe-eval')`
- 静默吞掉 isolated-vm / wasmtime 的 init 失败（[ADR-002](docs/adr/002-wasmtime-upstream-blocking.md)）

CI 会跑：

```bash
grep -rnE 'new Function\(|runSafeEval|safe-eval' packages/   # 仅命中 test 文件
```

---

## ADR 写作约定

`docs/adr/NNN-kebab-case-title.md`，包含五段：

1. **背景** — 这个决策要解决什么问题？为什么现在?
2. **决策** — 具体做什么；拒绝了哪些备选（含理由）
3. **后果** — 收益、代价、约束
4. **验证** — 可机器执行的 grep / npm test / curl 命令
5. **不再做** — 明确禁止的反模式

短即可，建议 ≤ 1 页。

---

## 节奏建议

- **小 PR** 比大 PR 好 — B0–B4 每批 1 天内可完成
- **本地双绿** 再 push — CI 不是用来兜底失误的
- **commit 即可信** — reviewer 应该能从 commit message 自验证

---

## 任务跟踪

任何超过 3 步的工作用任务列表（TaskCreate / TaskUpdate）。B0–B4 全部按这种节奏跑下来的，可作为参考。
