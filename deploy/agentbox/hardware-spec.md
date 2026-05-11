# AgentBox Hardware Specification (T-018)

## Overview

AgentBox is a physical appliance designed for sovereign AI agent execution. It comes pre-installed with Aether and local AI models, operating in an air-gapped environment to ensure maximum privacy and data sovereignty.

---

## AgentBox Tiers

### Mini (Home Office)

**Use Case:** Individual developers, home offices, privacy-conscious individuals

| Component | Specification |
|-----------|---------------|
| CPU | AMD Ryzen 7 7840HS (8 cores, 16 threads, Zen 4) |
| RAM | 32GB DDR5-5600 |
| Storage | 1TB NVMe SSD (PCIe 4.0) |
| GPU | Integrated Radeon 780M (optional external eGPU) |
| Network | 2.5GbE Ethernet |
| Form Factor | NUC-style 4x4 inch enclosure |
| TDP | 35-54W |
| Price Target | $500-700 |

**Software Stack:**
- Ollama runtime
- 7B models: Llama 3.1, DeepSeek-R1-Distill-Qwen
- Aether Agent runtime (single instance)
- Local vector DB (optional)

**Typical Workloads:**
- Code completion and generation
- Documentation assistance
- Local documentation Q&A
- Lightweight agent tasks

---

### Pro (Small Business)

**Use Case:** Small teams, agencies, businesses requiring local AI operations

| Component | Specification |
|-----------|---------------|
| CPU | AMD Ryzen 9 7950X (16 cores, 32 threads, Zen 4) |
| RAM | 128GB DDR5-5600 |
| Storage | 2TB NVMe SSD (PCIe 4.0) + 4TB HDD |
| GPU | NVIDIA RTX 4070 (12GB) or AMD RX 7800 XT (16GB) |
| Network | 10GbE + WiFi 6E |
| Form Factor | Mini-ITX tower |
| TDP | 120-200W |
| Price Target | $2000-3000 |

**Software Stack:**
- Ollama runtime with GPU acceleration
- 70B models: Llama 3.1-70B, DeepSeek-R1-70B
- Qdrant vector database (local)
- Aether Agent runtime (multi-user)
- Local model fine-tuning capability

**Typical Workloads:**
- Multi-user agent access
- Large codebase analysis
- RAG (Retrieval-Augmented Generation)
- Model fine-tuning on proprietary data
- Concurrent agent sessions (10-50)

---

### Enterprise (Data Center)

**Use Case:** Large organizations, data centers, sovereign AI deployments

| Component | Specification |
|-----------|---------------|
| CPU | Dual AMD EPYC 9654 (192 cores total, Genoa) |
| RAM | 512GB DDR5 ECC per node |
| Storage | 8TB NVMe RAID + 16TB HDD |
| GPU | NVIDIA A100 (40GB) or H100 (80GB) x4 |
| Network | 100GbE InfiniBand |
| Form Factor | 2U/4U rackmount |
| TDP | 2000-4000W |
| Price Target | $50,000+ |

**Software Stack:**
- Kubernetes multi-node cluster
- Multi-GPU training infrastructure
- Distributed Ollama workers
- Multi-model orchestration (70B-405B)
- Aether Agent runtime (unlimited users)
- High-availability vector DB cluster
- Model registry and versioning

**Typical Workloads:**
- Enterprise-wide AI agent platform
- Training custom models
- Multi-modal model serving
- Concurrent agent sessions (100+)
- Sovereign LLM deployment

---

## Physical Form Factors

### Mini: NUC-Style (4x4 inch)
- Dimensions: 4.0" x 4.0" x 1.5" (approx.)
- Fanless or low-noise cooling
- VESA mount compatible
- DC power (barrel jack or USB-C PD)

### Pro: Mini-ITX Tower
- Dimensions: ~12" x 8" x 12"
- ATX power supply
- Active cooling with quiet fans
- Tool-less access for maintenance

### Enterprise: Rackmount (2U/4U)
- Standard 19" rack mounting
- Hot-swappable drives
- Redundant power supplies
- IPMI/Remote management
- Data center rack infrastructure

---

## Network Isolation Features

### Air-Gap Mode
- Complete network isolation from internet
- No WAN connection required
- All updates via physical media (USB/DVD)
- Maximum security and privacy

