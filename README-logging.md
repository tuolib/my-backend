# Logging Guide (Local + Server)

## 1. Local Development

Start your API stack first (for example):

```bash
bun run dev
# or
bun run sim:up
```

Start the local logging stack:

```bash
bun run log:up
```

Open Grafana:
- URL: `http://localhost:3001`
- User: `admin`
- Password: `admin`

Loki is pre-provisioned as the default datasource.

## 2. Local Query Patterns

Open Grafana -> Explore -> select `Loki`.

Use these LogQL queries:

```logql
{service=~"api|api-1|api-2"} |= "requestId: 2f1c9a7b-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

```logql
{service=~"api|api-1|api-2"} |= "ERROR"
```

```logql
{service=~"api|api-1|api-2"} |= " 5" |= "requestId"
```

Tips:
- `service` label comes from docker-compose service name.
- `container` label is the full container name.
- Your dev logger now prints full `requestId`, so direct search works.

## 3. Operations Commands

```bash
bun run log:tail
bun run log:down
```

## 4. Production Server Plan

Use the same model as local:
1. App writes logs to `stdout/stderr` only.
2. Node-level collector (Promtail / Fluent Bit / Vector) scrapes container logs.
3. Collector pushes logs to centralized storage (Loki / OpenSearch / Cloud provider).
4. Query by `requestId` first, then correlate by service + time window.

Recommended labels in production:
- `env`
- `service`
- `instance`
- `version`
- `region`

Retention suggestion:
- Hot logs: 7-30 days
- Archive: 90-180 days
