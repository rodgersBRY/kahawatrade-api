import { calculatePackaging } from "./packaging.js";
import { PoolClient } from "pg";

import {
  assertNotLocked,
  changedKeys,
  diffInput,
  diffRows,
  recordAudit,
  updateColumns,
} from "../../common/audit.js";
import { ensureReference } from "../../common/dbHelpers.js";
import { ApiError } from "../../common/errors/ApiError.js";
import { withTransaction } from "../../db/pool.js";
import { AuthContext } from "../../types/auth.js";
import {
  AuctionLotUpdateInput,
  DirectAgreementUpdateInput,
  DirectDeliveryUpdateInput,
  LotPricingUpdateInput,
} from "./procurement.validation.js";

type Row = Record<string, unknown>;

const ALLOCATED_REASON = "after the lot is allocated to a contract";
const SHIPPED_REASON = "after the lot is shipped";

// Lock groups for lot edits (see src/modules/audit/README.md).
const AUCTION_IDENTITY_FIELDS = [
  "lot_number",
  "sale_number",
  "outturn_number",
  "mark",
  "marketing_agent_id",
  "grade_id",
  "bag_type_id",
  "crop_year",
];
const DIRECT_IDENTITY_FIELDS = [
  "internal_lot_id",
  "delivery_reference",
  "grade_id",
  "bag_type_id",
];

type LotState = { allocated: boolean; shipped: boolean };

