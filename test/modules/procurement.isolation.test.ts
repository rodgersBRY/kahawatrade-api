import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { getTestApp } from "../testApp.js";
import { authHeader, provisionOrgAndAdmin } from "../factories.js";

const app = getTestApp();

async function createSupplier(
  accessToken: string,
  type: "auction_agent" | "mill" | "farmer" | "other",
): Promise<string> {
  const res = await request(app)
    .post("/api/v1/master/suppliers")
    .set(authHeader(accessToken))
    .send({ name: `Supplier ${randomUUID()}`, type });
  return res.body.id as string;
}

async function createWarehouse(accessToken: string): Promise<string> {
  const res = await request(app)
    .post("/api/v1/master/warehouses")
    .set(authHeader(accessToken))
    .send({ name: `Warehouse ${randomUUID()}`, location: "Nairobi" });
  return res.body.id as string;
}

async function createBagType(accessToken: string): Promise<string> {
  const res = await request(app)
    .post("/api/v1/master/bag-types")
    .set(authHeader(accessToken))
    .send({ name: `Bag Type ${randomUUID()}`, weight_kg: 60 });
  return res.body.id as string;
}

async function createGrade(accessToken: string): Promise<string> {
  const res = await request(app)
    .post("/api/v1/master/grades")
    .set(authHeader(accessToken))
    .send({ code: `GR-${randomUUID().slice(0, 8)}`, description: "Test grade" });
  return res.body.id as string;
}

/**
 * The procurement module only exposes create + list endpoints (no
 * GET/PUT/DELETE by id - see src/modules/procurement/procurement.routes.ts),
 * so cross-org isolation here is proven entirely through the list endpoints:
 * an org's records must never surface in another org's paginated results.
 */
