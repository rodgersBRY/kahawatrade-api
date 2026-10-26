# Procurement Module

## Purpose

Handles inbound lot creation from both procurement channels:

- Auction procurement (immutable lot identity)
- Direct agreements and direct deliveries

## Structure

- `procurement.routes.ts`
- `procurement.controller.ts`
- `procurement.service.ts`
- `procurement.validation.ts`

## Endpoints

- `POST /api/v1/procurement/auction-lots`
- `GET /api/v1/procurement/auction-lots`
- `POST /api/v1/procurement/direct-agreements`
- `GET /api/v1/procurement/direct-agreements`
- `GET /api/v1/procurement/reference-data`
- `POST /api/v1/procurement/direct-deliveries`
- `GET /api/v1/procurement/direct-deliveries`

## Configuration Notes

- Uses transactions from `src/db/pool.ts` for lot + procurement record atomicity.
- Uses shared helper checks (`ensureReference`) for referential integrity.
- Lot creation defaults to `status = in_stock` and initializes `weight_available_kg`.
- Lot creation endpoints are plan-guarded (per-organization lot limits).
- `reference-data` exposes user-friendly option lists for suppliers, agents, warehouses, grades, bag types, and agreements.
- Auction intake requires `marketing_agent_id` to point to a supplier with type `auction_agent` (configured in Master Data).
- Direct agreements cannot be created against auction marketing agents.
- Auction intake requires `sale_number`, `outturn_number` and `mark` from the auction catalogue.
- Auction lot numbers repeat across sales, so auction lots are unique per org on `(sale_number, auction_lot_number)`. Direct lots stay unique per org on `lot_code`.
