package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"strings"

	"my-first-expo-app/backend/internal/authstorage"
)

func main() {
	source := authstorage.Paths{}
	target := authstorage.Paths{}
	flag.StringVar(&source.Database, "source-database", "", "legacy SQLite database path")
	flag.StringVar(&source.AvatarDir, "source-avatars", "", "legacy avatar directory")
	flag.StringVar(&source.JWTSecret, "source-jwt-secret", "", "legacy JWT secret path")
	flag.StringVar(&target.Database, "target-database", "", "shared SQLite database path")
	flag.StringVar(&target.AvatarDir, "target-avatars", "", "shared avatar directory")
	flag.StringVar(&target.JWTSecret, "target-jwt-secret", "", "shared JWT secret path")
	flag.Parse()

	for name, value := range map[string]string{
		"source-database":   source.Database,
		"source-avatars":    source.AvatarDir,
		"source-jwt-secret": source.JWTSecret,
		"target-database":   target.Database,
		"target-avatars":    target.AvatarDir,
		"target-jwt-secret": target.JWTSecret,
	} {
		if strings.TrimSpace(value) == "" {
			log.Fatalf("-%s is required", name)
		}
	}

	result, err := authstorage.Migrate(context.Background(), source, target)
	if err != nil {
		log.Fatalf("migrate auth storage: %v", err)
	}
	if !result.Migrated {
		fmt.Println("Shared auth storage already exists or no legacy database was found; migration skipped.")
		return
	}
	fmt.Printf("Migrated auth database and %d referenced avatar file(s).\n", result.AvatarFilesCopied)
}
