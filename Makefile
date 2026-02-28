.PHONY: dev build test docker-up docker-down migrate

dev:
	bun run --filter '*' dev

build:
	bun run --filter '*' build

test:
	bun test

docker-up:
	docker compose up -d

docker-down:
	docker compose down

migrate:
	bun run --filter @repo/database db:migrate
