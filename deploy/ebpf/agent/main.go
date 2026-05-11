package main

import (
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/link"
)

// logStats logs eBPF map statistics if available.
func logStats(coll *ebpf.Collection) {
	for name, m := range coll.Maps {
		if info, err := m.Info(); err == nil {
			log.Printf("Map %s: type=%d max_entries=%d", name, info.Type, info.MaxEntries)
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

func main() {
	log.Println("Aether eBPF agent starting...")

	// Load policy from env var or default path
	policyPath := os.Getenv("EBPF_POLICY_PATH")
	if policyPath == "" {
		policyPath = "/etc/aether/ebpf-policy.yaml"
	}
	policy, err := loadPolicy(policyPath)
	if err != nil {
		log.Fatalf("Failed to load policy from %s: %v", policyPath, err)
	}
	log.Printf("Loaded policy with %d rules", len(policy.Rules))
	for i, r := range policy.Rules {
		log.Printf("  Rule %d: [%s] %s %s:%d", i+1, r.Action, r.Protocol, r.Host, r.Port)
	}

	// Load eBPF programs
	spec, err := ebpf.LoadCollectionSpec("bpf/network.bpf.o")
	if err != nil {
		log.Fatalf("Failed to load eBPF spec: %v", err)
	}

	coll, err := ebpf.NewCollection(spec)
	if err != nil {
		log.Fatalf("Failed to load eBPF collection: %v", err)
	}
	defer coll.Close()

	xdpProg, err := lookupProgram(coll, "xdp_filter")
	if err != nil {
		log.Fatal(err)
	}

	iface := os.Getenv("NETWORK_INTERFACE")
	if iface == "" {
		iface = "eth0"
	}

	ifaceIndex, err := net.InterfaceByName(iface)
	if err != nil {
		log.Fatalf("Failed to find interface %s: %v", iface, err)
	}

	ifaceLink, err := link.AttachXDP(link.XDPOptions{
		Program:   xdpProg,
		Interface: ifaceIndex.Index,
	})
	if err != nil {
		log.Fatalf("Failed to attach XDP: %v", err)
	}
	defer ifaceLink.Close()

	log.Printf("XDP attached to %s", iface)

	log.Println("eBPF agent running. Press Ctrl+C to exit.")

	// Periodic stats logging every 30 seconds
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	go func() {
		for range ticker.C {
			logStats(coll)
		}
	}()

	// Wait for signal
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig

	log.Println("Agent shutting down...")
}