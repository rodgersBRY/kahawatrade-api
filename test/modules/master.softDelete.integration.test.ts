import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { withOrgContext } from "../../src/db/pool.js";
import { getTestApp } from "../testApp.js";
import { authHeader, provisionOrgAndAdmin } from "../factories.js";
import {
  createBagType,
  createBuyer,
  createDirectLot,
  createGrade,
  createSupplier,
  createWarehouse,
} from "./fixtures.js";

const app = getTestApp();

describe("master data soft delete", () => {
  it("deletes master data that existing lots use and keeps the lot's history", async () => {
    const org = await provisionOrgAndAdmin();
    const { lot, supplier, warehouse, grade, bagType } = await createDirectLot(org.accessToken);

    for (const path of [
      `/api/v1/master/suppliers/${supplier.id}`,
      `/api/v1/master/warehouses/${warehouse.id}`,
      `/api/v1/master/grades/${grade.id}`,
      `/api/v1/master/bag-types/${bagType.id}`,
    ]) {
      const res = await request(app).delete(path).set(authHeader(org.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.deleted_at).toEqual(expect.any(String));
    }

    const lotsRes = await request(app)
      .get("/api/v1/inventory/lots")
      .set(authHeader(org.accessToken));
    expect(lotsRes.status).toBe(200);
    const row = lotsRes.body.data.find((l: { id: string }) => l.id === lot.id);
    expect(row).toBeDefined();
    expect(row.supplier).toBe(supplier.name);
    expect(row.warehouse).toBe(warehouse.name);
    expect(row.grade).toBe(grade.code);
    expect(row.bag_type).toBe(bagType.name);
  });

  it("hides deleted rows from master lists and procurement reference data", async () => {
    const org = await provisionOrgAndAdmin();
    const warehouse = await createWarehouse(org.accessToken);

    await request(app)
      .delete(`/api/v1/master/warehouses/${warehouse.id}`)
      .set(authHeader(org.accessToken))
      .expect(200);

    const listRes = await request(app)
      .get("/api/v1/master/warehouses")
      .set(authHeader(org.accessToken));
    expect(listRes.body.data.map((w: { id: string }) => w.id)).not.toContain(warehouse.id);

    const refRes = await request(app)
      .get("/api/v1/procurement/reference-data")
      .set(authHeader(org.accessToken));
    expect(refRes.status).toBe(200);
    expect(refRes.body.warehouses.map((w: { id: string }) => w.id)).not.toContain(warehouse.id);
  });

  it("returns 404 when updating or deleting an already-deleted row", async () => {
    const org = await provisionOrgAndAdmin();
    const buyer = await createBuyer(org.accessToken);

    await request(app)
      .delete(`/api/v1/master/buyers/${buyer.id}`)
      .set(authHeader(org.accessToken))
      .expect(200);

    const secondDelete = await request(app)
      .delete(`/api/v1/master/buyers/${buyer.id}`)
      .set(authHeader(org.accessToken));
    expect(secondDelete.status).toBe(404);

    const updateRes = await request(app)
      .patch(`/api/v1/master/buyers/${buyer.id}`)
      .set(authHeader(org.accessToken))
      .send({ name: "Renamed", country: "US" });
    expect(updateRes.status).toBe(404);
  });

  it("rejects new records that point at deleted master data", async () => {
    const org = await provisionOrgAndAdmin();
    const [supplier, warehouse, grade, bagType, buyer] = await Promise.all([
      createSupplier(org.accessToken, "farmer"),
      createWarehouse(org.accessToken),
      createGrade(org.accessToken),
      createBagType(org.accessToken),
      createBuyer(org.accessToken),
    ]);

    const agreementRes = await request(app)
      .post("/api/v1/procurement/direct-agreements")
      .set(authHeader(org.accessToken))
      .send({
        supplier_id: supplier.id,
        agreement_reference: `AGR-${randomUUID()}`,
        agreed_price_per_kg: 4.5,
        crop_year: "2025",
      });
    expect(agreementRes.status).toBe(201);

    await request(app)
      .delete(`/api/v1/master/grades/${grade.id}`)
      .set(authHeader(org.accessToken))
      .expect(200);
    await request(app)
      .delete(`/api/v1/master/suppliers/${supplier.id}`)
      .set(authHeader(org.accessToken))
      .expect(200);
    await request(app)
      .delete(`/api/v1/master/buyers/${buyer.id}`)
      .set(authHeader(org.accessToken))
      .expect(200);

    const deliveryRes = await request(app)
      .post("/api/v1/procurement/direct-deliveries")
      .set(authHeader(org.accessToken))
      .send({
        agreement_id: agreementRes.body.id,
        internal_lot_id: `LOT-${randomUUID()}`,
        delivery_reference: `DEL-${randomUUID()}`,
        grade_id: grade.id,
        warehouse_id: warehouse.id,
        bag_type_id: bagType.id,
        bags: 10,
        weight_total_kg: 600,
        moisture_percent: 11.5,
        screen_size: 18,
        defects_percent: 2,
      });
    expect(deliveryRes.status).toBe(404);
    expect(deliveryRes.body.message).toBe("Grade not found");

    const newAgreementRes = await request(app)
      .post("/api/v1/procurement/direct-agreements")
      .set(authHeader(org.accessToken))
      .send({
        supplier_id: supplier.id,
        agreement_reference: `AGR-${randomUUID()}`,
        agreed_price_per_kg: 4.5,
        crop_year: "2025",
      });
    expect(newAgreementRes.status).toBe(404);

    const contractRes = await request(app)
      .post("/api/v1/contracts")
      .set(authHeader(org.accessToken))
      .send({
        contract_number: `CT-${randomUUID()}`,
        buyer_id: buyer.id,
        quantity_kg: 1000,
        price_per_kg: 4.5,
        price_terms: "fob",
        shipment_window_start: "2026-01-01",
        shipment_window_end: "2026-03-01",
      });
    expect(contractRes.status).toBe(404);
    expect(contractRes.body.message).toBe("Buyer not found");
  });

  it("keeps a contract's grade after the grade is deleted", async () => {
    const org = await provisionOrgAndAdmin();
    const [buyer, grade] = await Promise.all([
      createBuyer(org.accessToken),
      createGrade(org.accessToken),
    ]);

    const contractRes = await request(app)
      .post("/api/v1/contracts")
      .set(authHeader(org.accessToken))
      .send({
        contract_number: `CT-${randomUUID()}`,
        buyer_id: buyer.id,
        grade_id: grade.id,
        quantity_kg: 1000,
        price_per_kg: 4.5,
        price_terms: "fob",
        shipment_window_start: "2026-01-01",
        shipment_window_end: "2026-03-01",
      });
    expect(contractRes.status).toBe(201);

    await request(app)
      .delete(`/api/v1/master/grades/${grade.id}`)
      .set(authHeader(org.accessToken))
      .expect(200);

    const contract = await withOrgContext(org.organizationId, async (client) => {
      const res = await client.query("SELECT grade_id FROM contracts WHERE id = $1", [
        contractRes.body.id,
      ]);
      return res.rows[0];
    });
    expect(contract.grade_id).toBe(grade.id);
  });
});