### Local-Only WiFi AP
- Embedded WiFi 6E access point
- Local network only (192.168.x.x)
- Isolated from corporate network
- On/off toggle via physical switch

### VPN for Remote Access
- WireGuard VPN server built-in
- Secure tunnel to remote clients
- Multi-factor authentication
- Audit logging for all sessions

### Physical Kill Switch
- Hardware network disable switch
- Immediately severs all network connections
- LED indicator for network status
- Mechanical latching (stays open/closed)

---

## Security Features

### TPM 2.0
- Dedicated secure cryptoprocessor
- Key storage for encryption
- Platform integrity measurement
- Attestation support

### Secure Boot
- UEFI secure boot implementation
- Signed boot loaders only
- Boot chain verification
- Measured boot support

### Encrypted Storage (Opal)
- Self-encrypting drives (SED)
- Opal 2.0 specification
- Hardware-level full-disk encryption
- Pre-boot authentication

### Faraday Cage Option
- Optional EM shielding enclosure
- Blocks all wireless signals (WiFi, Bluetooth, Cellular)
- TEMPEST-compliant variants available
- Physical tamper detection

---

## Component Sourcing Notes

### CPU Options
| Tier | Primary | Alternative |
|------|---------|-------------|
| Mini | AMD Ryzen 7 7840HS | Intel Core Ultra 7 155H |
| Pro | AMD Ryzen 9 7950X | AMD Ryzen 9 7950X3D |
| Enterprise | AMD EPYC 9654 | Intel Xeon Emerald Rapids |

### GPU Options
| Tier | Primary | Alternative |
|------|---------|-------------|
| Mini | Integrated (Radeon 780M) | eGPU enclosure (RX 7600) |
| Pro | NVIDIA RTX 4070 | AMD RX 7800 XT |
| Enterprise | NVIDIA H100 SXM | NVIDIA A100 SXM |

### Storage Recommendations
| Tier | Primary Drive | Secondary |
|------|---------------|-----------|
| Mini | Samsung 990 Pro 1TB | N/A |
| Pro | Samsung 990 Pro 2TB | WD Red 4TB HDD |
| Enterprise | Samsung PM1743 8TB RAID | Seagate Exos 16TB HDD |

---

## Thermal Considerations

### Mini
- Passive cooling or single low-profile fan
- 35-54W TDP envelope
- Suitable for office environments

### Pro
- Tower cooler with heat pipes
- 120-200W TDP envelope
- Active GPU cooling required

### Enterprise
- Liquid cooling or high-airflow rack cooling
- 2000-4000W TDP envelope
- Data center cooling infrastructure required

---

## Power Requirements

| Tier | Typical Load | Peak Load | PSU Size |
|------|--------------|-----------|----------|
| Mini | 35W | 65W | 90W adapter or 120W |
| Pro | 150W | 280W | 500W 80+ Gold |
| Enterprise | 2500W | 4000W | Dual 2000W 80+ Platinum |

---

## Deployment Scenarios

### 1. Home Office / Remote Worker
- AgentBox Mini
- Air-gapped or local network only
- Single user
- Typical internet backup

### 2. Small Office / Branch
- AgentBox Pro
- Local network with VPN
- 5-20 users
- Central IT management

### 3. Enterprise Data Center
- AgentBox Enterprise cluster
- Multi-site deployment
- Unlimited users
- Full sovereignty compliance

---

## Compliance Considerations

### Data Sovereignty
- All data stays on-premise
- No cloud dependency
- GDPR, CCPA, HIPAA compliance ready

### Industry Certifications
- CE, FCC, UL certifications planned
- ISO 27001 alignment
- SOC 2 Type II consideration

### Export Controls
- EAR/ITAR classification review
- Encryption strength compliance
- Country-specific variants

---

## Support Tiers

| Feature | Mini | Pro | Enterprise |
|---------|------|-----|------------|
| Hardware Warranty | 1 year | 2 years | 3 years |
| Software Updates | Self-service | Guided | Dedicated support |
| Remote Support | Not available | Optional | Included |
| On-site Service | Not available | Optional | Standard |
| SLA | Best effort | Next business day | 4-hour response |

---

*Document: T-018*
*Phase: 4 - AgentBox Hardware Planning*
*Status: Draft*
