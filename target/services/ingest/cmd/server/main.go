package main

import (
	"log"
	"net/http"
	"os"
	"time"

	ingest "github.com/learnwithparam/software-factory/target/services/ingest"
)

func main() {
	addr := os.Getenv("INGEST_ADDR")
	if addr == "" {
		addr = ":8081"
	}
	srv := &http.Server{
		Addr:              addr,
		Handler:           ingest.Handler(ingest.Seed()),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       30 * time.Second,
	}
	log.Printf("ingest listening on %s", addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
