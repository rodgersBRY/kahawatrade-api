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

### Bags and pockets

New auction lots and direct deliveries store `pocket_weight_kg` (default zero).
The API calculates total and initial available kg from bags × bag type weight +
pocket weight. A supplied total is not used to override this calculation.
Pockets must be smaller than the bag size, with up to three decimal places;
pocket-only lots are supported.

Normal lot PATCH endpoints accept `bags` and `pocket_weight_kg`. Packaging edits
must match the recorded total and never change available kg. Existing edit locks
and audit history apply. Actual stock weight corrections use inventory adjustments.
The pocket value describes received packaging, not remaining physical packages.

Apply migration `20261027120000_lot_pockets` before deploying the API. Existing
lots retain NULL pocket weights until reviewed; the migration does not infer them.
Run `npm run test:unit` for database-independent validation/calculation tests.
