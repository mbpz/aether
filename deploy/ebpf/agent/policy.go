package main

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

type PolicyRule struct {
	ID       string `yaml:"id"`
	Action   string `yaml:"action"` // "allow" or "block"
	Protocol string `yaml:"protocol"`
	Host     string `yaml:"host"`
	Port     int    `yaml:"port"`
}

type Policy struct {
	Rules []PolicyRule `yaml:"rules"`
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