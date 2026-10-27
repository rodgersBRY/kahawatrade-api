# Kahawa Trade

Phase 1 backend scaffold for a lot-native coffee export operations system.

## Stack

- API: Node.js + TypeScript + Express
- Database: PostgreSQL
- Schema management: Prisma (`prisma/schema.prisma`)
- Runtime DB access: `pg` with transaction-safe service logic
- Security: JWT + API keys + Argon2 + Helmet + CORS + rate limiting + CSRF + request logging

## Architecture

Codebase is organized for enterprise maintainability with separated layers:

- `src/app`: Express app setup and centralized route registration
- `src/config`: environment and runtime config
- `src/db`: connection pool and transaction helper
- `src/common`: shared middleware, errors, and reusable DB/domain helpers
- `src/modules/*`: domain modules with strict separation:
  - `*.routes.ts`
  - `*.controller.ts`
  - `*.service.ts`
  - `*.validation.ts` (where needed)

Each module has its own `README.md` under `src/modules/<module>/README.md`.

## Multi-tenant model

Kahawa Trade runs in shared-database, row-level isolation mode:

- Every business table includes `organization_id`.
- JWTs and API keys resolve an `organizationId` that scopes every query.
- Unique identifiers (lot code, contract number, shipment number) are unique per organization, not globally.

Bootstrap flow: the very first registration creates the first organization, its subscription, and the initial admin user.

## Super admin layer

Platform operators authenticate separately via `/api/internal/v1` with a dedicated JWT secret.
This surface can manage organizations, subscriptions, and impersonation without touching tenant auth.

Super admin tokens are issued via:

- `POST /api/internal/v1/auth/login`

Internal endpoints (super admin only):

- `GET /api/internal/v1/orgs`
- `POST /api/internal/v1/orgs`
- `GET /api/internal/v1/orgs/:orgId`
- `PATCH /api/internal/v1/orgs/:orgId/plan`
- `PATCH /api/internal/v1/orgs/:orgId/trial`
- `PATCH /api/internal/v1/orgs/:orgId/status`
- `POST /api/internal/v1/orgs/:orgId/notes`
- `POST /api/internal/v1/orgs/:orgId/impersonate`
- `GET /api/internal/v1/revenue`
- `GET /api/internal/v1/alerts`

Tenant admins never access these routes. Super admin tokens are signed with `SUPER_ADMIN_JWT_SECRET` and validated by a separate middleware.
`SUPER_ADMIN_JWT_TTL` controls token expiry (default `8h`).

Suspended organizations are blocked from mutating requests (read-only access only).

## Security Controls Implemented

- Authentication and authorization:
  - JWT access/refresh authentication
  - DB-backed session management with refresh token rotation
  - API key authentication (`x-api-key`)
  - Role-based authorization (`admin`, `trader`, `warehouse`, `finance`, `compliance`)
- Security middleware:
  - `helmet` security headers
  - strict CORS allowlist
  - global and auth-specific rate limiters
  - JSON and URL-encoded request size limits
  - request logging through `winston`
  - request ID propagation (`x-request-id`)
- Data security:
  - Argon2id password hashing
  - encrypted sensitive session metadata (IP/user-agent)
  - TLS-capable DB config with production SSL enforcement
  - no plaintext API key storage (SHA-256 hashes only)
- API security:
  - recursive request sanitization middleware
  - parameterized SQL queries and safe identifier checks
  - CSRF protection for browser-origin mutating requests
  - idempotency protection for mutating requests (`Idempotency-Key`)
  - API versioning under `/api/v1`

## Identifier format

All primary and foreign keys are UUIDs (v4). Any `:id` path params or `filter_*` values that reference IDs must be UUID strings.

UUID migration note: the UUID migration assumes empty tables. For dev, run `prisma migrate reset` after pulling the migration. For production, you must perform a controlled data migration before deploying.

## Plan enforcement

The API enforces plan limits on write operations using `planGuard` middleware:

- `users` (active users only)
- `lots`
- `api_keys` (active, non-revoked only)

Default limits:

- `starter`: 3 users, 50 lots, 0 API keys
- `growth`: 10 users, 999 lots, 5 API keys
- `enterprise`: unlimited

## What is implemented

- Master data: suppliers, buyers, warehouses, grades, bag types
- Procurement:
  - Auction lots
  - Direct agreements and deliveries
- Inventory:
  - Lot-level stock tracking
  - Stock adjustments with approvals
  - Inventory dashboard
- Contracts and allocations:
  - Contract creation
  - Allocation guardrails (prevents over-allocation and double-selling)
  - Contract dashboard and risk alerts
- Shipments:
  - Shipment creation from allocations
  - Traceability snapshot freeze on shipment creation
  - Shipment status progression checks
- Documents:
  - Commercial invoice
  - Packing list
  - Traceability report
  - Cost breakdown summary
- Costing/profitability:
  - Cost entry capture
  - Contract profitability endpoint
- Traceability:
  - Backward/forward traceability endpoint per lot
