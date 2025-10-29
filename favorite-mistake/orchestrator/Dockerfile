FROM golang:1.22-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o /out/orchestrator

FROM alpine:3.20
WORKDIR /app
COPY --from=builder /out/orchestrator /usr/local/bin/orchestrator
EXPOSE 8080 50051
ENTRYPOINT ["orchestrator"]
