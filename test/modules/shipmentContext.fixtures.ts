import { randomUUID } from "node:crypto";
import request from "supertest";
import { getTestApp } from "../testApp.js";
import { authHeader } from "../factories.js";

const app = getTestApp();

export type ShippableContext = {
  supplierId: string;
  warehouseId: string;
  gradeId: string;
  bagTypeId: string;
  buyerId: string;
  lotId: string;
  contractId: string;
  allocationId: string;
  weightTotalKg: number;
  allocatedKg: number;
};

/**
 * Builds a full chain of prerequisite records (supplier, warehouse, grade,
 * bag type, auction lot, buyer, contract, allocation) via the real HTTP
 * endpoints, using the same access token throughout so everything lands in
 * one org. Shipments and finance tests both need this chain since a
 * shipment requires a contract + allocated lot, and finance cost
 * entries/profitability need a lot/shipment/contract to attach to.
 */
export async function buildShippableContext(
  accessToken: string,
  overrides: Partial<{ weightTotalKg: number; quantityKg: number; allocatedKg: number }> = {},
): Promise<ShippableContext> {
  const headers = authHeader(accessToken);
  const suffix = randomUUID();

  const supplierRes = await request(app)
    .post("/api/v1/master/suppliers")
    .set(headers)
    .send({ name: `Auction Agent ${suffix}`, type: "auction_agent" });
  if (supplierRes.status !== 201) {
    throw new Error(`fixture: create supplier failed: ${supplierRes.status} ${JSON.stringify(supplierRes.body)}`);
  }
  const supplierId: string = supplierRes.body.id;

  const warehouseRes = await request(app)
    .post("/api/v1/master/warehouses")
    .set(headers)
    .send({ name: `Warehouse ${suffix}` });
  if (warehouseRes.status !== 201) {
    throw new Error(`fixture: create warehouse failed: ${warehouseRes.status} ${JSON.stringify(warehouseRes.body)}`);
  }
  const warehouseId: string = warehouseRes.body.id;

  const gradesRes = await request(app).get("/api/v1/master/grades").set(headers);
  if (gradesRes.status !== 200 || !gradesRes.body.data?.length) {
    throw new Error(`fixture: no grades available: ${gradesRes.status} ${JSON.stringify(gradesRes.body)}`);
  }
  const gradeId: string = gradesRes.body.data[0].id;

  const bagTypesRes = await request(app).get("/api/v1/master/bag-types").set(headers);
  if (bagTypesRes.status !== 200 || !bagTypesRes.body.data?.length) {
    throw new Error(`fixture: no bag types available: ${bagTypesRes.status} ${JSON.stringify(bagTypesRes.body)}`);
  }
  const bagTypeId: string = bagTypesRes.body.data[0].id;
  const bagWeightKg = Number(bagTypesRes.body.data[0].weight_kg);

  const weightTotalKg = overrides.weightTotalKg ?? 1000;
  const lotRes = await request(app)
    .post("/api/v1/procurement/auction-lots")
    .set(headers)
    .send({
      lot_number: `LOT-${suffix}`,
      sale_number: "SALE-01",
      outturn_number: "OT-1234",
      mark: "Test Factory",
      marketing_agent_id: supplierId,
      grade_id: gradeId,
      warehouse_id: warehouseId,
      bag_type_id: bagTypeId,
      crop_year: "2026",
      bags: Math.floor(weightTotalKg / bagWeightKg),
      pocket_weight_kg: Number((weightTotalKg % bagWeightKg).toFixed(3)),
      weight_total_kg: weightTotalKg,
      purchase_price_per_kg: 5,
      auction_fees_total: 20,
    });
  if (lotRes.status !== 201) {
    throw new Error(`fixture: create auction lot failed: ${lotRes.status} ${JSON.stringify(lotRes.body)}`);
  }
  const lotId: string = lotRes.body.id;

  const buyerRes = await request(app)
    .post("/api/v1/master/buyers")
    .set(headers)
    .send({ name: `Buyer ${suffix}` });
  if (buyerRes.status !== 201) {
    throw new Error(`fixture: create buyer failed: ${buyerRes.status} ${JSON.stringify(buyerRes.body)}`);
  }
  const buyerId: string = buyerRes.body.id;

  const quantityKg = overrides.quantityKg ?? weightTotalKg;
  const contractRes = await request(app)
    .post("/api/v1/contracts")
    .set(headers)
    .send({
      contract_number: `CT-${suffix}`,
      buyer_id: buyerId,
      quantity_kg: quantityKg,
      price_per_kg: 8,
      price_terms: "fob",
      currency: "USD",
      shipment_window_start: "2026-01-01",
      shipment_window_end: "2026-12-31",
    });
  if (contractRes.status !== 201) {
    throw new Error(`fixture: create contract failed: ${contractRes.status} ${JSON.stringify(contractRes.body)}`);
  }
  const contractId: string = contractRes.body.id;

  const allocatedKg = overrides.allocatedKg ?? weightTotalKg;
  const allocationRes = await request(app)
    .post(`/api/v1/contracts/${contractId}/allocations`)
    .set(headers)
    .send({ lot_id: lotId, allocated_kg: allocatedKg });
  if (allocationRes.status !== 201) {
    throw new Error(`fixture: allocate lot failed: ${allocationRes.status} ${JSON.stringify(allocationRes.body)}`);
  }
  const allocationId: string = allocationRes.body.id;

  return {
    supplierId,
    warehouseId,
    gradeId,
    bagTypeId,
    buyerId,
    lotId,
    contractId,
    allocationId,
    weightTotalKg,
    allocatedKg,
  };
}

/**
 * Extends buildShippableContext by also creating the shipment itself, since
 * most shipments/finance tests need an existing shipment to act on (update
 * status, generate docs, attach cost entries, compute profitability).
 */
export async function buildShipmentContext(
  accessToken: string,
  overrides: Partial<{ weightTotalKg: number; quantityKg: number; allocatedKg: number }> = {},
): Promise<ShippableContext & { shipmentId: string; shipmentNumber: string }> {
  const ctx = await buildShippableContext(accessToken, overrides);
  const headers = authHeader(accessToken);
  const shipmentNumber = `SHP-${randomUUID()}`;

  const shipmentRes = await request(app)
    .post("/api/v1/shipments")
    .set(headers)
    .send({
      shipment_number: shipmentNumber,
      contract_id: ctx.contractId,
      allocation_ids: [ctx.allocationId],
    });
  if (shipmentRes.status !== 201) {
    throw new Error(`fixture: create shipment failed: ${shipmentRes.status} ${JSON.stringify(shipmentRes.body)}`);
  }

  return { ...ctx, shipmentId: shipmentRes.body.id, shipmentNumber };
}
