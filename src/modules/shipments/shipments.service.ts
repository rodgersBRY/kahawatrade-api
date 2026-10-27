import crypto from "node:crypto";

import { ApiError } from "../../common/errors/ApiError.js";
import {
  EPSILON,
  SHIPMENT_PROGRESSION,
  nextContractStatus,
  refreshLotStatus,
  toNumber,
} from "../../common/dbHelpers.js";
import {
  ListQueryParams,
  buildPaginatedResult,
  escapeLikeQuery,
} from "../../common/pagination.js";
import { withActor, withTransaction } from "../../db/pool.js";
import { AuthContext } from "../../types/auth.js";
import {
  DocsGenerateInput,
  ShipmentCreateInput,
  ShipmentStatusInput,
} from "./shipments.validation.js";
import { notificationsService } from "../notifications/notifications.service.js";

export class ShipmentsService {
  async createShipment(input: ShipmentCreateInput, actor: AuthContext): Promise<unknown> {
    const created = await withTransaction(async (client) => {
      const contractResult = await client.query(
        "SELECT * FROM contracts WHERE id = $1 AND organization_id = $2 FOR UPDATE",
        [input.contract_id, actor.organizationId],
      );
      if (contractResult.rowCount === 0) {
        throw new ApiError(404, `Contract not found`);
      }
      const contract = contractResult.rows[0];

      const shipmentId = crypto.randomUUID();
      const shipmentResult = await client.query(
        `
        INSERT INTO shipments (
          id, shipment_number, contract_id, status, container_number, seal_number, planned_departure, organization_id
        )
        VALUES ($1, $2, $3, 'planned', $4, $5, $6::date, $7)
        RETURNING *;
        `,
        [
          shipmentId,
          input.shipment_number,
          input.contract_id,
          input.container_number ?? null,
          input.seal_number ?? null,
          input.planned_departure ?? null,
          actor.organizationId,
        ],
      );
      const createdShipment = shipmentResult.rows[0];

      const uniqueAllocationIds = Array.from(new Set(input.allocation_ids));
      const allocationResult = await client.query(
        `
        SELECT * FROM allocations
        WHERE id = ANY($1::uuid[]) AND organization_id = $2
        FOR UPDATE;
        `,
        [uniqueAllocationIds, actor.organizationId],
      );
      if (allocationResult.rowCount !== uniqueAllocationIds.length) {
        throw new ApiError(404, "One or more allocations do not exist");
      }

      let shipmentKg = 0;
      for (const allocation of allocationResult.rows) {
        if (String(allocation.contract_id) !== input.contract_id) {
          throw new ApiError(
            409,
            `Allocation ${allocation.id} belongs to contract ${allocation.contract_id}, not ${input.contract_id}`,
          );
        }
        if (String(allocation.status) !== "allocated") {
          throw new ApiError(409, `Allocation ${allocation.id} is not available for shipment`);
        }
        shipmentKg += toNumber(allocation.allocated_kg);
      }

      const newShipped = toNumber(contract.shipped_kg) + shipmentKg;
      if (newShipped - toNumber(contract.quantity_kg) > EPSILON) {
        throw new ApiError(409, "Shipment would over-fulfill contract");
      }

      await client.query(
        `
        UPDATE allocations
        SET status = 'shipped', shipment_id = $1
        WHERE id = ANY($2::uuid[]) AND organization_id = $3;
        `,
        [createdShipment.id, uniqueAllocationIds, actor.organizationId],
      );

      const contractStatus = nextContractStatus(
        newShipped,
        toNumber(contract.quantity_kg),
        String(contract.status),
      );
      await client.query(
        "UPDATE contracts SET shipped_kg = $1, status = $2 WHERE id = $3 AND organization_id = $4",
        [newShipped, contractStatus, input.contract_id, actor.organizationId],
      );

      const lotsForSnapshotResult = await client.query(
        `
        SELECT
          a.id AS allocation_id,
          a.allocated_kg,
          l.id AS lot_id,
          l.lot_code,
          l.source,
          l.supplier_id,
          l.grade_id
        FROM allocations a
        JOIN lots l ON l.id = a.lot_id
        WHERE a.id = ANY($1::uuid[]) AND a.organization_id = $2
        ORDER BY a.id;
        `,
        [uniqueAllocationIds, actor.organizationId],
      );

      const touchedLots = new Set<string>();
      for (const row of lotsForSnapshotResult.rows) {
        const lotId = String(row.lot_id);
        if (!touchedLots.has(lotId)) {
          touchedLots.add(lotId);
          await refreshLotStatus(client, lotId, actor.organizationId);
        }
      }

      const traceabilitySnapshot = {
        contract_id: input.contract_id,
        contract_number: contract.contract_number,
        shipment_number: input.shipment_number,
        created_on: new Date().toISOString().slice(0, 10),
        lots: lotsForSnapshotResult.rows.map((row: Record<string, unknown>) => ({
          allocation_id: row.allocation_id,
          lot_id: row.lot_id,
          lot_code: row.lot_code,
          source: row.source,
          supplier_id: row.supplier_id,
          grade_id: row.grade_id,
          allocated_kg: toNumber(row.allocated_kg),
        })),
      };

      await client.query(
        "UPDATE shipments SET traceability_snapshot = $1::jsonb WHERE id = $2 AND organization_id = $3",
        [JSON.stringify(traceabilitySnapshot), createdShipment.id, actor.organizationId],
      );

      const finalShipment = await client.query(
        "SELECT * FROM shipments WHERE id = $1 AND organization_id = $2",
        [createdShipment.id, actor.organizationId],
      );
      const lotCodes = Array.from(
        new Set(
          lotsForSnapshotResult.rows
            .map((row: Record<string, unknown>) => String(row.lot_code ?? ""))
            .filter((value) => value.length > 0),
        ),
      );

      return {
        shipment: finalShipment.rows[0],
        contractNumber: String(contract.contract_number),
        lotCodes,
      };
    }, actor);

    await notificationsService.notifyShipmentCreated({
      shipmentNumber: String(created.shipment.shipment_number),
      contractNumber: created.contractNumber,
      lotCodes: created.lotCodes,
      organizationId: actor.organizationId,
    });

    return created.shipment;
  }

