// deploy/ebpf/bpf/network.bpf.c
// SPDX-License-Identifier: GPL-2.0
//
// Zero-trust network filter (XDP). Default action: DROP. Packets are only
// allowed when they match an entry in `rules` for the relevant protocol
// and port. Hostname- or CIDR-based policy is converted to a list of
// concrete (ip, protocol, port) tuples by the userspace agent before being
// pushed into the LPM_TRIE map.

#include <linux/bpf.h>
#include <linux/if_ether.h>
#include <linux/ip.h>
#include <linux/in.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_endian.h>

/* Maximum number of rules that can be programmed into the map. Each rule
 * can target up to 4 distinct (proto, port) combinations (TCP, UDP, ICMP,
 * and the wildcard protocol=any). */
#define MAX_RULES 4096
#define PROTO_ANY  0
#define PROTO_TCP  6
#define PROTO_UDP  17
#define PROTO_ICMP 1
#define PORT_ANY   0

/* Longest-prefix-match trie keyed by destination IPv4 (network byte
 * order). The 32-bit value is structured:
 *   bit 31          : reserved
 *   bits 30-24 (7b) : protocol (PROTO_*)
 *   bits 23-0  (24b): dst port (0 = any)
 * A prefix length of 32 is a single host; smaller values are CIDR ranges.
 */
struct rule_value {
    __u8  prefixlen;   // CIDR prefix length in bits
    __u32 data;        // (proto<<24) | port
};

struct {
    __uint(type, BPF_MAP_TYPE_LPM_TRIE);
    __type(key, __u32);              // IPv4 (network byte order)
    __type(value, struct rule_value);
    __uint(max_entries, MAX_RULES);
} rules SEC(".maps");

/* Connection log (per-CPU array, low-overhead counter). */
struct {
    __uint(type, BPF_MAP_TYPE_PERCPU_ARRAY);
    __type(key, __u32);
    __type(value, __u64);
    __uint(max_entries, 3);
} stats SEC(".maps");

#define STAT_PASS 0
#define STAT_DROP 1
#define STAT_NON_IP 2

static __always_inline void bump_stat(__u32 which) {
    __u64 *c = bpf_map_lookup_elem(&stats, &which);
    if (c) __sync_fetch_and_add(c, 1);
}

static __always_inline int is_localhost_v4(__u32 ip) {
    return ip == 0x0100007F; // 127.0.0.1 in BE
}

static __always_inline __u8 map_proto(__u8 ip_proto) {
    switch (ip_proto) {
        case IPPROTO_TCP:  return PROTO_TCP;
        case IPPROTO_UDP:  return PROTO_UDP;
        case IPPROTO_ICMP: return PROTO_ICMP;
        default:           return PROTO_ANY;
    }
}

static __always_inline __u16 dst_port(struct iphdr *ip, void *data_end) {
    // L4 header starts after IP header. Return 0 when the L4 header is
    // not present in the linear data slice (truncated packet).
    __u64 off = sizeof(*ip);
    if (data + off + 2 > data_end) return 0;
    __u8 *p = (data + off);
    return ((__u16)p[0] << 8) | p[1];
}

SEC("xdp")
int xdp_filter(struct xdp_md *ctx) {
    void *data     = (void *)(long)ctx->data;
    void *data_end = (void *)(long)ctx->data_end;

    struct ethhdr *eth = data;
    if ((void *)(eth + 1) > data_end) {
        bump_stat(STAT_NON_IP);
        return XDP_PASS;
    }

    // Non-IP (e.g. ARP) is passed; the agent is not a L2 firewall.
    if (eth->h_proto != bpf_htons(ETH_P_IP)) {
        bump_stat(STAT_NON_IP);
        return XDP_PASS;
    }

    struct iphdr *ip = (void *)(eth + 1);
    if ((void *)(ip + 1) > data_end) {
        bump_stat(STAT_DROP);
        return XDP_DROP;
    }

    __u32 src_ip = ip->saddr;
    __u32 dst_ip = ip->daddr;
    __u8  proto  = map_proto(ip->protocol);
    __u16 dport  = (proto == PROTO_TCP || proto == PROTO_UDP)
                       ? dst_port(ip, data_end)
                       : 0;

    // Hard-coded carve-out: loopback is always allowed. Loopback is not
    // normally seen on a NIC XDP program, but defensive in case the XDP
    // is later moved to a non-physical interface.
    if (is_localhost_v4(src_ip) || is_localhost_v4(dst_ip)) {
        bump_stat(STAT_PASS);
        return XDP_PASS;
    }

    // Look up the destination IP in the LPM trie. A "hit" means there is
    // a rule that explicitly allows the destination (or a network that
    // contains it). We then verify the protocol and port match what the
    // rule allowed; otherwise we still drop.
    struct rule_value *rule = bpf_map_lookup_elem(&rules, &dst_ip);
    if (rule) {
        __u32 rule_proto = (rule->data >> 24) & 0xFF;
        __u32 rule_port  = rule->data & 0xFFFFFF;
        __u32 pkt_proto  = proto;
        __u32 pkt_port   = dport;

        if ((rule_proto == PROTO_ANY || rule_proto == pkt_proto) &&
            (rule_port == PORT_ANY  || rule_port  == pkt_port)) {
            bump_stat(STAT_PASS);
            return XDP_PASS;
        }
        // Mismatched protocol/port: the host has a rule for this IP but
        // not for this service. Drop.
        bump_stat(STAT_DROP);
        return XDP_DROP;
    }

    // Default-deny.
    bump_stat(STAT_DROP);
    return XDP_DROP;
}

char _license[] SEC("license") = "GPL";
