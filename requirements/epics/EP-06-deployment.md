# EP-06 企业级私有部署

> **Epic 目标**：提供 Kubernetes 一键部署方案，支持 SOC2 审计日志，同时发布 AgentBox 硬件一体机，实现物理层面的隐私保护。

- **优先级**：P2
- **阶段**：阶段三/四（第 1 个月+）
- **状态**：📋 待开始

## 用户故事

| ID | 故事 | 优先级 | 状态 |
|----|------|--------|------|
| S-06-01 | 作为企业 IT，我可以通过一个 Helm Chart 在私有 K8s 集群一键部署 Aether | P0 | 📋 待开始 |
| S-06-02 | 作为合规官，我可以导出符合 SOC2 标准的审计日志报告 | P1 | 📋 待开始 |
| S-06-03 | 作为企业，Audit Gateway 以 Sidecar 模式自动注入每个 Agent 执行节点 | P0 | 📋 待开始 |
| S-06-04 | 作为企业，所有 RAG 知识库和事件流数据仅在私有 K8s 集群的 PV 中流转，不出内网 | P0 | 📋 待开始 |
| S-06-05 | 作为个人用户，我可以购买 AgentBox 硬件一体机，预装本地模型，开机即用 | P2 | 📋 待开始 |

## 技术要点

### K8s Sidecar 架构
```yaml
Pod 结构：
  - agent-core（执行容器）
  - sas-audit-gateway（Sidecar 审计容器，eBPF 特权模式）

数据流：
  agent-core → GATEWAY_URL(localhost:18789) → sas-audit-gateway
  sas-audit-gateway → eBPF hook → 内核层过滤
```

### AgentBox 规格（目标）
- 预装 Ollama + DeepSeek-R1/Qwen 本地模型
- 预装 Aether 完整系统
- 隔离网络环境，物理级隐私保护

## 验收标准

- [ ] Helm Chart 一键部署，支持 3 副本 HA 配置
- [ ] SOC2 审计日志导出，格式：JSON + PDF 报告
- [ ] LOCAL_DATA_ONLY=true 时，所有数据流量不出 K8s 集群
- [ ] eBPF Sidecar 启动后，外联请求被内核拦截，响应时间 < 1ms
