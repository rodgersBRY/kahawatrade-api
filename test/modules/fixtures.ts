import { randomUUID } from "node:crypto";
import request from "supertest";
import { getTestApp } from "../testApp.js";
import { authHeader } from "../factories.js";

/**
 * Shared prerequisite-data builders for contracts and traceability
 * integration tests. Both modules operate on lots, which in turn require a
 * chain of master data (supplier, warehouse, bag type, grade) plus a
 * procurement record (direct delivery or auction lot) before a lot exists.
 * These helpers walk that chain through the real HTTP surface, using the
 * given actor's access token, so RLS/org scoping is exercised exactly as it
 * would be in production rather than being bypassed.
 */

const app = getTestApp();

export async function createBuyer(
  accessToken: string,
  overrides: Partial<{ name: string; country: string }> = {},
): Promise<{ id: string; name: string }> {
  const res = await request(app)
    .post("/api/v1/master/buyers")
    .set(authHeader(accessToken))
    .send({
      name: overrides.name ?? `Buyer ${randomUUID()}`,
      country: overrides.country ?? "US",
    });
  if (res.status !== 201) {
    throw new Error(`createBuyer failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

export async function createSupplier(
  accessToken: string,
  type: "auction_agent" | "mill" | "farmer" | "other" = "farmer",
): Promise<{ id: string; name: string }> {
  const res = await request(app)
    .post("/api/v1/master/suppliers")
    .set(authHeader(accessToken))
    .send({ name: `Supplier ${randomUUID()}`, type });
  if (res.status !== 201) {
    throw new Error(`createSupplier failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

export async function createWarehouse(accessToken: string): Promise<{ id: string; name: string }> {
  const res = await request(app)
    .post("/api/v1/master/warehouses")
    .set(authHeader(accessToken))
    .send({ name: `Warehouse ${randomUUID()}` });
  if (res.status !== 201) {
    throw new Error(`createWarehouse failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

export async function createGrade(accessToken: string): Promise<{ id: string; code: string }> {
  const res = await request(app)
    .post("/api/v1/master/grades")
    .set(authHeader(accessToken))
    .send({ code: `G-${randomUUID().slice(0, 8)}` });
  if (res.status !== 201) {
    throw new Error(`createGrade failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

export async function createBagType(accessToken: string): Promise<{ id: string; name: string }> {
  const res = await request(app)
    .post("/api/v1/master/bag-types")
    .set(authHeader(accessToken))
    .send({ name: `Bag ${randomUUID()}`, weight_kg: 60 });
  if (res.status !== 201) {
    throw new Error(`createBagType failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

/**
 * Creates a full chain of master data plus a direct-delivery lot
 * (source = 'direct'), and returns the resulting lot along with the
 * master-data records used to build it.
 */
export async function createDirectLot(
  accessToken: string,
  overrides: Partial<{ weight_total_kg: number; bags: number }> = {},
): Promise<{
  lot: Record<string, unknown>;
  supplier: { id: string; name: string };
  warehouse: { id: string; name: string };
  grade: { id: string; code: string };
  bagType: { id: string; name: string };
  agreementId: string;
}> {
  const [supplier, warehouse, grade, bagType] = await Promise.all([
    createSupplier(accessToken, "farmer"),
    createWarehouse(accessToken),
    createGrade(accessToken),
    createBagType(accessToken),
  ]);

  const agreementRes = await request(app)
    .post("/api/v1/procurement/direct-agreements")
    .set(authHeader(accessToken))
    .send({
      supplier_id: supplier.id,
      agreement_reference: `AGR-${randomUUID()}`,
      agreed_price_per_kg: 4.5,
      crop_year: "2025",
    });
  if (agreementRes.status !== 201) {
    throw new Error(
      `createDirectLot: direct-agreement failed: ${agreementRes.status} ${JSON.stringify(agreementRes.body)}`,
    );
  }
  const agreementId = agreementRes.body.id as string;

  const deliveryRes = await request(app)
    .post("/api/v1/procurement/direct-deliveries")
    .set(authHeader(accessToken))
    .send({
      agreement_id: agreementId,
      internal_lot_id: `LOT-${randomUUID()}`,
      delivery_reference: `DEL-${randomUUID()}`,
      grade_id: grade.id,
      warehouse_id: warehouse.id,
      bag_type_id: bagType.id,
      bags: overrides.bags ?? 10,
      weight_total_kg: overrides.weight_total_kg ?? 600,
      moisture_percent: 11.5,
      screen_size: 18,
      defects_percent: 2,
    });
  if (deliveryRes.status !== 201) {
    throw new Error(
      `createDirectLot: direct-delivery failed: ${deliveryRes.status} ${JSON.stringify(deliveryRes.body)}`,
    );
  }

  return { lot: deliveryRes.body, supplier, warehouse, grade, bagType, agreementId };
}

/**
 * Creates a full chain of master data plus an auction lot
 * (source = 'auction'), and returns the resulting lot along with the
 * master-data records used to build it.
 */
export async function createAuctionLot(
  accessToken: string,
  overrides: Partial<{ weight_total_kg: number; bags: number }> = {},
): Promise<{
  lot: Record<string, unknown>;
  marketingAgent: { id: string; name: string };
  warehouse: { id: string; name: string };
  grade: { id: string; code: string };
  bagType: { id: string; name: string };
}> {
  const [marketingAgent, warehouse, grade, bagType] = await Promise.all([
    createSupplier(accessToken, "auction_agent"),
    createWarehouse(accessToken),
    createGrade(accessToken),
    createBagType(accessToken),
  ]);

  const lotRes = await request(app)
    .post("/api/v1/procurement/auction-lots")
    .set(authHeader(accessToken))
    .send({
      lot_number: `AL-${randomUUID()}`,
      sale_number: "SALE-01",
      outturn_number: "OT-1234",
      mark: "Test Factory",
      marketing_agent_id: marketingAgent.id,
      grade_id: grade.id,
      warehouse_id: warehouse.id,
      bag_type_id: bagType.id,
      crop_year: "2025",
      bags: overrides.bags ?? 10,
      weight_total_kg: overrides.weight_total_kg ?? 600,
      purchase_price_per_kg: 5,
      auction_fees_total: 10,
    });
  if (lotRes.status !== 201) {
    throw new Error(`createAuctionLot failed: ${lotRes.status} ${JSON.stringify(lotRes.body)}`);
  }

  return { lot: lotRes.body, marketingAgent, warehouse, grade, bagType };
}
