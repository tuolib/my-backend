# ho-ecommerce

Enterprise e-commerce platform — Monorepo (Bun + Hono + Drizzle + PostgreSQL + Redis)

## Quick Start

```bash
bun install          # install dependencies
bun run dev          # one command: docker + migrate + all services
```

## Scripts

### Infrastructure

| Command | Description |
|---------|-------------|
| `bun run dev:up` | Start PG + Redis containers |
| `bun run dev:stop` | Stop containers (data preserved) |
| `bun run dev:down` | Stop and remove containers (volumes preserved) |
| `bun run dev:clean` | Stop and remove containers + volumes (full reset) |
| `bun run dev:logs` | Tail container logs |
| `bun run dev:ps` | Show container status |
| `bun run dev` | One-command startup (infra + migrate + all services) |

### Database

| Command | Description |
|---------|-------------|
| `bun run db:migrate` | Run Drizzle migrations |
| `bun run db:generate` | Generate Drizzle migration files |
| `bun run db:studio` | Launch Drizzle Studio (visual DB browser) |
| `bun run db:psql` | Connect to PG interactive terminal |
| `bun run db:reset` | Full DB reset (drop volumes + recreate + migrate) |

### Code Quality

| Command | Description |
|---------|-------------|
| `bun run lint` | Check formatting with Prettier |
| `bun run format` | Auto-format with Prettier |


### test api 

```bash
bun test --env-file ../../../../.env user.test.ts
```