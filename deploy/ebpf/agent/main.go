package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/link"
)

func main() {
	log.Println("Aether eBPF agent starting...")

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

	// Attach XDP program
	xdpProg := coll.Programs["xdp_filter"]
	if xdpProg == nil {
		log.Fatal("XDP program not found in object")
	}

	iface := os.Getenv("NETWORK_INTERFACE")
	if iface == "" {
		iface = "eth0"
	}

	ifaceLink, err := link.AttachXDP(link.XDPOptions{
		Program:   xdpProg,
		Interface: link.AttachXDPByName(iface),
	})
	if err != nil {
		log.Fatalf("Failed to attach XDP: %v", err)
	}
	defer ifaceLink.Close()

	log.Printf("XDP attached to %s", iface)

	// Attach TC program (optional - may fail on some systems)
	tcProg := coll.Programs["tc_egress"]
	if tcProg != nil {
		tcLink, err := link.AttachTC(link.TCOptions{
			Program:   tcProg,
			Interface: link.AttachTCByName(iface),
			Direction: "egress",
		})
		if err != nil {
			log.Printf("TC attach warning (may need rlimit): %v", err)
		} else {
			defer tcLink.Close()
		}
	}

	log.Println("eBPF agent running. Press Ctrl+C to exit.")

	// Wait for signal
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig

	log.Println("Agent shutting down...")
}