  async updateStatus(
    shipmentId: string,
    input: ShipmentStatusInput,
    actor: AuthContext,
  ): Promise<unknown> {
    const updated = await withTransaction(async (client) => {
      const shipmentResult = await client.query(
        "SELECT * FROM shipments WHERE id = $1 AND organization_id = $2 FOR UPDATE",
        [shipmentId, actor.organizationId],
      );
      if (shipmentResult.rowCount === 0) {
        throw new ApiError(404, `Shipment not found`);
      }
      const shipment = shipmentResult.rows[0];
      const currentIndex = SHIPMENT_PROGRESSION.indexOf(String(shipment.status));
      const targetIndex = SHIPMENT_PROGRESSION.indexOf(input.status);
      if (targetIndex < currentIndex) {
        throw new ApiError(409, "Shipment status cannot move backwards");
      }

      const result = await client.query(
        `
        UPDATE shipments
        SET status = $1, actual_departure = COALESCE($2::date, actual_departure)
        WHERE id = $3 AND organization_id = $4
        RETURNING *;
        `,
        [input.status, input.actual_departure ?? null, shipmentId, actor.organizationId],
      );
      const updatedShipment = result.rows[0];

      const contractResult = await client.query(
        "SELECT contract_number FROM contracts WHERE id = $1 AND organization_id = $2",
        [updatedShipment.contract_id, actor.organizationId],
      );

      return {
        shipment: updatedShipment,
        contractNumber:
          (contractResult.rowCount ?? 0) > 0
            ? String(contractResult.rows[0].contract_number)
            : String(updatedShipment.contract_id),
      };
    }, actor);

    await notificationsService.notifyShipmentStatusChanged({
      shipmentNumber: String(updated.shipment.shipment_number),
      contractNumber: updated.contractNumber,
      newStatus: input.status,
      actualDeparture: updated.shipment.actual_departure
        ? String(updated.shipment.actual_departure)
        : null,
      organizationId: actor.organizationId,
    });

    return updated.shipment;
  }

