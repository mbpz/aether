# EP-02 零信任控制平面（Gateway）

> **Epic 目标**：借鉴 OpenClaw Gateway 设计，所有外部输入默认不可信，通过权限清单（Permissions Manifest）强制审计。

- **优先级**：P0（阻塞性）
- **阶段**：阶段一（第 1-2 周）
- **状态**：📋 待开始

## 背景 & 问题

现有系统对外部输入（Webhook、用户消息、API 调用）缺乏统一的信任验证机制，存在 Prompt Injection 攻击面。本 Epic 通过零信任架构解决：

- 所有外部输入默认视为不可信
- 必须通过权限清单（Manifest）审计才能执行
- 敏感凭证仅通过环境变量临时注入沙箱内存，不落盘不传云

## 用户故事

| ID | 故事 | 优先级 | 状态 |
|----|------|--------|------|
| S-02-01 | 作为管理员，我可以定义权限清单（Manifest），声明 Agent 允许访问的资源白名单 | P0 | 📋 待开始 |
| S-02-02 | 作为用户，所有来自 Webhook/消息的外部输入在被 Agent 处理前，必须通过 Manifest 审计验证 | P0 | 📋 待开始 |
| S-02-03 | 作为运维，我可以在 Gateway 控制台实时查看所有输入的审计状态（通过/拒绝） | P0 | 📋 待开始 |
| S-02-04 | 作为开发者，敏感凭证（API Key 等）通过 Vault 注入方式临时加载到沙箱内存，执行完毕后自动清除 | P0 | 📋 待开始 |
| S-02-05 | 作为用户，Gateway 提供本地 HTTP API（端口 18789），兼容 OpenClaw 的接口格式，支持一键迁移 | P1 | 📋 待开始 |
| S-02-06 | 作为管理员，可配置 LOCAL_TOKEN_AUTH_REQUIRED 开启本地令牌认证，防止未授权访问 | P1 | 📋 待开始 |

## 技术要点

```
零信任控制流：
  外部输入（Webhook/消息/API）
       ↓
  Gateway 接收层（默认不可信）
       ↓
  Manifest 审计引擎 → 不符合? → 拒绝 + 审计日志
       ↓ 符合
  Vault 凭证注入 → WASM 沙箱执行
       ↓
  返回结果 + 审计记录
```

### 核心组件
- `gateway-server`：本地 HTTP/WS 服务（端口 18789），兼容 OpenClaw 接口
- `manifest-engine`：权限清单解析与验证引擎
- `vault-injector`：凭证临时注入器，基于环境变量，内存级生命周期
- `audit-sink`：审计日志聚合器，对接 EP-01 的 eBPF 日志流

## 验收标准

- [ ] 未在 Manifest 白名单内的外部请求一律被拒绝，响应码 403
- [ ] 凭证注入后在沙箱执行完毕后自动清除，不写磁盘
- [ ] Gateway 本地 API 兼容 OpenClaw 格式，现有 OpenClaw 用户零改动迁移
- [ ] 审计日志包含：请求来源、Manifest 匹配结果、执行时间、结果状态
- [ ] LOCAL_TOKEN_AUTH_REQUIRED=true 时，无 Token 请求返回 401
