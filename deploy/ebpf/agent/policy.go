package main

import (
	"fmt"
	"net"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

// PolicyRule is the on-disk representation. Hosts may be a single IP, an
// IPv4 CIDR, or a hostname (resolved at load time). Protocol and port
// default to "any" when not set.
type PolicyRule struct {
	ID       string `yaml:"id"`
	Action   string `yaml:"action"`   // "allow" or "block"
	Protocol string `yaml:"protocol"` // "tcp" | "udp" | "icmp" | "" (any)
	Host     string `yaml:"host"`
	Port     int    `yaml:"port"`
	// Direction is captured for documentation and for future use; the
	// current XDP program is egress-only because it inspects the dst IP.
	Direction string `yaml:"direction"`
}

type Policy struct {
	Rules []PolicyRule `yaml:"rules"`
}

// ResolvedRule is a policy rule expanded into concrete (IP, proto, port)
// tuples that can be pushed straight into the BPF map.
type ResolvedRule struct {
	Source   PolicyRule
	IP       net.IP // IPv4
	Protocol uint8  // 0=any, 6=tcp, 17=udp, 1=icmp
	Port     uint16 // 0=any
	// IsAllow is true for action=allow, false for action=block. Block
	// rules are intentionally NOT programmed into the BPF map because
	// the map is allow-only by design (default-deny). A block rule is
	// useful for the userspace audit log and for generating alert
	// telemetry; it cannot override the kernel decision.
	IsAllow bool
}

func loadPolicy(path string) (*Policy, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading policy file: %w", err)
	}

	var policy Policy
	if err := yaml.Unmarshal(data, &policy); err != nil {
		return nil, fmt.Errorf("parsing policy: %w", err)
	}

	return &policy, nil
}

// resolvePolicy expands a parsed policy into a flat list of ResolvedRule
// entries. CIDRs are split into individual /32 entries (the BPF LPM trie
// already supports variable prefix lengths; we expand only to keep the
// per-CIDR bookkeeping simple and because the maximum number of hosts per
// rule is bounded by maxPrefixesPerRule).
func resolvePolicy(p *Policy, maxPrefixesPerRule int) ([]ResolvedRule, []string) {
	var out []ResolvedRule
	var warnings []string

	for _, r := range p.Rules {
		action := strings.ToLower(r.Action)
		if action != "allow" && action != "block" {
			warnings = append(warnings, fmt.Sprintf("rule %q: unknown action %q (skipped)", r.ID, r.Action))
			continue
		}

		host := strings.TrimSpace(r.Host)
		if host == "" {
			warnings = append(warnings, fmt.Sprintf("rule %q: empty host (skipped)", r.ID))
			continue
		}

		proto, protoName := mapProtocol(r.Protocol)
		port := uint16(r.Port)

		ips, err := expandHost(host, maxPrefixesPerRule)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("rule %q: host %q: %v", r.ID, host, err))
			continue
		}
		if len(ips) == 0 {
			warnings = append(warnings, fmt.Sprintf("rule %q: host %q resolved to zero IPs", r.ID, host))
			continue
		}
		if len(ips) >= maxPrefixesPerRule {
			warnings = append(warnings, fmt.Sprintf("rule %q: host %q expanded to >= %d IPs (capped)", r.ID, host, maxPrefixesPerRule))
		}

		for _, ip := range ips {
			out = append(out, ResolvedRule{
				Source:   r,
				IP:       ip,
				Protocol: proto,
				Port:     port,
				IsAllow:  action == "allow",
			})
		}
		if protoName != "" {
			// include the human-friendly protocol in a single log line.
			warnings = append(warnings, fmt.Sprintf("rule %q: protocol=%s port=%d → %d IP(s)", r.ID, protoName, port, len(ips)))
		}
	}
	return out, warnings
}

func mapProtocol(s string) (uint8, string) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", "any":
		return 0, "any"
	case "tcp":
		return 6, "tcp"
	case "udp":
		return 17, "udp"
	case "icmp":
		return 1, "icmp"
	default:
		return 0, "any"
	}
}

// expandHost turns a host spec into a list of IPv4 addresses. Supported:
//
//   - dotted IPv4:     "10.0.0.1"
//   - IPv4 CIDR:       "10.0.0.0/8"
//   - hostname:        "api.example.com" (resolved via the system resolver;
//     returns an error if no IPv4 address is found)
//
// For CIDRs the function enumerates the contained addresses up to
// `cap`. CIDRs larger than /16 are rejected outright to avoid pushing
// millions of entries into the BPF map.
func expandHost(host string, cap int) ([]net.IP, error) {
	if strings.Contains(host, "/") {
		_, ipnet, err := net.ParseCIDR(host)
		if err != nil {
			return nil, fmt.Errorf("invalid CIDR: %w", err)
		}
		ones, bits := ipnet.Mask.Size()
		if bits != 32 {
			return nil, fmt.Errorf("only IPv4 CIDRs are supported, got %d-bit mask", bits)
		}
		// 2^(32-ones) addresses in this CIDR.
		hostCount := uint64(1) << (32 - ones)
		if hostCount > uint64(cap) {
			return nil, fmt.Errorf("CIDR /%d would expand to %d addresses (cap %d)", ones, hostCount, cap)
		}
		out := make([]net.IP, 0, hostCount)
		base := ipnet.IP.To4()
		if base == nil {
			return nil, fmt.Errorf("CIDR base is not IPv4: %s", host)
		}
		baseInt := ipToUint32(base)
		for i := uint64(0); i < hostCount; i++ {
			out = append(out, uint32ToIP(baseInt+uint32(i)))
		}
		return out, nil
	}

	if ip := net.ParseIP(host); ip != nil {
		v4 := ip.To4()
		if v4 == nil {
			return nil, fmt.Errorf("only IPv4 hosts are supported, got %s", host)
		}
		return []net.IP{v4}, nil
	}

	// Hostname → resolve A records only.
	addrs, err := net.LookupIP(host)
	if err != nil {
		return nil, fmt.Errorf("dns resolution failed: %w", err)
	}
	var out []net.IP
	seen := make(map[string]bool)
	for _, a := range addrs {
		v4 := a.To4()
		if v4 == nil {
			continue
		}
		s := v4.String()
		if seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, v4)
		if len(out) >= cap {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no IPv4 addresses found for %s", host)
	}
	return out, nil
}

func ipToUint32(ip net.IP) uint32 {
	ip = ip.To4()
	return uint32(ip[0])<<24 | uint32(ip[1])<<16 | uint32(ip[2])<<8 | uint32(ip[3])
}

func uint32ToIP(n uint32) net.IP {
	return net.IPv4(byte(n>>24), byte(n>>16), byte(n>>8), byte(n))
}
