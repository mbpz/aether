# Architecture Decision Records

每条 ADR 记录一次"设计层面的承诺"——为什么选这条路、拒绝了什么、什么条件下会重新审视。

## 已采纳

| # | 标题 | 日期 | 关联 |
|---|------|------|------|
| [001](001-no-safe-eval.md) | 移除 sandbox 的 `safe-eval` / `new Function` 降级 | 2026-06-19 | Batch 1 安全回归 |
| [002](002-wasmtime-upstream-blocking.md) | Wasmtime npm 上游阻塞 EP-01 Phase 2 | 2026-06-19 | Batch 1 安全回归 |
| [003](003-firecracker-single-implementation.md) | Firecracker 单实现：pool 概念合并进 runtime | 2026-06-20 | Batch 3 架构债 |
| [004](004-package-exports-contract.md) | package.json `exports` 作为跨包通信契约 | 2026-06-20 | Batch 3 架构债 |
| [005](005-sdd-batches.md) | SDD 分批修复流程作为工程标准 | 2026-06-20 | Batch 4 制度化 |
| [006](006-ebpf-yaml-sync.md) | eBPF 内核层集成通过 YAML 文件桥接 | 2026-06-25 | Batch 5 架构 |
| [007](007-scoring-semantics.md) | SecurityScorer 评分语义：avg vs min 的统一 | 2026-06-26 | Batch 6 开源治理 |
| [008](008-self-hosted-k3s-demo.md) | Self-hosted k3s on VPS as the demo deployment target | 2026-06-30 | Batch 11 demo deploy |

## 编写约定

- 文件名：`NNN-kebab-case-title.md`，编号顺次递增
- 头部 frontmatter 字段：`状态`（Accepted / Superseded / Rejected）、`日期`、`作用域`、`相关`
- 一条 ADR 只解决一个决策，长度建议 ≤ 1 页
- 拒绝的备选必须列出，含拒绝理由
- 每条 ADR 必须给出**可机器执行**的"验证"命令
