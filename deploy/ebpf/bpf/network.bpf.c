// deploy/ebpf/bpf/network.bpf.c
// SPDX-License-Identifier: GPL-2.0

#include <linux/bpf.h>
#include <linux/if_ether.h>
#include <linux/ip.h>
#include <linux/in.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_endian.h>

/* Map: allowed CIDR ranges */
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __type(key, __u32);   // IP in network byte order
    __type(value, __u32); // 1 = allow, 0 = block
    __uint(max_entries, 256);
} allowed_ips SEC(".maps");

/* Map: connection log (per-CPU ring buffer) */
struct {
    __uint(type, BPF_MAP_TYPE_PERCPU_ARRAY);
    __type(key, __u32);
    __type(value, struct conn_log_entry);
    __uint(max_entries, 1024);
} conn_log SEC(".maps");

struct conn_log_entry {
    __u32 src_ip;
    __u32 dst_ip;
    __u16 src_port;
    __u16 dst_port;
    __u8 action;     // 0=allowed, 1=blocked
    __u8 protocol;
};

static __always_inline int is_localhost(__u32 ip) {
    return ip == 0x0100007F; // 127.0.0.1 in BE
}

SEC("xdp")
int xdp_filter(struct xdp_md *ctx) {
    void *data     = (void *)(long)ctx->data;
    void *data_end = (void *)(long)ctx->data_end;

    struct ethhdr *eth = data;
    if ((void *)(eth + 1) > data_end)
        return XDP_PASS;

    if (eth->h_proto != bpf_htons(ETH_P_IP))
        return XDP_PASS;

    struct iphdr *ip = (void *)(eth + 1);
    if ((void *)(ip + 1) > data_end)
        return XDP_PASS;

    __u32 src_ip = ip->saddr;
    __u32 dst_ip = ip->daddr;
    __u8 proto = ip->protocol;

    // Always allow localhost
    if (is_localhost(src_ip) || is_localhost(dst_ip))
        return XDP_PASS;

    // Check allowed_ips map
    __u32 *action = bpf_map_lookup_elem(&allowed_ips, &dst_ip);
    if (action) {
        if (*action == 0)
            return XDP_DROP;  // blocked by policy
        return XDP_PASS;       // allowed
    }

    // Default: block non-localhost (zero-trust)
    return XDP_DROP;
}

char _license[] SEC("license") = "GPL";
