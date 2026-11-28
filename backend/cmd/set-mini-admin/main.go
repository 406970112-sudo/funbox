package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"

	"my-first-expo-app/backend/internal/user"
)

func main() {
	database := flag.String("database", "data/app.db", "path to the existing SQLite database")
	userID := flag.String("user-id", "", "full FunBox user ID of the first mini-program owner")
	flag.Parse()
	id := strings.TrimSpace(*userID)
	if id == "" {
		log.Fatal("-user-id is required")
	}
	file, err := os.Stat(*database)
	if err != nil || !file.Mode().IsRegular() {
		log.Fatal("-database must point to an existing SQLite file")
	}
	store, err := user.OpenStore(*database)
	if err != nil {
		log.Fatalf("open user store: %v", err)
	}
	defer store.Close()
	if err := store.MiniAdmin().BootstrapOwner(context.Background(), id); err != nil {
		log.Fatalf("set mini-program owner: %v", err)
	}
	fmt.Printf("Mini-program owner: %s\n", id)
}
