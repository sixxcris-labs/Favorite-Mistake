setup:
	cp .env.example .env
	mkdir -p logs models

build:
	docker-compose build

start:
	docker-compose up -d

train-gpu:
	docker-compose exec worker npm run train

deploy-cloud:
	# AWS/GCP one-click (stub)
	aws ecs create-cluster --cluster-name fm-bot
