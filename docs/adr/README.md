# Architecture Decision Records

每条 ADR 记录一次"设计层面的承诺"——为什么选这条路、拒绝了什么、什么条件下会重新审视。

## 已采纳

| # | 标题 | 日期 | 关联 |
|---|------|------|------|
| [001](001-no-safe-eval.md) | 移除 sandbox 的 `safe-eval` / `new Function` 降级 | 2026-06-19 | Batch 1 安全回归 |
| [002](002-wasmtime-upstream-blocking.md) | Wasmtime npm 上游阻塞 EP-01 Phase 2 | 2026-06-19 | Batch 1 安全回归 |

## 编写约定

- 文件名：`NNN-kebab-case-title.md`，编号顺次递增
- 头部 frontmatter 字段：`状态`（Accepted / Superseded / Rejected）、`日期`、`作用域`、`相关`
- 一条 ADR 只解决一个决策，长度建议 ≤ 1 页
- 拒绝的备选必须列出，含拒绝理由
- 每条 ADR 必须给出**可机器执行**的"验证"命令