- Notifications:
  - Email alerts for key operational events
  - Scheduled contract risk and API-key-expiry alerts

## Quick start

1. Copy env file:

```bash
cp .env.example .env
```

Update secret placeholders in `.env` before running.

2. Start Postgres:

```bash
docker compose up -d
```

3. Install dependencies:

```bash
npm install
```

4. Create database schema with Prisma:

```bash
npm run prisma:migrate:dev
```

5. Start API:

```bash
npm run dev
```

`npm run dev` uses `nodemon` and automatically restarts the server on source changes.

API runs at `http://localhost:4000`.
Versioned endpoints are served under `/api/v1/*`.

## Notification configuration

Set these in `.env` to enable email notifications and daily alerts:

- `EMAILJS_SERVICE_ID`
- `EMAILJS_TEMPLATE_ID`
- `EMAILJS_PUBLIC_KEY`
- `EMAILJS_PRIVATE_KEY`
- `NOTIFICATION_FROM_EMAIL`
- `NOTIFICATION_ADMIN_EMAILS` (optional, comma-separated system recipients)
- `NOTIFICATIONS_CRON_ENABLED` (`true`/`false`)
- `NOTIFICATIONS_CRON_TIMEZONE` (for example `UTC`)
- `CONTRACT_RISK_CRON_SCHEDULE` (default `0 7 * * *`)
- `CONTRACT_RISK_ALERT_WINDOW_DAYS` (default `7`)
- `API_KEY_EXPIRY_CRON_SCHEDULE` (default `15 7 * * *`)
- `API_KEY_EXPIRY_ALERT_WINDOW_DAYS` (default `7`)

## Super admin bootstrap (optional)

If you want the API to create the first super admin automatically:

- `SUPER_ADMIN_BOOTSTRAP_EMAIL`
- `SUPER_ADMIN_BOOTSTRAP_PASSWORD`

If those are set and no super admins exist, the server will create one on startup.

## First-run default users

On first API startup (when `users` table is empty), the server auto-creates one test user per role from:

- `src/bootstrap/defaultUsers.ts`

Default seeded accounts include:

- `admin@kahawatrade.test` (`admin`)
- `trader@kahawatrade.test` (`trader`)
- `warehouse@kahawatrade.test` (`warehouse`)
- `finance@kahawatrade.test` (`finance`)
- `compliance@kahawatrade.test` (`compliance`)

Edit credentials in `src/bootstrap/defaultUsers.ts` before first run if needed.

## Standard bag types bootstrap

On API startup, the server ensures standard bag types exist and seeds missing entries from:

- `src/bootstrap/defaultBagTypes.ts`

Default bag types:

- `50kg`
- `60kg`

This is idempotent and safe to run on every startup (no duplicate inserts for these standards).

## Auth and CSRF Usage

1. Bootstrap the first user:
- `POST /api/v1/auth/register` (first account is automatically `admin`).

2. Login:
- `POST /api/v1/auth/login` to receive `access_token`, `refresh_token`, and `csrf_token`.

3. Call protected endpoints:
- Send `Authorization: Bearer <access_token>` or `x-api-key: <api_key>`.

4. Browser-origin mutating requests (`POST/PUT/PATCH/DELETE`):
- Include header `x-csrf-token: <csrf_token>`.
- Ensure cookie `kahawatrade_csrf` is sent.

## Idempotency Contract

- All mutating endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) require:
  - `Idempotency-Key: <unique-key>`
- Behavior:
  - Same key + same request payload returns stored response (`idempotency-replayed: true`).
  - Same key + different payload returns `409`.
  - Concurrent duplicate request with same key returns `409` while first request is processing.

## Pagination and Filter Contract

Standard query params for list endpoints:

- `page` (default `1`)
- `page_size` (default `20`, max `100`)
- `sort_by` (endpoint-specific allowlist)
- `sort_order` (`asc` or `desc`, default `desc`)
- `search` (text search where supported)
- `filter_<field>` for exact filters
  - examples: `filter_status=allocated`, `filter_supplier_id=12`

