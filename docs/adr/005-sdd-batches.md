# ADR-005 — SDD 分批修复流程作为工程标准

- **状态**：Accepted
- **日期**：2026-06-20
- **作用域**：仓库整体工作流；`CONTRIBUTING.md`、`.github/workflows/ci.yml`
- **相关**：[ADR-001 no-safe-eval](001-no-safe-eval.md)、[ADR-002 wasmtime](002-wasmtime-upstream-blocking.md)、[ADR-003 firecracker](003-firecracker-single-implementation.md)、[ADR-004 exports](004-package-exports-contract.md)

## 背景

2026-06-18 架构 review 发现仓库 roadmap 与代码事实不符：

- 6 个"✅ 已完成"项实际未交付（含 `safe-eval` 删除、firecracker 单实现等）
- `npm run build` 失败（gateway 5 TS 错 + sandbox 几十个语法错）
- 测试基建错配（vitest 语法跑在 `node --test` 下）
- 4 个真实失败的测试 + 1 个 V8 OOM 测试被无人发现

根因：没有"build/test 双绿"约束，PR 合并时不验证 ✅ 状态，roadmap 是手写无验证的承诺。

review 给出 5 阶段修复计划，2 天完成：

| Batch | 主题 | Commit |
|-------|------|--------|
| B0 | 止血：build + test 双绿 | `621a0e3` |
| B1 | 安全回归：fail-closed sandbox | `9a74c96` |
| B2 | 真实测试 + CI | `e943eb0` |
| B3 | 架构债：firecracker 单实现 + exports | `787828e` |
| B4 | roadmap 校准 + 制度化 | （本次）|

## 决策

**采纳 SDD（Spec → Tests → Implementation → Verification → Doc）作为所有未来工作的标准流程。**

### 1. 每个 Batch 五段

| 段 | 产物 | 约束 |
|----|------|------|
| **Spec** | 一段"要做 / 不做 / 验收条件"的文字（commit message 头部，或单独 `.spec.md`）| 必须包含可量化的退出标准 |
| **Tests** | 先写失败的测试（TDD red）| 修 bug 必须先有复现测试 |
| **Implementation** | 让测试变绿的最小改动 | 不顺手重构无关代码 |
| **Verification** | `npm run build && npm test` 双绿 + 关键 grep | commit message 末尾列出 verification 块 |
| **Doc** | 影响架构决策的写 ADR；roadmap 加验证命令 | 每个 ✅ 必须配可机器执行的命令 |

### 2. 提交规范

- **commit message** 必须包含：
  - 一句话主题（`<type>(<scope>): <summary>`）
  - 改动总览（按 module / file 分段）
  - 末尾 `Verification:` 块给出 ≥1 个可机器执行的命令
- **不准**把 roadmap 标 ✅ 但提交里没有对应的测试或 grep 守护

### 3. CI 守护

`.github/workflows/ci.yml`（B2 已加）：
- 每个 push / PR 跑 `npm ci && npm run build && npm test`
- 周一 cron 跑 `node scripts/check-wasmtime.mjs` 探测上游
- 红的 PR 不准合并

### 4. ADR 制度

`docs/adr/` 目录记录设计决策。要求：

- 文件名 `NNN-kebab-case-title.md`，编号顺次递增
- 包含 `背景 / 决策 / 后果 / 验证 / 不再做` 五个段落
- 拒绝的备选必须列出，含拒绝理由
- 每条 ADR 必须给出**可机器执行**的"验证"命令

当前 ADR：

| # | 标题 |
|---|------|
| 001 | 移除 sandbox 的 safe-eval / new Function 降级 |
| 002 | Wasmtime npm 上游阻塞 EP-01 Phase 2 |
| 003 | Firecracker 单实现：pool 概念合并进 runtime |
| 004 | package.json exports 作为跨包通信契约 |
| 005 | SDD 分批修复流程作为工程标准（本条）|

### 5. 已弃用的反模式（不准回归）

- ~~roadmap "✅ 已完成" 而代码无对应测试~~
- ~~`safe-eval` / `new Function(code)` 降级~~（ADR-001）
- ~~静默吞掉沙箱 init 失败~~（ADR-002）
- ~~跨包相对路径 `../../../`~~（ADR-004）
- ~~内联复制其他包的代码~~（ADR-004）
- ~~`while ((m = rx.exec(c)) !== null)` 循环在 Node 26.3.x 上~~（B2 改 `matchAll`）

## 后果

- ✅ Roadmap 与代码事实强对齐——所有 ✅ 都有 verification 命令托底
- ✅ CI 守护防止"merge 即破"，红的 PR 物理上无法 merge
- ✅ ADR 制度让重大设计决策可追溯，避免"为什么这么做"的失传
- ✅ 修复工作可重复——后续团队成员看 Batch 0–4 的 commit 即可重现整次清理
- ⚠️ SDD 增加每次改动的工程成本（写 spec / 测试先行）——这是刻意的折衷，换来"提交即可信"

## 验证

```bash
ls docs/adr/                                                  # 5 个 ADR 文件
grep -c "^| 0[0-9]" docs/adr/README.md                        # ≥ 5
test -f .github/workflows/ci.yml                              # CI 工作流存在
test -f CONTRIBUTING.md                                       # 贡献指南存在
npm run build && npm test                                     # exit 0 双绿
node scripts/check-wasmtime.mjs                               # exit 2 = 等上游
```

## 不再做

- ~~不验证就标 ✅ 的"乐观 roadmap"~~ —— 已被 B0–B4 证明会产生 review 时的认知错位
- ~~不写测试就提 PR 的"信任 commit"~~ —— CI 物理拒绝
- ~~"暂时跳过 CI" 类 escape hatch~~ —— 没有这种入口；本地修不通就不要 push
