package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"strings"

	"my-first-expo-app/backend/internal/roles"
	"my-first-expo-app/backend/internal/user"
)

func main() {
	databasePath := flag.String("database", "data/app.db", "path to the SQLite database")
	username := flag.String("username", "", "user phone number")
	roleValue := flag.String("role", "", "normal, vip, svip, or admin")
	flag.Parse()

	role := roles.Role(strings.ToLower(strings.TrimSpace(*roleValue)))
	if strings.TrimSpace(*username) == "" || !roles.IsValid(role) {
		log.Fatal("username and a valid role are required")
	}

	store, err := user.OpenStore(*databasePath)
	if err != nil {
		log.Fatalf("open user store: %v", err)
	}
	defer store.Close()

	updated, err := store.UpdateRoleByUsername(context.Background(), *username, role)
	if err != nil {
		log.Fatalf("update user role: %v", err)
	}
	fmt.Printf("updated user %s to role %s\n", updated.Username, updated.Role)
}