Standard list response shape:

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "page_size": 20,
    "total": 0,
    "total_pages": 1,
    "has_next": false,
    "has_prev": false,
    "sort_by": "created_at",
    "sort_order": "desc",
    "search": "optional",
    "filters": {}
  }
}
```

## Prisma workflow

- Update `prisma/schema.prisma`
- Keep datasource connection in `prisma.config.ts` (Prisma 7 style)
- Generate and apply migration locally:

```bash
npm run prisma:migrate:dev
```

- In deployment environments:

```bash
npm run prisma:migrate:deploy
```

## Key endpoints

- `POST /api/internal/v1/auth/login`
- `GET /api/internal/v1/orgs`
- `POST /api/internal/v1/orgs`
- `GET /api/internal/v1/orgs/:orgId`
- `PATCH /api/internal/v1/orgs/:orgId/plan`
- `PATCH /api/internal/v1/orgs/:orgId/trial`
- `PATCH /api/internal/v1/orgs/:orgId/status`
- `POST /api/internal/v1/orgs/:orgId/notes`
- `POST /api/internal/v1/orgs/:orgId/impersonate`
- `GET /api/internal/v1/revenue`
- `GET /api/internal/v1/alerts`
- `GET /api/v1/health`
- `GET /api/v1/auth/csrf-token`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `GET /api/v1/auth/users`
- `POST /api/v1/auth/api-keys` (admin)
- `GET /api/v1/auth/api-keys` (admin)
- `PATCH /api/v1/auth/api-keys/:apiKeyId/revoke` (admin)
- `POST /api/v1/master/suppliers`
- `GET /api/v1/master/suppliers`
- `PUT /api/v1/master/suppliers/:id` (admin)
- `DELETE /api/v1/master/suppliers/:id` (admin)
- `POST /api/v1/master/buyers`
- `GET /api/v1/master/buyers`
- `PUT /api/v1/master/buyers/:id` (admin)
- `DELETE /api/v1/master/buyers/:id` (admin)
- `POST /api/v1/master/warehouses`
- `GET /api/v1/master/warehouses`
- `PUT /api/v1/master/warehouses/:id` (admin)
- `DELETE /api/v1/master/warehouses/:id` (admin)
- `POST /api/v1/master/grades`
- `GET /api/v1/master/grades`
- `PUT /api/v1/master/grades/:id` (admin)
- `DELETE /api/v1/master/grades/:id` (admin)
- `POST /api/v1/master/bag-types`
- `GET /api/v1/master/bag-types`
- `PUT /api/v1/master/bag-types/:id` (admin)
- `DELETE /api/v1/master/bag-types/:id` (admin)
- `POST /api/v1/procurement/auction-lots`
- `GET /api/v1/procurement/auction-lots`
- `POST /api/v1/procurement/direct-agreements`
- `GET /api/v1/procurement/direct-agreements`
- `POST /api/v1/procurement/direct-deliveries`
- `GET /api/v1/procurement/direct-deliveries`
- `PATCH /api/v1/procurement/auction-lots/:lotId`
- `PATCH /api/v1/procurement/direct-agreements/:agreementId`
- `PATCH /api/v1/procurement/direct-deliveries/:deliveryId`
- `GET /api/v1/inventory/lots`
- `POST /api/v1/inventory/adjustments`
- `GET /api/v1/inventory/dashboard`
- `POST /api/v1/contracts`
- `GET /api/v1/contracts`
- `PATCH /api/v1/contracts/:contractId`
- `GET /api/v1/contracts/:contractId/allocations`
- `POST /api/v1/contracts/:contractId/allocations/:allocationId/cancel`
- `POST /api/v1/contracts/:contractId/allocations`
- `GET /api/v1/contracts/dashboard`
- `POST /api/v1/shipments`
- `GET /api/v1/shipments`
- `PATCH /api/v1/shipments/:shipmentId`
- `PATCH /api/v1/shipments/:shipmentId/status`
- `POST /api/v1/shipments/:shipmentId/documents/generate`
- `GET /api/v1/shipments/:shipmentId/documents`
- `POST /api/v1/costs/entries`
- `GET /api/v1/costs/entries`
- `PATCH /api/v1/costs/entries/:entryId`
- `GET /api/v1/costs/lots`
- `PATCH /api/v1/costs/lots/:lotId`
- `GET /api/v1/profitability/contracts/:contractId`
- `GET /api/v1/audit-logs?entity_type=&entity_id=`
- `GET /api/v1/traceability/lots/:lotId`

Which fields each edit endpoint can change, and when they lock, is in [src/modules/audit/README.md](src/modules/audit/README.md).

## Important business guarantees in the API

- Lot inventory is identity-based (`lot_code`) and source-aware (`auction` vs `direct`)
- Allocation cannot exceed:
  - Remaining contract quantity
  - Remaining lot availability
- Shipment cannot over-fulfill contract quantity
- Shipment status cannot move backwards
- Shipment creation freezes a traceability snapshot for auditability

## Production deploy runbook (VPS)

Deployment is manual. The VPS runs its own `compose.yml` (not tracked in this repo, alongside a `Caddyfile` for TLS) with `postgres`, `api`, `frontend` (the web repo's image), and `caddy` services. CI only builds and publishes images to GHCR (`ghcr.io/rodgersbry/kahawatrade-api`) — nothing deploys automatically.

The `api` service requires both `DATABASE_URL` and `DIRECT_URL` in the VPS's `.env` — `prisma.config.ts` reads both eagerly at container startup (via `prisma migrate deploy` in the Docker `CMD`), even though this deployment has no connection pooler, so they're typically the same value pointing at the `postgres` service.

To pull and redeploy the latest image on the VPS:

```bash
cd /opt/kahawatrade   # or wherever compose.yml lives
docker compose pull api
docker compose up -d --force-recreate api
docker compose logs api --tail=100
```

Verify:

```bash
curl -i http://localhost:4000/api/v1/health
```