  async generateDocuments(shipmentId: string, input: DocsGenerateInput, actor: AuthContext): Promise<unknown[]> {
    const generated = await withTransaction(async (client) => {
      const shipmentResult = await client.query(
        "SELECT * FROM shipments WHERE id = $1 AND organization_id = $2",
        [shipmentId, actor.organizationId],
      );
      if (shipmentResult.rowCount === 0) {
        throw new ApiError(404, `Shipment not found`);
      }
      const shipment = shipmentResult.rows[0];

      const contractResult = await client.query(
        "SELECT * FROM contracts WHERE id = $1 AND organization_id = $2",
        [shipment.contract_id, actor.organizationId],
      );
      const contract = contractResult.rows[0];
      const buyerResult = await client.query(
        "SELECT * FROM buyers WHERE id = $1 AND organization_id = $2",
        [contract.buyer_id, actor.organizationId],
      );
      const buyer = buyerResult.rows[0];

      const allocationResult = await client.query(
        "SELECT * FROM allocations WHERE shipment_id = $1 AND organization_id = $2 ORDER BY id",
        [shipmentId, actor.organizationId],
      );
      if (allocationResult.rowCount === 0) {
        throw new ApiError(409, "No shipped allocations found for this shipment");
      }
      const allocations = allocationResult.rows;

      const createdDocs = [];
      for (const docType of input.doc_types) {
        let payload: Record<string, unknown>;
        if (docType === "commercial_invoice") {
          const totalWeight = allocations.reduce(
            (sum: number, alloc: Record<string, unknown>) =>
              sum + toNumber(alloc.allocated_kg),
            0,
          );
          payload = {
            shipment_number: shipment.shipment_number,
            contract_number: contract.contract_number,
            buyer: buyer.name,
            currency: contract.currency,
            price_per_kg: toNumber(contract.price_per_kg),
            total_weight_kg: Number(totalWeight.toFixed(3)),
            invoice_value: Number((totalWeight * toNumber(contract.price_per_kg)).toFixed(2)),
          };
        } else if (docType === "packing_list") {
          payload = {
            shipment_number: shipment.shipment_number,
            items: allocations.map((alloc: Record<string, unknown>) => ({
              allocation_id: alloc.id,
              lot_id: alloc.lot_id,
              weight_kg: toNumber(alloc.allocated_kg),
            })),
          };
        } else if (docType === "traceability_report") {
          payload = shipment.traceability_snapshot;
        } else {
          const lotCostResult = await client.query(
            `
            SELECT
              a.allocated_kg,
              l.weight_total_kg,
              l.purchase_price_per_kg,
              l.auction_fees_total,
              l.additional_cost_total
            FROM allocations a
            JOIN lots l ON l.id = a.lot_id
            WHERE a.shipment_id = $1 AND a.organization_id = $2;
            `,
            [shipmentId, actor.organizationId],
          );
          let totalLotCost = 0;
          for (const row of lotCostResult.rows) {
            const allocatedKg = toNumber(row.allocated_kg);
            const totalWeight = toNumber(row.weight_total_kg);
            const baseCost = toNumber(row.purchase_price_per_kg);
            const additionalPerKg =
              totalWeight > 0
                ? (toNumber(row.auction_fees_total) + toNumber(row.additional_cost_total)) / totalWeight
                : 0;
            totalLotCost += allocatedKg * (baseCost + additionalPerKg);
          }

          const shipmentCostResult = await client.query(
            "SELECT COALESCE(SUM(amount), 0) AS total FROM cost_entries WHERE shipment_id = $1 AND organization_id = $2",
            [shipmentId, actor.organizationId],
          );
          const shipmentCost = toNumber(shipmentCostResult.rows[0].total);
          payload = {
            shipment_number: shipment.shipment_number,
            lot_cost: Number(totalLotCost.toFixed(2)),
            shipment_cost: Number(shipmentCost.toFixed(2)),
            total_cost: Number((totalLotCost + shipmentCost).toFixed(2)),
          };
        }

        const documentId = crypto.randomUUID();
        const insertResult = await client.query(
          `
          INSERT INTO shipment_documents (id, shipment_id, document_type, payload, organization_id)
          VALUES ($1, $2, $3, $4::jsonb, $5)
          RETURNING *;
          `,
          [documentId, shipmentId, docType, JSON.stringify(payload), actor.organizationId],
        );
        createdDocs.push(insertResult.rows[0]);
      }
      return {
        documents: createdDocs,
        shipmentNumber: String(shipment.shipment_number),
        contractNumber: String(contract.contract_number),
        buyerName: String(buyer.name),
        docTypes: input.doc_types,
      };
    }, actor);

    await notificationsService.notifyDocumentsReady({
      shipmentNumber: generated.shipmentNumber,
      contractNumber: generated.contractNumber,
      buyerName: generated.buyerName,
      docTypes: generated.docTypes,
      organizationId: actor.organizationId,
    });

    return generated.documents;
  }