async function loadLotState(client: PoolClient, lotId: string, organizationId: string): Promise<LotState> {
  const result = await client.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE status <> 'cancelled')::int AS committed,
      COUNT(*) FILTER (WHERE status = 'shipped')::int AS shipped
    FROM allocations
    WHERE lot_id = $1 AND organization_id = $2
    `,
    [lotId, organizationId],
  );
  const row = result.rows[0];
  return { allocated: Number(row.committed) > 0, shipped: Number(row.shipped) > 0 };
}

/**
 * Applies the lot lock rules: nothing changes once any of the lot has
 * shipped, and identity fields stop changing once it is allocated.
 */
function assertLotEditable(changed: string[], state: LotState, identityFields: string[]): void {
  if (state.shipped) {
    assertNotLocked(changed, changed, SHIPPED_REASON);
  }
  if (state.allocated) {
    assertNotLocked(changed, identityFields, ALLOCATED_REASON);
  }
}

async function lockLot(
  client: PoolClient,
  lotId: string,
  organizationId: string,
  source: "auction" | "direct" | null,
  label: string,
): Promise<Row> {
  const result = await client.query(
    `SELECT * FROM lots WHERE id = $1 AND organization_id = $2 ${source ? "AND source = $3" : ""} FOR UPDATE`,
    source ? [lotId, organizationId, source] : [lotId, organizationId],
  );
  if (result.rowCount === 0) {
    throw new ApiError(404, `${label} not found`);
  }
  return result.rows[0];
}

async function ensureChangedReferences(
  client: PoolClient,
  changed: string[],
  input: Row,
  organizationId: string,
): Promise<void> {
  const refs: Array<[string, string, string]> = [
    ["grade_id", "grades", "Grade"],
    ["warehouse_id", "warehouses", "Warehouse"],
    ["bag_type_id", "bag_types", "Bag type"],
  ];
  for (const [field, table, label] of refs) {
    if (changed.includes(field)) {
      await ensureReference(client, table, String(input[field]), label, organizationId);
    }
  }
}

async function ensureActiveSupplier(
  client: PoolClient,
  supplierId: string,
  organizationId: string,
): Promise<string> {
  const result = await client.query(
    "SELECT supplier_type FROM suppliers WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL",
    [supplierId, organizationId],
  );
  if (result.rowCount === 0) {
    throw new ApiError(404, "Supplier not found");
  }
  return String(result.rows[0].supplier_type);
}

/** Picks the changed keys out of `input` and renames them to columns. */
function pickColumns(
  input: Row,
  changed: string[],
  columnMap: Record<string, string[]>,
): Row {
  const values: Row = {};
  for (const key of changed) {
    for (const column of columnMap[key] ?? []) {
      values[column] = input[key];
    }
  }
  return values;
}

export async function updateAuctionLot(
  lotId: string,
  input: AuctionLotUpdateInput,
  actor: AuthContext,
): Promise<Row> {
  return withTransaction(async (client) => {
    const lot = await lockLot(client, lotId, actor.organizationId, "auction", "Auction lot");
    const apResult = await client.query(
      "SELECT * FROM auction_procurements WHERE lot_id = $1 AND organization_id = $2 FOR UPDATE",
      [lotId, actor.organizationId],
    );
    const ap = apResult.rows[0] ?? {};

    const current: Row = {
      lot_number: ap.auction_lot_number,
      sale_number: ap.sale_number,
      outturn_number: ap.outturn_number,
      mark: ap.mark,
      marketing_agent_id: ap.marketing_agent_id,
      catalog_document_path: ap.catalog_document_path,
      grade_id: lot.grade_id,
      warehouse_id: lot.warehouse_id,
      bag_type_id: lot.bag_type_id,
      bags: lot.bags_total,
      pocket_weight_kg: lot.pocket_weight_kg,
      crop_year: lot.crop_year,
      purchase_price_per_kg: lot.purchase_price_per_kg,
      auction_fees_total: lot.auction_fees_total,
    };
    const changed = changedKeys(current, input);
    if (changed.length === 0) {
      return lot;
    }

    assertLotEditable(changed, await loadLotState(client, lotId, actor.organizationId), AUCTION_IDENTITY_FIELDS);

    if (changed.includes("marketing_agent_id")) {
      const type = await ensureActiveSupplier(client, String(input.marketing_agent_id), actor.organizationId);
      if (type !== "auction_agent") {
        throw new ApiError(400, "marketing_agent_id must reference a supplier with type auction_agent");
      }
    }
    await ensureChangedReferences(client, changed, input, actor.organizationId);
    if (changed.some((key) => ["bags", "pocket_weight_kg", "bag_type_id"].includes(key))) {
      const weight = await calculatePackaging(client, actor.organizationId, String(input.bag_type_id ?? lot.bag_type_id), Number(input.bags ?? lot.bags_total), Number(input.pocket_weight_kg ?? lot.pocket_weight_kg ?? 0));
      if (Math.round(weight * 1000) !== Math.round(Number(lot.weight_total_kg) * 1000)) {
        throw new ApiError(400, "Bags and pocket weight must match the recorded total weight; use a stock adjustment to change stock weight");
      }
    }


    const updatedLot = await updateColumns(
      client,
      "lots",
      "id",
      lotId,
      actor.organizationId,
      pickColumns(input, changed, {
        lot_number: ["lot_code", "source_reference"],
        marketing_agent_id: ["supplier_id"],
        grade_id: ["grade_id"],
        warehouse_id: ["warehouse_id"],
        bag_type_id: ["bag_type_id"],
        bags: ["bags_total"],
        pocket_weight_kg: ["pocket_weight_kg"],
        crop_year: ["crop_year"],
        purchase_price_per_kg: ["purchase_price_per_kg"],
        auction_fees_total: ["auction_fees_total"],
      }),
    );
    await updateColumns(
      client,
      "auction_procurements",
      "lot_id",
      lotId,
      actor.organizationId,
      pickColumns(input, changed, {
        lot_number: ["auction_lot_number"],
        sale_number: ["sale_number"],
        outturn_number: ["outturn_number"],
        mark: ["mark"],
        marketing_agent_id: ["marketing_agent_id"],
        catalog_document_path: ["catalog_document_path"],
      }),
    );

    await recordAudit(client, actor, {
      entityType: "lot",
      entityId: lotId,
      action: "update",
      changes: diffInput(current, input, changed),
    });
    return updatedLot;
  }, actor);
}

export async function updateDirectDelivery(
  deliveryId: string,
  input: DirectDeliveryUpdateInput,
  actor: AuthContext,
): Promise<Row> {
  return withTransaction(async (client) => {
    const ddResult = await client.query(
      "SELECT * FROM direct_deliveries WHERE id = $1 AND organization_id = $2 FOR UPDATE",
      [deliveryId, actor.organizationId],
    );
    if (ddResult.rowCount === 0) {
      throw new ApiError(404, "Direct delivery not found");
    }
    const delivery = ddResult.rows[0];
    const lotId = String(delivery.lot_id);
    const lot = await lockLot(client, lotId, actor.organizationId, "direct", "Direct delivery");

    const current: Row = {
      internal_lot_id: lot.lot_code,
      delivery_reference: delivery.delivery_reference,
      grade_id: lot.grade_id,
      warehouse_id: lot.warehouse_id,
      bag_type_id: lot.bag_type_id,
      bags: lot.bags_total,
      pocket_weight_kg: lot.pocket_weight_kg,
      moisture_percent: delivery.moisture_percent,
      screen_size: delivery.screen_size,
      defects_percent: delivery.defects_percent,
      purchase_price_per_kg: lot.purchase_price_per_kg,
      additional_cost_total: lot.additional_cost_total,
    };
    const changed = changedKeys(current, input);
    if (changed.length === 0) {
      return delivery;
    }

    assertLotEditable(changed, await loadLotState(client, lotId, actor.organizationId), DIRECT_IDENTITY_FIELDS);
    await ensureChangedReferences(client, changed, input, actor.organizationId);
    if (changed.some((key) => ["bags", "pocket_weight_kg", "bag_type_id"].includes(key))) {
      const weight = await calculatePackaging(client, actor.organizationId, String(input.bag_type_id ?? lot.bag_type_id), Number(input.bags ?? lot.bags_total), Number(input.pocket_weight_kg ?? lot.pocket_weight_kg ?? 0));
      if (Math.round(weight * 1000) !== Math.round(Number(lot.weight_total_kg) * 1000)) {
        throw new ApiError(400, "Bags and pocket weight must match the recorded total weight; use a stock adjustment to change stock weight");
      }
    }


    await updateColumns(
      client,
      "lots",
      "id",
      lotId,
      actor.organizationId,
      pickColumns(input, changed, {
        internal_lot_id: ["lot_code"],
        delivery_reference: ["source_reference"],
        grade_id: ["grade_id"],
        warehouse_id: ["warehouse_id"],
        bag_type_id: ["bag_type_id"],
        bags: ["bags_total"],
        pocket_weight_kg: ["pocket_weight_kg"],
        purchase_price_per_kg: ["purchase_price_per_kg"],
        additional_cost_total: ["additional_cost_total"],
      }),
    );
    const updatedDelivery = await updateColumns(
      client,
      "direct_deliveries",
      "id",
      deliveryId,
      actor.organizationId,
      pickColumns(input, changed, {
        delivery_reference: ["delivery_reference"],
        moisture_percent: ["moisture_percent"],
        screen_size: ["screen_size"],
        defects_percent: ["defects_percent"],
      }),
    );

    await recordAudit(client, actor, {
      entityType: "lot",
      entityId: lotId,
      action: "update",
      changes: diffInput(current, input, changed),
    });
    return updatedDelivery;
  }, actor);
}

/** Pricing-only lot edit, used by finance. Locked once the lot has shipped. */
export async function updateLotPricing(
  lotId: string,
  input: LotPricingUpdateInput,
  actor: AuthContext,
): Promise<Row> {
  return withTransaction(async (client) => {
    const lot = await lockLot(client, lotId, actor.organizationId, null, "Lot");
    const changed = changedKeys(lot, input);
    if (changed.length === 0) {
      return lot;
    }

    assertLotEditable(changed, await loadLotState(client, lotId, actor.organizationId), []);

    const values: Row = {};
    for (const key of changed) {
      values[key] = input[key as keyof LotPricingUpdateInput];
    }
    const updated = await updateColumns(client, "lots", "id", lotId, actor.organizationId, values);

    await recordAudit(client, actor, {
      entityType: "lot",
      entityId: lotId,
      action: "update",
      changes: diffRows(lot, updated, changed),
    });
    return updated;
  }, actor);
}

const AGREEMENT_LOCKED_FIELDS = ["supplier_id", "agreed_price_per_kg", "currency", "crop_year"];

export async function updateDirectAgreement(
  agreementId: string,
  input: DirectAgreementUpdateInput,
  actor: AuthContext,
): Promise<Row> {
  return withTransaction(async (client) => {
    const result = await client.query(
      "SELECT * FROM direct_agreements WHERE id = $1 AND organization_id = $2 FOR UPDATE",
      [agreementId, actor.organizationId],
    );
    if (result.rowCount === 0) {
      throw new ApiError(404, "Direct agreement not found");
    }
    const agreement = result.rows[0];
    const changed = changedKeys(agreement, input);
    if (changed.length === 0) {
      return agreement;
    }

    const deliveries = await client.query(
      "SELECT COUNT(*)::int AS count FROM direct_deliveries WHERE agreement_id = $1 AND organization_id = $2",
      [agreementId, actor.organizationId],
    );
    if (Number(deliveries.rows[0].count) > 0) {
      assertNotLocked(changed, AGREEMENT_LOCKED_FIELDS, "after deliveries are recorded against the agreement");
    }

    if (changed.includes("supplier_id")) {
      const type = await ensureActiveSupplier(client, String(input.supplier_id), actor.organizationId);
      if (type === "auction_agent") {
        throw new ApiError(400, "supplier_id cannot reference an auction_agent supplier");
      }
    }

    const values: Row = {};
    for (const key of changed) {
      values[key] = input[key as keyof DirectAgreementUpdateInput];
    }
    const updated = await updateColumns(
      client,
      "direct_agreements",
      "id",
      agreementId,
      actor.organizationId,
      values,
    );

    await recordAudit(client, actor, {
      entityType: "direct_agreement",
      entityId: agreementId,
      action: "update",
      changes: diffRows(agreement, updated, changed),
    });
    return updated;
  }, actor);
}
