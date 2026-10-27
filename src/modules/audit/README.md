# Editing saved operations records

Saved lots, agreements, contracts, shipments and cost entries can be edited after they are created. A field locks once other records copy it or depend on it. Every edit, delete and cancel is written to `audit_logs`.

## Who can edit

Edit rights match create rights. The route mounts in `src/app/registerRoutes.ts` and the RLS policies enforce them.

| Area | Roles |
| --- | --- |
| Auction lots, direct deliveries, direct agreements | admin, trader |
| Lot pricing (`/api/v1/costs/lots`) | admin, finance |
| Contracts and allocation cancel | admin, trader |
| Shipment details | admin, trader, warehouse |
| Cost entries | admin, finance |
| Master data | admin |

Compliance can open the shipments area but the `shipments_update` policy doesn't include it, so the web app hides Edit for that role.

## Lock rules

An edit request may resend a locked field with its current value. Only a field whose value actually changes is checked against the locks. A refused edit returns 409 with a message such as "Can't change grade after the lot is allocated to a contract".

### Never editable

- `status`, `allocated_kg`, `shipped_kg`, `weight_available_kg`
- A lot's `source`, weight and bag count. Use inventory stock adjustments, which record a reason.
- A shipment's contract and allocations
- Stock adjustments and generated shipment documents

### Lots

A lot counts as allocated when it has any allocation that isn't cancelled. It counts as shipped when any of its allocations has shipped.

| Fields | Editable until |
| --- | --- |
| Auction: lot number, sale number, outturn number, mark, marketing agent, grade, bag type, crop year | the lot is allocated |
| Direct: internal lot code, delivery reference, grade, bag type | the lot is allocated |
| Warehouse, quality figures, purchase price, auction fees, processing cost, catalog reference | the lot ships |

Cancelling every allocation on a lot makes its identity fields editable again.

### Direct agreements

Supplier, agreed price, currency and crop year lock after the first delivery, because each delivery copies them into its lot. The agreement reference can always change.

### Contracts

Nothing changes on a closed contract.

| Fields | Rule |
| --- | --- |
| Grade | locks after the first live allocation |
| Number, buyer, price, price terms, currency | lock after the first shipment, since the commercial invoice uses them |
| Quantity | can't go below the kg already allocated or shipped; the contract status is recalculated |
| Shipment window | always editable; start must not be after end |

### Allocations

An allocation still in `allocated` status can be cancelled. Its kg go back to the lot and come off the contract's allocated total. Shipped allocations can't be cancelled.

### Shipments

Nothing changes once the shipment is `completed`.

| Fields | Editable until |
| --- | --- |
| Shipment number | the shipment leaves `planned`, or documents are generated |
| Container number, seal number, planned departure | the shipment is `on_vessel` |

Changing the shipment number also updates the copy in `traceability_snapshot`.

### Cost entries

Category, amount, currency and notes are always editable. The lot or shipment a cost belongs to is not.

## Audit log

Each row in `audit_logs` records the entity type and id, the action (`update`, `delete` or `cancel`), the changed fields as `{ field: { from, to } }`, the user, role and API key behind the change, and whether it happened in a super admin impersonation session. An edit that changes nothing writes no row.

The table has select and insert policies only. App users can't rewrite or delete history.

`GET /api/v1/audit-logs?entity_type=<type>&entity_id=<id>` returns a record's history, newest first. Each entity type is readable by the roles that can open its area; see `VIEW_ROLES` in `src/modules/audit/audit.service.ts`.

## Where the code lives

- `src/common/audit.ts`: diffing, lock checks, `updateColumns`, `recordAudit`
- `src/db/softDelete.ts`: audited master data updates and deletes
- `src/modules/*/*.edits.ts`: edit rules per module