  async listShipments(listQuery: ListQueryParams, actor: AuthContext): Promise<unknown> {
    const values: unknown[] = [actor.organizationId];
    const whereClauses = ["s.organization_id = $1"];
    if (listQuery.search) {
      values.push(`%${escapeLikeQuery(listQuery.search)}%`);
      whereClauses.push(
        `(s.shipment_number ILIKE $${values.length} ESCAPE '\\' OR c.contract_number ILIKE $${values.length} ESCAPE '\\')`,
      );
    }
    if (listQuery.filters.status) {
      values.push(listQuery.filters.status);
      whereClauses.push(`s.status = $${values.length}`);
    }
    const whereSql = `WHERE ${whereClauses.join(" AND ")}`;

    const countResult = await withActor<{ total: number }>(
      actor,
      `SELECT COUNT(*)::int AS total FROM shipments s JOIN contracts c ON c.id = s.contract_id ${whereSql}`,
      values,
    );
    values.push(listQuery.pageSize, listQuery.offset);
    const result = await withActor(
      actor,
      `
      SELECT
        s.id,
        s.shipment_number,
        s.contract_id,
        c.contract_number,
        s.status,
        s.container_number,
        s.seal_number,
        s.planned_departure,
        s.actual_departure,
        s.created_at
      FROM shipments s
      JOIN contracts c ON c.id = s.contract_id
      ${whereSql}
      ORDER BY s.${listQuery.sortBy} ${listQuery.sortOrder}
      LIMIT $${values.length - 1} OFFSET $${values.length}
      `,
      values,
    );
    return buildPaginatedResult(result.rows, Number(countResult.rows[0].total), listQuery);
  }

  async listDocuments(shipmentId: string, listQuery: ListQueryParams, actor: AuthContext): Promise<unknown> {
    const whereClauses = ["shipment_id = $1", "organization_id = $2"];
    const values: unknown[] = [shipmentId, actor.organizationId];

    if (listQuery.filters.document_type) {
      values.push(listQuery.filters.document_type);
      whereClauses.push(`document_type = $${values.length}`);
    }

    const whereSql = `WHERE ${whereClauses.join(" AND ")}`;
    const countResult = await withActor<{ total: number }>(
      actor,
      `SELECT COUNT(*)::int AS total FROM shipment_documents ${whereSql}`,
      values,
    );

    values.push(listQuery.pageSize, listQuery.offset);
    const result = await withActor(
      actor,
      `
      SELECT * FROM shipment_documents
      ${whereSql}
      ORDER BY ${listQuery.sortBy} ${listQuery.sortOrder}
      LIMIT $${values.length - 1} OFFSET $${values.length}
      `,
      values,
    );
    return buildPaginatedResult(result.rows, Number(countResult.rows[0].total), listQuery);
  }

  async getReferenceData(actor: AuthContext): Promise<unknown> {
    const [contractsResult, allocationsResult, shipmentsResult] = await Promise.all([
      withActor(
        actor,
        `
        SELECT id, contract_number, status, quantity_kg, allocated_kg, shipped_kg
        FROM contracts
        WHERE status IN ('open', 'partially_fulfilled') AND organization_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 500
        `,
        [actor.organizationId],
      ),
      withActor(
        actor,
        `
        SELECT
          a.id,
          a.contract_id,
          c.contract_number,
          a.lot_id,
          l.lot_code,
          a.allocated_kg,
          a.status
        FROM allocations a
        JOIN contracts c ON c.id = a.contract_id
        JOIN lots l ON l.id = a.lot_id
        WHERE a.status = 'allocated'
          AND a.shipment_id IS NULL
          AND a.organization_id = $1
        ORDER BY a.id DESC
        LIMIT 1000
        `,
        [actor.organizationId],
      ),
      withActor(
        actor,
        `
        SELECT
          s.id,
          s.shipment_number,
          s.status,
          s.contract_id,
          c.contract_number
        FROM shipments s
        JOIN contracts c ON c.id = s.contract_id
        WHERE s.organization_id = $1
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT 500
        `,
        [actor.organizationId],
      ),
    ]);

    return {
      contracts: contractsResult.rows,
      allocations: allocationsResult.rows,
      shipments: shipmentsResult.rows,
    };
  }
}

export const shipmentsService = new ShipmentsService();