describe("procurement cross-org isolation", () => {
  it("hides one org's auction lots from another org's admin", async () => {
    const orgA = await provisionOrgAndAdmin();
    const orgB = await provisionOrgAndAdmin();

    const marketingAgentId = await createSupplier(orgA.accessToken, "auction_agent");
    const [gradeId, warehouseId, bagTypeId] = await Promise.all([
      createGrade(orgA.accessToken),
      createWarehouse(orgA.accessToken),
      createBagType(orgA.accessToken),
    ]);

    const createRes = await request(app)
      .post("/api/v1/procurement/auction-lots")
      .set(authHeader(orgA.accessToken))
      .send({
        lot_number: `AUC-${randomUUID()}`,
        sale_number: "SALE-01",
        outturn_number: "OT-1234",
        mark: "Test Factory",
        marketing_agent_id: marketingAgentId,
        grade_id: gradeId,
        warehouse_id: warehouseId,
        bag_type_id: bagTypeId,
        crop_year: "2025/2026",
        bags: 100,
        weight_total_kg: 6000,
        purchase_price_per_kg: 4.5,
      });
    expect(createRes.status).toBe(201);
    const lotId = createRes.body.id;

    const orgBList = await request(app)
      .get("/api/v1/procurement/auction-lots")
      .set(authHeader(orgB.accessToken));
    expect(orgBList.status).toBe(200);
    const orgBLotIds = orgBList.body.data.map((l: { id: string }) => l.id);
    expect(orgBLotIds).not.toContain(lotId);

    const orgAList = await request(app)
      .get("/api/v1/procurement/auction-lots")
      .set(authHeader(orgA.accessToken));
    const orgALotIds = orgAList.body.data.map((l: { id: string }) => l.id);
    expect(orgALotIds).toContain(lotId);
  });

  it("hides one org's direct agreements from another org's admin", async () => {
    const orgA = await provisionOrgAndAdmin();
    const orgB = await provisionOrgAndAdmin();

    const supplierId = await createSupplier(orgA.accessToken, "mill");
    const createRes = await request(app)
      .post("/api/v1/procurement/direct-agreements")
      .set(authHeader(orgA.accessToken))
      .send({
        supplier_id: supplierId,
        agreement_reference: `DA-${randomUUID()}`,
        agreed_price_per_kg: 3.75,
        crop_year: "2025/2026",
      });
    expect(createRes.status).toBe(201);
    const agreementId = createRes.body.id;

    const orgBList = await request(app)
      .get("/api/v1/procurement/direct-agreements")
      .set(authHeader(orgB.accessToken));
    expect(orgBList.status).toBe(200);
    const orgBAgreementIds = orgBList.body.data.map((a: { id: string }) => a.id);
    expect(orgBAgreementIds).not.toContain(agreementId);

    const orgAList = await request(app)
      .get("/api/v1/procurement/direct-agreements")
      .set(authHeader(orgA.accessToken));
    const orgAAgreementIds = orgAList.body.data.map((a: { id: string }) => a.id);
    expect(orgAAgreementIds).toContain(agreementId);
  });

  it("hides one org's direct deliveries from another org's admin", async () => {
    const orgA = await provisionOrgAndAdmin();
    const orgB = await provisionOrgAndAdmin();

    const supplierId = await createSupplier(orgA.accessToken, "mill");
    const [gradeId, warehouseId, bagTypeId] = await Promise.all([
      createGrade(orgA.accessToken),
      createWarehouse(orgA.accessToken),
      createBagType(orgA.accessToken),
    ]);
    const agreementRes = await request(app)
      .post("/api/v1/procurement/direct-agreements")
      .set(authHeader(orgA.accessToken))
      .send({
        supplier_id: supplierId,
        agreement_reference: `DA-${randomUUID()}`,
        agreed_price_per_kg: 3.75,
        crop_year: "2025/2026",
      });
    expect(agreementRes.status).toBe(201);

    const createRes = await request(app)
      .post("/api/v1/procurement/direct-deliveries")
      .set(authHeader(orgA.accessToken))
      .send({
        agreement_id: agreementRes.body.id,
        internal_lot_id: `INT-${randomUUID()}`,
        delivery_reference: `DEL-${randomUUID()}`,
        grade_id: gradeId,
        warehouse_id: warehouseId,
        bag_type_id: bagTypeId,
        bags: 50,
        weight_total_kg: 3000,
        moisture_percent: 11.5,
        screen_size: 15,
        defects_percent: 2.5,
      });
    expect(createRes.status).toBe(201);
    // The create endpoint returns the underlying lot row (id = lot id),
    // while the list endpoint returns the direct_deliveries row (id =
    // delivery id) - lot_code is the field common to both responses.
    const lotCode = createRes.body.lot_code;

    const orgBList = await request(app)
      .get("/api/v1/procurement/direct-deliveries")
      .set(authHeader(orgB.accessToken));
    expect(orgBList.status).toBe(200);
    const orgBLotCodes = orgBList.body.data.map((d: { lot_code: string }) => d.lot_code);
    expect(orgBLotCodes).not.toContain(lotCode);

    const orgAList = await request(app)
      .get("/api/v1/procurement/direct-deliveries")
      .set(authHeader(orgA.accessToken));
    const orgALotCodes = orgAList.body.data.map((d: { lot_code: string }) => d.lot_code);
    expect(orgALotCodes).toContain(lotCode);
  });

  it("does not leak org A's reference data into org B's reference-data response", async () => {
    const orgA = await provisionOrgAndAdmin();
    const orgB = await provisionOrgAndAdmin();

    const supplierId = await createSupplier(orgA.accessToken, "mill");

    const orgBReferenceData = await request(app)
      .get("/api/v1/procurement/reference-data")
      .set(authHeader(orgB.accessToken));

    expect(orgBReferenceData.status).toBe(200);
    const orgBSupplierIds = orgBReferenceData.body.suppliers.map((s: { id: string }) => s.id);
    expect(orgBSupplierIds).not.toContain(supplierId);
  });
});
