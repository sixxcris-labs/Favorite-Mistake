package main

import (
	"context"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gorilla/mux"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/structpb"
)

type TradeTask struct {
	Strategy string   `json:"strategy"`
	Symbols  []string `json:"symbols"`
	Capital  float64  `json:"capital"`
}

type taskQueue struct {
	mu          sync.Mutex
	backlog     []TradeTask
	subscribers map[int]chan TradeTask
	nextID      int
}

func newTaskQueue() *taskQueue {
	return &taskQueue{
		subscribers: make(map[int]chan TradeTask),
	}
}

func (q *taskQueue) Publish(task TradeTask) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.subscribers) == 0 {
		q.backlog = append(q.backlog, task)
		return
	}
	for id, ch := range q.subscribers {
		select {
		case ch <- task:
		default:
			go func(subID int, target chan TradeTask, payload TradeTask) {
				defer func() {
					if r := recover(); r != nil {
						log.Printf("subscriber %d disconnected before receiving task", subID)
					}
				}()
				target <- payload
				log.Printf("subscriber %d drained backlog", subID)
			}(id, ch, task)
			log.Printf("subscriber %d is saturated; task delivery deferred", id)
		}
	}
}

func (q *taskQueue) Subscribe(ctx context.Context) (<-chan TradeTask, func()) {
	q.mu.Lock()
	id := q.nextID
	q.nextID++
	ch := make(chan TradeTask, 16)
	backlog := append([]TradeTask(nil), q.backlog...)
	q.backlog = nil
	q.subscribers[id] = ch
	q.mu.Unlock()

	go func() {
		for _, task := range backlog {
			select {
			case ch <- task:
			case <-ctx.Done():
				return
			}
		}
	}()

	cancel := func() {
		q.mu.Lock()
		if subscriber, ok := q.subscribers[id]; ok {
			close(subscriber)
			delete(q.subscribers, id)
		}
		q.mu.Unlock()
	}

	go func() {
		<-ctx.Done()
		cancel()
	}()

	return ch, cancel
}

type orchestratorService struct {
	queue  *taskQueue
	logger *log.Logger
}

func newOrchestratorService(logger *log.Logger) *orchestratorService {
	return &orchestratorService{queue: newTaskQueue(), logger: logger}
}

func (s *orchestratorService) QueueTrade(ctx context.Context, payload *structpb.Struct) (*structpb.Struct, error) {
	task, err := structToTradeTask(payload)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, err.Error())
	}
	s.logger.Printf("queued trade: strategy=%s symbols=%v", task.Strategy, task.Symbols)
	s.queue.Publish(task)
	ack, _ := structpb.NewStruct(map[string]any{
		"status":   "queued",
		"strategy": task.Strategy,
	})
	return ack, nil
}

func (s *orchestratorService) StreamTrades(_ *emptypb.Empty, stream TradeService_StreamTradesServer) error {
	ctx := stream.Context()
	ch, cancel := s.queue.Subscribe(ctx)
	defer cancel()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case task, ok := <-ch:
			if !ok {
				return nil
			}
			payload, err := tradeTaskToStruct(task)
			if err != nil {
				return err
			}
			if err := stream.Send(payload); err != nil {
				return err
			}
		}
	}
}

func tradeTaskToStruct(task TradeTask) (*structpb.Struct, error) {
	values := map[string]any{
		"strategy": task.Strategy,
		"symbols":  task.Symbols,
		"capital":  task.Capital,
	}
	return structpb.NewStruct(values)
}

func structToTradeTask(payload *structpb.Struct) (TradeTask, error) {
	if payload == nil {
		return TradeTask{}, status.Error(codes.InvalidArgument, "empty payload")
	}
	values := payload.AsMap()
	task := TradeTask{}
	if strategy, ok := values["strategy"].(string); ok {
		task.Strategy = strategy
	}
	if symbols, ok := values["symbols"].([]any); ok {
		for _, symbol := range symbols {
			if s, ok := symbol.(string); ok {
				task.Symbols = append(task.Symbols, s)
			}
		}
	}
	if capital, ok := values["capital"].(float64); ok {
		task.Capital = capital
	}
	return task, nil
}

func main() {
	logger := log.New(os.Stdout, "orchestrator ", log.LstdFlags|log.Lshortfile)
	service := newOrchestratorService(logger)

	go startGRPCServer(service, logger)
	startHTTPServer(service, logger)
}

func startGRPCServer(service *orchestratorService, logger *log.Logger) {
	server := grpc.NewServer()
	RegisterTradeServiceServer(server, service)

	listener, err := net.Listen("tcp", ":50051")
	if err != nil {
		logger.Fatalf("failed to listen: %v", err)
	}
	logger.Printf("gRPC listening on %s", listener.Addr())
	if err := server.Serve(listener); err != nil {
		logger.Fatalf("gRPC server stopped: %v", err)
	}
}

func startHTTPServer(service *orchestratorService, logger *log.Logger) {
	router := mux.NewRouter()
	router.HandleFunc("/trade/start", func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		var task TradeTask
		if err := json.NewDecoder(r.Body).Decode(&task); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		logger.Printf("HTTP trade request: strategy=%s", task.Strategy)
		service.queue.Publish(task)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "queued"})
	}).Methods(http.MethodPost)

	router.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	srv := &http.Server{
		Addr:         ":8080",
		Handler:      router,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
	}
	logger.Printf("HTTP listening on %s", srv.Addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Fatalf("HTTP server stopped: %v", err)
	}
}

type TradeServiceServer interface {
	QueueTrade(context.Context, *structpb.Struct) (*structpb.Struct, error)
	StreamTrades(*emptypb.Empty, TradeService_StreamTradesServer) error
}

func RegisterTradeServiceServer(s grpc.ServiceRegistrar, srv TradeServiceServer) {
	s.RegisterService(&TradeService_ServiceDesc, srv)
}

type TradeService_StreamTradesServer interface {
	Send(*structpb.Struct) error
	grpc.ServerStream
}

var TradeService_ServiceDesc = grpc.ServiceDesc{
	ServiceName: "favorite.TradeService",
	HandlerType: (*TradeServiceServer)(nil),
	Methods: []grpc.MethodDesc{
		{
			MethodName: "QueueTrade",
			Handler:    _TradeService_QueueTrade_Handler,
		},
	},
	Streams: []grpc.StreamDesc{
		{
			StreamName:    "StreamTrades",
			Handler:       _TradeService_StreamTrades_Handler,
			ServerStreams: true,
		},
	},
	Metadata: "trade.proto",
}

func _TradeService_QueueTrade_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(structpb.Struct)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(TradeServiceServer).QueueTrade(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/favorite.TradeService/QueueTrade",
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(TradeServiceServer).QueueTrade(ctx, req.(*structpb.Struct))
	}
	return interceptor(ctx, in, info, handler)
}

type tradeServiceStreamTradesServer struct {
	grpc.ServerStream
}

func (x *tradeServiceStreamTradesServer) Send(m *structpb.Struct) error {
	return x.ServerStream.SendMsg(m)
}

func _TradeService_StreamTrades_Handler(srv interface{}, stream grpc.ServerStream) error {
	m := new(emptypb.Empty)
	if err := stream.RecvMsg(m); err != nil {
		return err
	}
	return srv.(TradeServiceServer).StreamTrades(m, &tradeServiceStreamTradesServer{stream})
}
