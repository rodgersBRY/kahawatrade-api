import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { getTestApp } from "../testApp.js";
import { authHeader, provisionOrgAndAdmin, uniqueEmail } from "../factories.js";
import {
  createAuctionLot,
  createBuyer,
  createDirectLot,
  createGrade,
  createWarehouse,
} from "./fixtures.js";
import { buildShipmentContext, buildShippableContext } from "./shipmentContext.fixtures.js";

const app = getTestApp();

async function loginAsRole(adminToken: string, role: string): Promise<string> {
  const email = uniqueEmail(role);
  const password = "AnotherSecurePassw0rd!";
  const registerRes = await request(app)
    .post("/api/v1/auth/register")
    .set(authHeader(adminToken))
    .send({ email, password, full_name: `${role} user`, role });
  expect(registerRes.status).toBe(201);
  const loginRes = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(loginRes.status).toBe(200);
  return loginRes.body.access_token;
}

async function history(token: string, entityType: string, entityId: string) {
  return request(app)
    .get("/api/v1/audit-logs")
    .query({ entity_type: entityType, entity_id: entityId })
    .set(authHeader(token));
}

describe("editing operations records", () => {
  describe("auction lots", () => {
    it("edits an unallocated lot and logs who changed what", async () => {
      const org = await provisionOrgAndAdmin();
      const { lot, grade } = await createAuctionLot(org.accessToken);
      const newGrade = await createGrade(org.accessToken);

      const res = await request(app)
        .patch(`/api/v1/procurement/auction-lots/${lot.id}`)
        .set(authHeader(org.accessToken))
        .send({ grade_id: newGrade.id, sale_number: "SALE-02" });
      expect(res.status).toBe(200);
      expect(res.body.grade_id).toBe(newGrade.id);

      const logRes = await history(org.accessToken, "lot", String(lot.id));
      expect(logRes.status).toBe(200);
      expect(logRes.body.data).toHaveLength(1);
      const entry = logRes.body.data[0];
      expect(entry.action).toBe("update");
      expect(entry.changed_by_email).toBe(org.email);
      expect(entry.actor_role).toBe("admin");
      expect(entry.changes.grade_id).toEqual({ from: grade.id, to: newGrade.id });
      expect(entry.changes.sale_number).toEqual({ from: "SALE-01", to: "SALE-02" });
    });

    it("writes no log entry when nothing changes", async () => {
      const org = await provisionOrgAndAdmin();
      const { lot, grade } = await createAuctionLot(org.accessToken);

      const res = await request(app)
        .patch(`/api/v1/procurement/auction-lots/${lot.id}`)
        .set(authHeader(org.accessToken))
        .send({ grade_id: grade.id, purchase_price_per_kg: 5 });
      expect(res.status).toBe(200);

      const logRes = await history(org.accessToken, "lot", String(lot.id));
      expect(logRes.body.data).toHaveLength(0);
    });

    it("rejects weight changes, which go through stock adjustments", async () => {
      const org = await provisionOrgAndAdmin();
      const { lot } = await createAuctionLot(org.accessToken);

      const res = await request(app)
        .patch(`/api/v1/procurement/auction-lots/${lot.id}`)
        .set(authHeader(org.accessToken))
        .send({ weight_total_kg: 500 });
      expect(res.status).toBe(400);
    });

    it("locks identity fields once allocated but still allows warehouse and price", async () => {
      const org = await provisionOrgAndAdmin();
      const ctx = await buildShippableContext(org.accessToken);
      const [newGrade, newWarehouse] = await Promise.all([
        createGrade(org.accessToken),
        createWarehouse(org.accessToken),
      ]);

      const gradeRes = await request(app)
        .patch(`/api/v1/procurement/auction-lots/${ctx.lotId}`)
        .set(authHeader(org.accessToken))
        .send({ grade_id: newGrade.id });
      expect(gradeRes.status).toBe(409);
      expect(gradeRes.body.message).toBe("Can't change grade after the lot is allocated to a contract");

      // Unchanged locked fields sent alongside a real change are fine.
      const okRes = await request(app)
        .patch(`/api/v1/procurement/auction-lots/${ctx.lotId}`)
        .set(authHeader(org.accessToken))
        .send({ grade_id: ctx.gradeId, warehouse_id: newWarehouse.id, purchase_price_per_kg: 6 });
      expect(okRes.status).toBe(200);
      expect(okRes.body.warehouse_id).toBe(newWarehouse.id);
    });

    it("locks everything once the lot has shipped", async () => {
      const org = await provisionOrgAndAdmin();
      const ctx = await buildShipmentContext(org.accessToken);

      const res = await request(app)
        .patch(`/api/v1/procurement/auction-lots/${ctx.lotId}`)
        .set(authHeader(org.accessToken))
        .send({ purchase_price_per_kg: 9 });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe("Can't change purchase price per kg after the lot is shipped");
    });

    it("blocks roles without procurement access", async () => {
      const org = await provisionOrgAndAdmin();
      const { lot } = await createAuctionLot(org.accessToken);
      const warehouseToken = await loginAsRole(org.accessToken, "warehouse");

      const res = await request(app)
        .patch(`/api/v1/procurement/auction-lots/${lot.id}`)
        .set(authHeader(warehouseToken))
        .send({ mark: "Other" });
      expect(res.status).toBe(403);
    });
  });

  describe("direct deliveries and agreements", () => {
    it("edits delivery quality and locks agreement pricing after a delivery", async () => {
      const org = await provisionOrgAndAdmin();
      const { lot, agreementId } = await createDirectLot(org.accessToken);

      const deliveriesRes = await request(app)
        .get("/api/v1/procurement/direct-deliveries")
        .set(authHeader(org.accessToken));
      const delivery = deliveriesRes.body.data.find(
        (row: { lot_id: string }) => row.lot_id === lot.id,
      );
      expect(delivery).toBeDefined();

      const deliveryRes = await request(app)
        .patch(`/api/v1/procurement/direct-deliveries/${delivery.id}`)
        .set(authHeader(org.accessToken))
        .send({ moisture_percent: 10.5, delivery_reference: "DEL-FIXED" });
      expect(deliveryRes.status).toBe(200);
      expect(Number(deliveryRes.body.moisture_percent)).toBe(10.5);
      expect(deliveryRes.body.delivery_reference).toBe("DEL-FIXED");

      const priceRes = await request(app)
        .patch(`/api/v1/procurement/direct-agreements/${agreementId}`)
        .set(authHeader(org.accessToken))
        .send({ agreed_price_per_kg: 9 });
      expect(priceRes.status).toBe(409);

      const referenceRes = await request(app)
        .patch(`/api/v1/procurement/direct-agreements/${agreementId}`)
        .set(authHeader(org.accessToken))
        .send({ agreement_reference: "AGR-RENAMED" });
      expect(referenceRes.status).toBe(200);
      expect(referenceRes.body.agreement_reference).toBe("AGR-RENAMED");
    });
  });

  describe("contracts", () => {
    async function createContract(token: string, overrides: Record<string, unknown> = {}) {
      const buyer = await createBuyer(token);
      const res = await request(app)
        .post("/api/v1/contracts")
        .set(authHeader(token))
        .send({
          contract_number: `CT-${randomUUID()}`,
          buyer_id: buyer.id,
          quantity_kg: 1000,
          price_per_kg: 4.5,
          price_terms: "fob",
          shipment_window_start: "2026-01-01",
          shipment_window_end: "2026-03-01",
          ...overrides,
        });
      expect(res.status).toBe(201);
      return res.body;
    }

    it("edits an open contract and lists it", async () => {
      const org = await provisionOrgAndAdmin();
      const contract = await createContract(org.accessToken);

      const res = await request(app)
        .patch(`/api/v1/contracts/${contract.id}`)
        .set(authHeader(org.accessToken))
        .send({ price_per_kg: 5, shipment_window_end: "2026-04-01" });
      expect(res.status).toBe(200);
      expect(Number(res.body.price_per_kg)).toBe(5);

      const listRes = await request(app).get("/api/v1/contracts").set(authHeader(org.accessToken));
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.map((c: { id: string }) => c.id)).toContain(contract.id);

      const logRes = await history(org.accessToken, "contract", contract.id);
      expect(Object.keys(logRes.body.data[0].changes).sort()).toEqual([
        "price_per_kg",
        "shipment_window_end",
      ]);
    });

    it("rejects a shipment window that ends before it starts", async () => {
      const org = await provisionOrgAndAdmin();
      const contract = await createContract(org.accessToken);

      const res = await request(app)
        .patch(`/api/v1/contracts/${contract.id}`)
        .set(authHeader(org.accessToken))
        .send({ shipment_window_end: "2025-12-01" });
      expect(res.status).toBe(400);
    });

    it("keeps quantity at or above what's allocated and locks grade once allocated", async () => {
      const org = await provisionOrgAndAdmin();
      const ctx = await buildShippableContext(org.accessToken);
      const grade = await createGrade(org.accessToken);

      const quantityRes = await request(app)
        .patch(`/api/v1/contracts/${ctx.contractId}`)
        .set(authHeader(org.accessToken))
        .send({ quantity_kg: ctx.allocatedKg - 1 });
      expect(quantityRes.status).toBe(409);

      const gradeRes = await request(app)
        .patch(`/api/v1/contracts/${ctx.contractId}`)
        .set(authHeader(org.accessToken))
        .send({ grade_id: grade.id });
      expect(gradeRes.status).toBe(409);
    });

    it("locks price and buyer once the contract has shipments", async () => {
      const org = await provisionOrgAndAdmin();
      const ctx = await buildShipmentContext(org.accessToken);

      const res = await request(app)
        .patch(`/api/v1/contracts/${ctx.contractId}`)
        .set(authHeader(org.accessToken))
        .send({ price_per_kg: 99 });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe("Can't change price per kg after the contract has shipments");
    });
  });

  describe("allocation cancel", () => {
    it("returns the kg to the lot and contract and logs the cancel", async () => {
      const org = await provisionOrgAndAdmin();
      const ctx = await buildShippableContext(org.accessToken);

      const listRes = await request(app)
        .get(`/api/v1/contracts/${ctx.contractId}/allocations`)
        .set(authHeader(org.accessToken));
      expect(listRes.status).toBe(200);
      expect(listRes.body.data[0].id).toBe(ctx.allocationId);

      const cancelRes = await request(app)
        .post(`/api/v1/contracts/${ctx.contractId}/allocations/${ctx.allocationId}/cancel`)
        .set(authHeader(org.accessToken));
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.status).toBe("cancelled");

      const contractsRes = await request(app)
        .get("/api/v1/contracts")
        .set(authHeader(org.accessToken));
      const contract = contractsRes.body.data.find((c: { id: string }) => c.id === ctx.contractId);
      expect(Number(contract.allocated_kg)).toBe(0);

      const lotsRes = await request(app)
        .get("/api/v1/inventory/lots")
        .set(authHeader(org.accessToken));
      const lot = lotsRes.body.data.find((l: { id: string }) => l.id === ctx.lotId);
      expect(Number(lot.weight_available_kg)).toBe(ctx.weightTotalKg);
      expect(lot.status).toBe("in_stock");

      const again = await request(app)
        .post(`/api/v1/contracts/${ctx.contractId}/allocations/${ctx.allocationId}/cancel`)
        .set(authHeader(org.accessToken));
      expect(again.status).toBe(409);

      const logRes = await history(org.accessToken, "allocation", ctx.allocationId);
      expect(logRes.body.data[0].action).toBe("cancel");
      expect(logRes.body.data[0].changes.status).toEqual({ from: "allocated", to: "cancelled" });

      // With no live allocations the lot's grade is editable again.
      const grade = await createGrade(org.accessToken);
      const gradeRes = await request(app)
        .patch(`/api/v1/procurement/auction-lots/${ctx.lotId}`)
        .set(authHeader(org.accessToken))
        .send({ grade_id: grade.id });
      expect(gradeRes.status).toBe(200);
    });

    it("refuses to cancel a shipped allocation", async () => {
      const org = await provisionOrgAndAdmin();
      const ctx = await buildShipmentContext(org.accessToken);

      const res = await request(app)
        .post(`/api/v1/contracts/${ctx.contractId}/allocations/${ctx.allocationId}/cancel`)
        .set(authHeader(org.accessToken));
      expect(res.status).toBe(409);
    });
  });

  describe("shipments", () => {
    it("edits details while planned and locks the number once documents exist", async () => {
      const org = await provisionOrgAndAdmin();
      const ctx = await buildShipmentContext(org.accessToken);

      const listRes = await request(app).get("/api/v1/shipments").set(authHeader(org.accessToken));
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.map((s: { id: string }) => s.id)).toContain(ctx.shipmentId);

      const editRes = await request(app)
        .patch(`/api/v1/shipments/${ctx.shipmentId}`)
        .set(authHeader(org.accessToken))
        .send({ container_number: "MSKU1234567", shipment_number: `${ctx.shipmentNumber}-A` });
      expect(editRes.status).toBe(200);
      expect(editRes.body.container_number).toBe("MSKU1234567");
      expect(editRes.body.traceability_snapshot.shipment_number).toBe(`${ctx.shipmentNumber}-A`);

      await request(app)
        .post(`/api/v1/shipments/${ctx.shipmentId}/documents/generate`)
        .set(authHeader(org.accessToken))
        .send({ doc_types: ["packing_list"] })
        .expect(201);

      const numberRes = await request(app)
        .patch(`/api/v1/shipments/${ctx.shipmentId}`)
        .set(authHeader(org.accessToken))
        .send({ shipment_number: `${ctx.shipmentNumber}-B` });
      expect(numberRes.status).toBe(409);
    });

    it("locks container details once on the vessel", async () => {
      const org = await provisionOrgAndAdmin();
      const ctx = await buildShipmentContext(org.accessToken);

      await request(app)
        .patch(`/api/v1/shipments/${ctx.shipmentId}/status`)
        .set(authHeader(org.accessToken))
        .send({ status: "on_vessel" })
        .expect(200);

      const res = await request(app)
        .patch(`/api/v1/shipments/${ctx.shipmentId}`)
        .set(authHeader(org.accessToken))
        .send({ seal_number: "SEAL-9" });
      expect(res.status).toBe(409);
    });
  });

  describe("finance", () => {
    it("lets finance edit cost entries and lot pricing but not see contract history", async () => {
      const org = await provisionOrgAndAdmin();
      const { lot } = await createAuctionLot(org.accessToken);
      const financeToken = await loginAsRole(org.accessToken, "finance");

      const createRes = await request(app)
        .post("/api/v1/costs/entries")
        .set(authHeader(financeToken))
        .send({ lot_id: lot.id, category: "transport", amount: 100, currency: "USD" });
      expect(createRes.status).toBe(201);

      const listRes = await request(app).get("/api/v1/costs/entries").set(authHeader(financeToken));
      expect(listRes.body.data.map((e: { id: string }) => e.id)).toContain(createRes.body.id);

      const editRes = await request(app)
        .patch(`/api/v1/costs/entries/${createRes.body.id}`)
        .set(authHeader(financeToken))
        .send({ amount: 120, notes: "corrected invoice" });
      expect(editRes.status).toBe(200);
      expect(Number(editRes.body.amount)).toBe(120);

      const lotsRes = await request(app).get("/api/v1/costs/lots").set(authHeader(financeToken));
      expect(lotsRes.body.data.map((l: { id: string }) => l.id)).toContain(lot.id);

      const pricingRes = await request(app)
        .patch(`/api/v1/costs/lots/${lot.id}`)
        .set(authHeader(financeToken))
        .send({ auction_fees_total: 25 });
      expect(pricingRes.status).toBe(200);
      expect(Number(pricingRes.body.auction_fees_total)).toBe(25);

      const lotLog = await history(financeToken, "lot", String(lot.id));
      expect(lotLog.status).toBe(200);
      expect(lotLog.body.data[0].actor_role).toBe("finance");

      const contractLog = await history(financeToken, "contract", randomUUID());
      expect(contractLog.status).toBe(403);
    });
  });

  describe("master data", () => {
    it("logs updates and deletes", async () => {
      const org = await provisionOrgAndAdmin();
      const buyer = await createBuyer(org.accessToken, { name: "Old Name" });

      await request(app)
        .put(`/api/v1/master/buyers/${buyer.id}`)
        .set(authHeader(org.accessToken))
        .send({ name: "New Name", country: "US" })
        .expect(200);
      await request(app)
        .delete(`/api/v1/master/buyers/${buyer.id}`)
        .set(authHeader(org.accessToken))
        .expect(200);

      const logRes = await history(org.accessToken, "buyer", buyer.id);
      expect(logRes.body.data.map((e: { action: string }) => e.action)).toEqual(["delete", "update"]);
      expect(logRes.body.data[1].changes.name).toEqual({ from: "Old Name", to: "New Name" });
    });
  });
});
