import crypto from "node:crypto";

import { ApiError } from "../../common/errors/ApiError.js";
import { ensureReference, toNumber } from "../../common/dbHelpers.js";
import { withActor, withTransaction } from "../../db/pool.js";
import { AuthContext } from "../../types/auth.js";
import { CostEntryInput } from "./finance.validation.js";

export class FinanceService {
  async createCostEntry(input: CostEntryInput, actor: AuthContext): Promise<unknown> {
    return withTransaction(async (client) => {
      if (input.lot_id) {
        await ensureReference(client, "lots", input.lot_id, "Lot", actor.organizationId);
      }
      if (input.shipment_id) {
        await ensureReference(client, "shipments", input.shipment_id, "Shipment", actor.organizationId);
      }
      const costEntryId = crypto.randomUUID();
      const result = await client.query(
        `
        INSERT INTO cost_entries (id, lot_id, shipment_id, category, amount, currency, notes, organization_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *;
        `,
        [
          costEntryId,
          input.lot_id ?? null,
          input.shipment_id ?? null,
          input.category,
          input.amount,
          input.currency,
          input.notes ?? null,
          actor.organizationId,
        ],
      );
      return result.rows[0];
    }, actor);
  }

  async getContractProfitability(contractId: string, actor: AuthContext): Promise<unknown> {
    const contractResult = await withActor(
      actor,
      "SELECT * FROM contracts WHERE id = $1 AND organization_id = $2",
      [contractId, actor.organizationId],
    );
    if (contractResult.rowCount === 0) {
      throw new ApiError(404, `Contract not found`);
    }
    const contract = contractResult.rows[0];

    const allocationResult = await withActor(
      actor,
      `
      SELECT
        a.allocated_kg,
        a.shipment_id,
        l.weight_total_kg,
        l.purchase_price_per_kg,
        l.auction_fees_total,
        l.additional_cost_total
      FROM allocations a
      JOIN lots l ON l.id = a.lot_id
      WHERE a.contract_id = $1 AND a.status = 'shipped' AND a.organization_id = $2;
      `,
      [contractId, actor.organizationId],
    );

    let shippedKg = 0;
    let cogs = 0;
    const shipmentIds = new Set<string>();
    for (const row of allocationResult.rows) {
      const allocatedKg = toNumber(row.allocated_kg);
      const totalWeight = toNumber(row.weight_total_kg);
      const base = toNumber(row.purchase_price_per_kg);
      const additionalPerKg =
        totalWeight > 0
          ? (toNumber(row.auction_fees_total) + toNumber(row.additional_cost_total)) / totalWeight
          : 0;
      shippedKg += allocatedKg;
      cogs += allocatedKg * (base + additionalPerKg);
      if (row.shipment_id) {
        shipmentIds.add(String(row.shipment_id));
      }
    }

    let shipmentCost = 0;
    if (shipmentIds.size > 0) {
      const shipmentCostResult = await withActor(
        actor,
        "SELECT COALESCE(SUM(amount), 0) AS total FROM cost_entries WHERE shipment_id = ANY($1::uuid[]) AND organization_id = $2",
        [Array.from(shipmentIds), actor.organizationId],
      );
      shipmentCost = toNumber(shipmentCostResult.rows[0].total);
    }

    const revenue = shippedKg * toNumber(contract.price_per_kg);
    const totalCost = cogs + shipmentCost;
    const margin = revenue - totalCost;
    const marginPercent = revenue > 0 ? (margin / revenue) * 100 : 0;

    return {
      contract_id: contract.id,
      contract_number: contract.contract_number,
      shipped_kg: Number(shippedKg.toFixed(3)),
      revenue: Number(revenue.toFixed(2)),
      cost_of_goods: Number(cogs.toFixed(2)),
      shipment_cost: Number(shipmentCost.toFixed(2)),
      total_cost: Number(totalCost.toFixed(2)),
      margin: Number(margin.toFixed(2)),
      margin_percent: Number(marginPercent.toFixed(2)),
    };
  }

  async getReferenceData(actor: AuthContext): Promise<unknown> {
    const [contractsResult, lotsResult, shipmentsResult] = await Promise.all([
      withActor(
        actor,
        `
        SELECT id, contract_number, status
        FROM contracts
        WHERE organization_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 500
        `,
        [actor.organizationId],
      ),
      withActor(
        actor,
        `
        SELECT id, lot_code, source, status
        FROM lots
        WHERE organization_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 1000
        `,
        [actor.organizationId],
      ),
      withActor(
        actor,
        `
        SELECT id, shipment_number, status
        FROM shipments
        WHERE organization_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 500
        `,
        [actor.organizationId],
      ),
    ]);

    return {
      contracts: contractsResult.rows,
      lots: lotsResult.rows,
      shipments: shipmentsResult.rows,
    };
  }
}

export const financeService = new FinanceService();
