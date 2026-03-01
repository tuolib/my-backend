.PHONY: dev build test docker-up docker-down docker-build docker-logs migrate seed smoke stress health stock-sync

# ── 本地开发 ──
dev:
	bun run --filter '*' dev

build:
	bun run --filter '*' build

test:
	bun test

# ── Docker ──
docker-up:
	docker compose up -d --build

docker-down:
	docker compose down

docker-build:
	docker compose build

docker-logs:
	docker compose logs -f

# ── 数据库 ──
migrate:
	bun run --filter @repo/database db:migrate

seed:
	bun run --filter @repo/database db:seed

# ── 测试 ──
smoke:
	bash scripts/smoke-test.sh http://localhost:80

stress:
	bun run scripts/stress-test.ts 100 http://localhost:80

# ── 运维 ──
stock-sync:
	bun run scripts/stock-sync.ts

health:
	@curl -s -X POST http://localhost/health | jq .
