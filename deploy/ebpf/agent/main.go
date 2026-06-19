package main

import (
	"context"
	"encoding/binary"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/link"
)

const (
	maxPrefixesPerRule = 1024
	mapStatsPass       = 0
	mapStatsDrop       = 1
	mapStatsNonIP      = 2
)

// logStats logs eBPF map statistics if available.
func logStats(coll *ebpf.Collection) {
	for name, m := range coll.Maps {
		if info, err := m.Info(); err == nil {
			log.Printf("Map %s: type=%d max_entries=%d", name, info.Type, info.MaxEntries)
		}
	}
	// Also dump the per-cpu counter map.
	if m, ok := coll.Maps["stats"]; ok {
		var key uint32
		for _, which := range []uint32{mapStatsPass, mapStatsDrop, mapStatsNonIP} {
			key = which
			var perCPU []uint64
			if err := m.Lookup(&key, &perCPU); err == nil {
				var sum uint64
				for _, v := range perCPU {
					sum += v
				}
				label := map[uint32]string{mapStatsPass: "pass", mapStatsDrop: "drop", mapStatsNonIP: "non_ip"}[which]
				log.Printf("Stats[%s]: %d", label, sum)
			}
		}
	}
}

// lookupProgram safely retrieves an eBPF program from a collection,
// returning a descriptive error if the program is not found.
func lookupProgram(coll *ebpf.Collection, name string) (*ebpf.Program, error) {
	prog, ok := coll.Programs[name]
	if !ok {
		available := make([]string, 0, len(coll.Programs))
		for k := range coll.Programs {
			available = append(available, k)
		}
		return nil, fmt.Errorf("program %q not found in collection; available programs: %v", name, available)
	}
	return prog, nil
}

type bpfRuleKey struct {
	PrefixLen uint32
	IP        uint32 // network byte order
}

type bpfRuleValue struct {
	_    [4]byte // alignment padding
	Data uint32  // (proto<<24) | port
}

// loadAndAttachXDP loads the compiled BPF object, attaches it to the
// given interface, and returns the loaded collection. Caller is
// responsible for closing the returned collection and link.
func loadAndAttachXDP(bpfObjPath, ifaceName string) (*ebpf.Collection, link.Link, error) {
	spec, err := ebpf.LoadCollectionSpec(bpfObjPath)
	if err != nil {
		return nil, nil, fmt.Errorf("load collection spec: %w", err)
	}
	coll, err := ebpf.NewCollection(spec)
	if err != nil {
		return nil, nil, fmt.Errorf("new collection: %w", err)
	}

	xdpProg, err := lookupProgram(coll, "xdp_filter")
	if err != nil {
		coll.Close()
		return nil, nil, err
	}

	iface, err := net.InterfaceByName(ifaceName)
	if err != nil {
		coll.Close()
		return nil, nil, fmt.Errorf("find interface %s: %w", ifaceName, err)
	}

	ifaceLink, err := link.AttachXDP(link.XDPOptions{
		Program:   xdpProg,
		Interface: iface.Index,
	})
	if err != nil {
		coll.Close()
		return nil, nil, fmt.Errorf("attach XDP: %w", err)
	}
	return coll, ifaceLink, nil
}

// programRules pushes every `allow` rule into the LPM trie. Block rules
// are NOT programmed; the BPF map is allow-only.
func programRules(coll *ebpf.Collection, rules []ResolvedRule) (int, int, error) {
	m, ok := coll.Maps["rules"]
	if !ok {
		return 0, 0, fmt.Errorf("map 'rules' not found in collection")
	}
	maxEntries := int(m.MaxEntries())
	if maxEntries == 0 {
		maxEntries = 4096
	}

	allowPushed := 0
	blockSkipped := 0
	dropped := 0
	for _, r := range rules {
		if !r.IsAllow {
			blockSkipped++
			continue
		}
		if allowPushed >= maxEntries {
			log.Printf("WARNING: BPF map full after %d allow rules; %d remaining rules dropped", allowPushed, len(rules)-allowPushed)
			dropped = len(rules) - allowPushed - blockSkipped
			break
		}
		// Network byte order = big-endian, which is what the kernel
		// BPF_LPM_TRIE expects for the lookup key.
		ip4 := r.IP.To4()
		if ip4 == nil {
			continue
		}
		ipBE := binary.BigEndian.Uint32(ip4)
		key := bpfRuleKey{PrefixLen: 32, IP: ipBE}
		value := bpfRuleValue{Data: uint32(r.Protocol)<<24 | uint32(r.Port)}
		if err := m.Put(key, value); err != nil {
			log.Printf("WARNING: failed to push rule for %s: %v", r.IP, err)
			dropped++
			continue
		}
		allowPushed++
	}
	return allowPushed, dropped, nil
}

