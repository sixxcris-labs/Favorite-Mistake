package main

import (
  "context"
  "flag"
  "fmt"
  "log"
  "os"
  "time"

  "google.golang.org/grpc"
  "google.golang.org/grpc/credentials/insecure"
  "google.golang.org/protobuf/types/known/structpb"
)

func main() {
  strategy := flag.String("strategy", "dex-arb", "Strategy to queue")
  capital := flag.Float64("capital", 1000, "Capital allocation for the task")
  symbol := flag.String("symbol", "BTC/USDT", "Primary trading symbol")
  flag.Parse()

  target := os.Getenv("ORCHESTRATOR_GRPC")
  if target == "" {
    target = "localhost:50051"
  }

  ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
  defer cancel()

  conn, err := grpc.DialContext(ctx, target, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithBlock())
  if err != nil {
    log.Fatalf("failed to connect to orchestrator: %v", err)
  }
  defer conn.Close()

  payload, err := structpb.NewStruct(map[string]any{
    "strategy": *strategy,
    "capital":  *capital,
    "symbols":  []any{*symbol},
  })
  if err != nil {
    log.Fatalf("failed to create payload: %v", err)
  }

  var response structpb.Struct
  if err := conn.Invoke(ctx, "/favorite.TradeService/QueueTrade", payload, &response); err != nil {
    log.Fatalf("queue trade failed: %v", err)
  }

  fmt.Println("queued task:", response.AsMap())
}
