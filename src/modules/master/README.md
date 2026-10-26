# Master Module

## Purpose

Owns core reference data used by all transactional modules:

- Suppliers
- Buyers
- Warehouses
- Grades
- Bag types

## Structure

- `master.routes.ts`: HTTP route declarations
- `master.controller.ts`: request parsing + response mapping
- `master.service.ts`: DB operations and business behavior
- `master.validation.ts`: Zod request schemas

## Endpoints

- `POST /api/v1/master/suppliers`
- `GET /api/v1/master/suppliers`
- `PUT /api/v1/master/suppliers/:id` (admin only)
- `DELETE /api/v1/master/suppliers/:id` (admin only)
- `POST /api/v1/master/buyers`
- `GET /api/v1/master/buyers`
- `PUT /api/v1/master/buyers/:id` (admin only)
- `DELETE /api/v1/master/buyers/:id` (admin only)
- `POST /api/v1/master/warehouses`
- `GET /api/v1/master/warehouses`
- `PUT /api/v1/master/warehouses/:id` (admin only)
- `DELETE /api/v1/master/warehouses/:id` (admin only)
- `POST /api/v1/master/grades`
- `GET /api/v1/master/grades`
- `PUT /api/v1/master/grades/:id` (admin only)
- `DELETE /api/v1/master/grades/:id` (admin only)
- `POST /api/v1/master/bag-types`
- `GET /api/v1/master/bag-types`
- `PUT /api/v1/master/bag-types/:id` (admin only)
- `DELETE /api/v1/master/bag-types/:id` (admin only)

### Delete is a soft delete

`DELETE` sets `deleted_at` on the row and keeps it (`softDeleteById` in `src/db/softDelete.ts`). After that:

- Existing lots, contracts and agreements still point at the row and still show its name.
- Master lists, updates, and the procurement/contracts reference data skip it. Updating or deleting it again returns 404.
- New records can't use it: `ensureReference` and the supplier checks in procurement return 404.
- Inventory reference data still includes it, so lots that use it stay filterable.
- Bulk import ignores deleted rows when checking duplicates, so a deleted name can be imported again as a new row.
- Standard grade and bag type seeders still count deleted rows, so a deleted standard grade or bag type is not re-created on restart.

### Bulk import

Each entity also supports bulk create from a spreadsheet:

- `POST /api/v1/master/<entity>/import` — multipart, field name `file`. Accepts `.xlsx`, `.xls`, `.csv` up to 5MB / 5,000 rows.
- `GET /api/v1/master/<entity>/import-template` — downloads a `.csv` header/example template for that entity.

`<entity>` is one of `suppliers`, `buyers`, `warehouses`, `grades`, `bag-types`.

Behavior: rows are validated with the same Zod schema used by the single-record create endpoint. Rows matching an existing record's natural key (`name`, or `code` for grades — case-insensitive, trimmed, scoped to the org) are skipped, not updated. Invalid rows don't block valid ones — the response reports `inserted` / `skipped` / `errors` per row (1-indexed to match spreadsheet row numbers, header = row 1). See `master.bulkImport.ts` for the shared engine (`runBulkImport`) that all five entities configure into.

## Configuration Notes

- Depends on shared DB config in `src/db/pool.ts`.
- Validation failures are handled by global error middleware.
- No cross-module writes should happen here beyond master tables.
- Standard bag types (`50kg`, `60kg`) are auto-seeded at API startup via `src/bootstrap/defaultBagTypes.ts`.
- Supplier type usage:
  - `auction_agent` is used in auction procurement as the marketing agent/broker.
  - `mill`, `farmer`, and `other` are used for direct procurement suppliers.