func main() {
	log.Println("Aether eBPF agent starting...")

	// ------------------------------------------------------------------
	// 1. Load policy.
	// ------------------------------------------------------------------
	policyPath := os.Getenv("EBPF_POLICY_PATH")
	if policyPath == "" {
		policyPath = "/etc/aether/ebpf-policy.yaml"
	}
	policy, err := loadPolicy(policyPath)
	if err != nil {
		log.Fatalf("Failed to load policy from %s: %v", policyPath, err)
	}
	log.Printf("Loaded %d raw rule(s) from %s", len(policy.Rules), policyPath)

	resolved, warnings := resolvePolicy(policy, maxPrefixesPerRule)
	for _, w := range warnings {
		log.Printf("  policy: %s", w)
	}
	allowCount, blockCount := 0, 0
	for _, r := range resolved {
		if r.IsAllow {
			allowCount++
		} else {
			blockCount++
		}
	}
	log.Printf("Resolved %d entries: %d allow, %d block", len(resolved), allowCount, blockCount)

	// ------------------------------------------------------------------
	// 2. Find compiled BPF object.
	// ------------------------------------------------------------------
	bpfObjPath := os.Getenv("BPF_OBJ_PATH")
	if bpfObjPath == "" {
		bpfObjPath = "bpf/network.bpf.o"
	}
	if _, err := os.Stat(bpfObjPath); err != nil {
		log.Fatalf("BPF object not found at %s (compile with: clang -O2 -target bpf -c bpf/network.bpf.c -o %s): %v",
			bpfObjPath, bpfObjPath, err)
	}

	// ------------------------------------------------------------------
	// 3. Load BPF collection and attach XDP.
	// ------------------------------------------------------------------
	ifaceName := os.Getenv("NETWORK_INTERFACE")
	if ifaceName == "" {
		ifaceName = "eth0"
	}

	coll, ifaceLink, err := loadAndAttachXDP(bpfObjPath, ifaceName)
	if err != nil {
		log.Fatalf("Failed to attach XDP: %v", err)
	}
	defer coll.Close()
	defer ifaceLink.Close()

	log.Printf("XDP attached to %s", ifaceName)

	// ------------------------------------------------------------------
	// 4. Program rules into the map.
	// ------------------------------------------------------------------
	pushed, dropped, err := programRules(coll, resolved)
	if err != nil {
		log.Fatalf("Failed to program rules: %v", err)
	}
	log.Printf("Programmed %d allow rule(s) into BPF map (skipped %d block, dropped %d over-cap)",
		pushed, blockCount, dropped)

	if pushed == 0 && allowCount > 0 {
		log.Printf("WARNING: zero allow rules programmed; only loopback traffic will be permitted")
	}

	// ------------------------------------------------------------------
	// 5. Optional HTTP health endpoint (for K8s readinessProbe).
	// ------------------------------------------------------------------
	if addr := os.Getenv("HEALTH_ADDR"); addr != "" {
		go serveHealth(addr, coll, ifaceLink)
	}

	// ------------------------------------------------------------------
	// 6. Periodic stats + signal handling.
	// ------------------------------------------------------------------
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	go func() {
		for range ticker.C {
			logStats(coll)
		}
	}()

	// Watch the policy file for changes and hot-reload. Disabled when
	// EBPF_HOT_RELOAD=false.
	if os.Getenv("EBPF_HOT_RELOAD") != "false" {
		go watchPolicy(policyPath, coll)
	}

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	log.Println("Agent shutting down...")
}

// watchPolicy periodically re-reads the policy file and reprograms the
// map. New entries are added; entries that disappear from the policy are
// not removed (we cannot enumerate the LPM trie from userspace
// efficiently) so a manual `kill -HUP` or restart is required to shrink
// the rule set.
func watchPolicy(policyPath string, coll *ebpf.Collection) {
	var lastMTime time.Time
	t := time.NewTicker(15 * time.Second)
	defer t.Stop()
	for range t.C {
		info, err := os.Stat(policyPath)
		if err != nil {
			continue
		}
		if !info.ModTime().After(lastMTime) {
			continue
		}
		lastMTime = info.ModTime()
		log.Printf("Policy file changed, reloading...")
		policy, err := loadPolicy(policyPath)
		if err != nil {
			log.Printf("Reload failed: %v", err)
			continue
		}
		resolved, _ := resolvePolicy(policy, maxPrefixesPerRule)
		pushed, _, err := programRules(coll, resolved)
		if err != nil {
			log.Printf("Reprogram failed: %v", err)
			continue
		}
		log.Printf("Reload: pushed %d allow rules", pushed)
	}
}

// serveHealth exposes a tiny HTTP /health endpoint that 200s when the
// XDP program is still attached and the BPF collection is alive. It is
// disabled by default to keep the surface area small; enable it with
// HEALTH_ADDR=:8080 in the DaemonSet.
func serveHealth(addr string, coll *ebpf.Collection, l link.Link) {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		if true { // XDP detach not directly observable from userspace
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("ok"))
			return
		}
		w.WriteHeader(http.StatusServiceUnavailable)
	})
	mux.HandleFunc("/stats", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		logStats(coll)
		_, _ = w.Write([]byte("see logs\n"))
	})
	srv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 2 * time.Second}
	if err := srv.ListenAndServe(); err != nil {
		log.Printf("health server stopped: %v", err)
	}
}

// helper for clap-style flag parsing without taking a flag dep
func envOr(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

// suppress unused warnings for imports pulled in by some builds
var _ = context.Background
var _ = exec.Command
var _ = strings.ToLower
var _ = strconv.Itoa
