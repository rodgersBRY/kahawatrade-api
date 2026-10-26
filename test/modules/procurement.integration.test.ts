import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { getTestApp } from "../testApp.js";
import { authHeader, provisionOrgAndAdmin, uniqueEmail } from "../factories.js";

const app = getTestApp();

/**
 * Creates a non-admin/trader user in the given org and returns their access
 * token, for exercising RBAC-forbidden paths against /api/v1/procurement
 * (which only allows admin or trader).
 */
async function createForbiddenRoleUser(
  adminAccessToken: string,
  role: "warehouse" | "finance" | "compliance" = "warehouse",
): Promise<string> {
  const email = uniqueEmail(role);
  const password = "AnotherSecurePassw0rd!";
  const registerRes = await request(app)
    .post("/api/v1/auth/register")
    .set(authHeader(adminAccessToken))
    .send({ email, password, full_name: "Forbidden User", role });
  if (registerRes.status !== 201) {
    throw new Error(
      `createForbiddenRoleUser register failed: ${registerRes.status} ${JSON.stringify(registerRes.body)}`,
    );
  }

  const loginRes = await request(app).post("/api/v1/auth/login").send({ email, password });
  if (loginRes.status !== 200) {
    throw new Error(
      `createForbiddenRoleUser login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`,
    );
  }
  return loginRes.body.access_token as string;
}

async function createSupplier(
  accessToken: string,
  type: "auction_agent" | "mill" | "farmer" | "other",
): Promise<string> {
  const res = await request(app)
    .post("/api/v1/master/suppliers")
    .set(authHeader(accessToken))
    .send({ name: `Supplier ${randomUUID()}`, type });
  if (res.status !== 201) {
    throw new Error(`createSupplier failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.id as string;
}

async function createWarehouse(accessToken: string): Promise<string> {
  const res = await request(app)
    .post("/api/v1/master/warehouses")
    .set(authHeader(accessToken))
    .send({ name: `Warehouse ${randomUUID()}`, location: "Nairobi" });
  if (res.status !== 201) {
    throw new Error(`createWarehouse failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.id as string;
}

async function createBagType(accessToken: string): Promise<string> {
  const res = await request(app)
    .post("/api/v1/master/bag-types")
    .set(authHeader(accessToken))
    .send({ name: `Bag Type ${randomUUID()}`, weight_kg: 60 });
  if (res.status !== 201) {
    throw new Error(`createBagType failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.id as string;
}

async function createGrade(accessToken: string): Promise<string> {
  const res = await request(app)
    .post("/api/v1/master/grades")
    .set(authHeader(accessToken))
    .send({ code: `GR-${randomUUID().slice(0, 8)}`, description: "Test grade" });
  if (res.status !== 201) {
    throw new Error(`createGrade failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.id as string;
}

type LotPrerequisites = {
  gradeId: string;
  warehouseId: string;
  bagTypeId: string;
};

async function createLotPrerequisites(accessToken: string): Promise<LotPrerequisites> {
  const [gradeId, warehouseId, bagTypeId] = await Promise.all([
    createGrade(accessToken),
    createWarehouse(accessToken),
    createBagType(accessToken),
  ]);
  return { gradeId, warehouseId, bagTypeId };
}

function validAuctionLotPayload(
  marketingAgentId: string,
  prereqs: LotPrerequisites,
): Record<string, unknown> {
  return {
    lot_number: `AUC-${randomUUID()}`,
    sale_number: "SALE-01",
    outturn_number: "OT-1234",
    mark: "Test Factory",
    marketing_agent_id: marketingAgentId,
    grade_id: prereqs.gradeId,
    warehouse_id: prereqs.warehouseId,
    bag_type_id: prereqs.bagTypeId,
    crop_year: "2025/2026",
    bags: 100,
    weight_total_kg: 6000,
    purchase_price_per_kg: 4.5,
    auction_fees_total: 50,
  };
}

function validDirectAgreementPayload(supplierId: string): Record<string, unknown> {
  return {
    supplier_id: supplierId,
    agreement_reference: `DA-${randomUUID()}`,
    agreed_price_per_kg: 3.75,
    currency: "USD",
    crop_year: "2025/2026",
  };
}

function validDirectDeliveryPayload(
  agreementId: string,
  prereqs: LotPrerequisites,
): Record<string, unknown> {
  return {
    agreement_id: agreementId,
    internal_lot_id: `INT-${randomUUID()}`,
    delivery_reference: `DEL-${randomUUID()}`,
    grade_id: prereqs.gradeId,
    warehouse_id: prereqs.warehouseId,
    bag_type_id: prereqs.bagTypeId,
    bags: 50,
    weight_total_kg: 3000,
    moisture_percent: 11.5,
    screen_size: 15,
    defects_percent: 2.5,
  };
}

describe("procurement integration", () => {
  describe("auction lots", () => {
    it("creates an auction lot on the happy path", async () => {
      const org = await provisionOrgAndAdmin();
      const marketingAgentId = await createSupplier(org.accessToken, "auction_agent");
      const prereqs = await createLotPrerequisites(org.accessToken);

      const res = await request(app)
        .post("/api/v1/procurement/auction-lots")
        .set(authHeader(org.accessToken))
        .send(validAuctionLotPayload(marketingAgentId, prereqs));

      expect(res.status).toBe(201);
      expect(res.body.id).toEqual(expect.any(String));
      expect(res.body.source).toBe("auction");
      expect(res.body.status).toBe("in_stock");
      expect(Number(res.body.bags_total)).toBe(100);
    });

    it("allows the same lot number in different sales", async () => {
      const org = await provisionOrgAndAdmin();
      const marketingAgentId = await createSupplier(org.accessToken, "auction_agent");
      const prereqs = await createLotPrerequisites(org.accessToken);
      const lotNumber = `AUC-${randomUUID()}`;

      for (const saleNumber of ["SALE-10", "SALE-11"]) {
        const res = await request(app)
          .post("/api/v1/procurement/auction-lots")
          .set(authHeader(org.accessToken))
          .send({
            ...validAuctionLotPayload(marketingAgentId, prereqs),
            lot_number: lotNumber,
            sale_number: saleNumber,
          });
        expect(res.status).toBe(201);
      }
    });

    it("rejects a duplicate lot number within the same sale", async () => {
      const org = await provisionOrgAndAdmin();
      const marketingAgentId = await createSupplier(org.accessToken, "auction_agent");
      const prereqs = await createLotPrerequisites(org.accessToken);
      const payload = {
        ...validAuctionLotPayload(marketingAgentId, prereqs),
        lot_number: `AUC-${randomUUID()}`,
        sale_number: "SALE-12",
      };

      const first = await request(app)
        .post("/api/v1/procurement/auction-lots")
        .set(authHeader(org.accessToken))
        .send(payload);
      expect(first.status).toBe(201);

      const second = await request(app)
        .post("/api/v1/procurement/auction-lots")
        .set(authHeader(org.accessToken))
        .send(payload);
      expect(second.status).toBe(409);
    });

    it("returns sale, outturn and mark in the auction lot list", async () => {
      const org = await provisionOrgAndAdmin();
      const marketingAgentId = await createSupplier(org.accessToken, "auction_agent");
      const prereqs = await createLotPrerequisites(org.accessToken);

      const createRes = await request(app)
        .post("/api/v1/procurement/auction-lots")
        .set(authHeader(org.accessToken))
        .send({
          ...validAuctionLotPayload(marketingAgentId, prereqs),
          sale_number: "SALE-13",
          outturn_number: "OT-9876",
          mark: "Gatomboya",
        });
      expect(createRes.status).toBe(201);

      const listRes = await request(app)
        .get("/api/v1/procurement/auction-lots")
        .query({ search: "OT-9876" })
        .set(authHeader(org.accessToken));
      expect(listRes.status).toBe(200);
      expect(listRes.body.data).toHaveLength(1);
      expect(listRes.body.data[0]).toMatchObject({
        sale_number: "SALE-13",
        outturn_number: "OT-9876",
        mark: "Gatomboya",
      });
    });

    it("rejects a payload missing required fields", async () => {
      const org = await provisionOrgAndAdmin();

      const res = await request(app)
        .post("/api/v1/procurement/auction-lots")
        .set(authHeader(org.accessToken))
        .send({ lot_number: "AUC-BAD" });

      expect(res.status).toBe(400);
      expect(res.body.issues).toBeDefined();
    });

    it("rejects a marketing_agent_id that is not an auction_agent supplier", async () => {
      const org = await provisionOrgAndAdmin();
      const nonAuctionSupplierId = await createSupplier(org.accessToken, "mill");
      const prereqs = await createLotPrerequisites(org.accessToken);

      const res = await request(app)
        .post("/api/v1/procurement/auction-lots")
        .set(authHeader(org.accessToken))
        .send(validAuctionLotPayload(nonAuctionSupplierId, prereqs));

      expect(res.status).toBe(400);
    });

    it("rejects a non-admin/trader role", async () => {
      const org = await provisionOrgAndAdmin();
      const marketingAgentId = await createSupplier(org.accessToken, "auction_agent");
      const prereqs = await createLotPrerequisites(org.accessToken);
      const forbiddenToken = await createForbiddenRoleUser(org.accessToken);

      const res = await request(app)
        .post("/api/v1/procurement/auction-lots")
        .set(authHeader(forbiddenToken))
        .send(validAuctionLotPayload(marketingAgentId, prereqs));

      expect(res.status).toBe(403);
    });

    it("lists auction lots including a newly created one", async () => {
      const org = await provisionOrgAndAdmin();
      const marketingAgentId = await createSupplier(org.accessToken, "auction_agent");
      const prereqs = await createLotPrerequisites(org.accessToken);

      const createRes = await request(app)
        .post("/api/v1/procurement/auction-lots")
        .set(authHeader(org.accessToken))
        .send(validAuctionLotPayload(marketingAgentId, prereqs));
      expect(createRes.status).toBe(201);

      const listRes = await request(app)
        .get("/api/v1/procurement/auction-lots")
        .set(authHeader(org.accessToken));

      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body.data)).toBe(true);
      const ids = listRes.body.data.map((row: { id: string }) => row.id);
      expect(ids).toContain(createRes.body.id);
    });
  });

  describe("direct agreements", () => {
    it("creates a direct agreement on the happy path", async () => {
      const org = await provisionOrgAndAdmin();
      const supplierId = await createSupplier(org.accessToken, "mill");

      const res = await request(app)
        .post("/api/v1/procurement/direct-agreements")
        .set(authHeader(org.accessToken))
        .send(validDirectAgreementPayload(supplierId));

      expect(res.status).toBe(201);
      expect(res.body.id).toEqual(expect.any(String));
      expect(res.body.supplier_id).toBe(supplierId);
    });

    it("rejects a payload missing required fields", async () => {
      const org = await provisionOrgAndAdmin();

      const res = await request(app)
        .post("/api/v1/procurement/direct-agreements")
        .set(authHeader(org.accessToken))
        .send({ agreement_reference: "DA-BAD" });

      expect(res.status).toBe(400);
      expect(res.body.issues).toBeDefined();
    });

    it("rejects a supplier_id that is an auction marketing agent", async () => {
      const org = await provisionOrgAndAdmin();
      const auctionAgentId = await createSupplier(org.accessToken, "auction_agent");

      const res = await request(app)
        .post("/api/v1/procurement/direct-agreements")
        .set(authHeader(org.accessToken))
        .send(validDirectAgreementPayload(auctionAgentId));

      expect(res.status).toBe(400);
    });

    it("rejects a non-admin/trader role", async () => {
      const org = await provisionOrgAndAdmin();
      const supplierId = await createSupplier(org.accessToken, "mill");
      const forbiddenToken = await createForbiddenRoleUser(org.accessToken);

      const res = await request(app)
        .post("/api/v1/procurement/direct-agreements")
        .set(authHeader(forbiddenToken))
        .send(validDirectAgreementPayload(supplierId));

      expect(res.status).toBe(403);
    });

    it("lists direct agreements including a newly created one", async () => {
      const org = await provisionOrgAndAdmin();
      const supplierId = await createSupplier(org.accessToken, "mill");

      const createRes = await request(app)
        .post("/api/v1/procurement/direct-agreements")
        .set(authHeader(org.accessToken))
        .send(validDirectAgreementPayload(supplierId));
      expect(createRes.status).toBe(201);

      const listRes = await request(app)
        .get("/api/v1/procurement/direct-agreements")
        .set(authHeader(org.accessToken));

      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body.data)).toBe(true);
      const ids = listRes.body.data.map((row: { id: string }) => row.id);
      expect(ids).toContain(createRes.body.id);
    });
  });

  describe("direct deliveries", () => {
    it("creates a direct delivery on the happy path", async () => {
      const org = await provisionOrgAndAdmin();
      const supplierId = await createSupplier(org.accessToken, "mill");
      const prereqs = await createLotPrerequisites(org.accessToken);
      const agreementRes = await request(app)
        .post("/api/v1/procurement/direct-agreements")
        .set(authHeader(org.accessToken))
        .send(validDirectAgreementPayload(supplierId));
      expect(agreementRes.status).toBe(201);

      const res = await request(app)
        .post("/api/v1/procurement/direct-deliveries")
        .set(authHeader(org.accessToken))
        .send(validDirectDeliveryPayload(agreementRes.body.id, prereqs));

      expect(res.status).toBe(201);
      expect(res.body.id).toEqual(expect.any(String));
      expect(res.body.source).toBe("direct");
      expect(res.body.status).toBe("in_stock");
    });

    it("rejects a duplicate internal_lot_id within the org", async () => {
      const org = await provisionOrgAndAdmin();
      const supplierId = await createSupplier(org.accessToken, "mill");
      const prereqs = await createLotPrerequisites(org.accessToken);
      const agreementRes = await request(app)
        .post("/api/v1/procurement/direct-agreements")
        .set(authHeader(org.accessToken))
        .send(validDirectAgreementPayload(supplierId));
      expect(agreementRes.status).toBe(201);
      const internalLotId = `INT-${randomUUID()}`;

      const first = await request(app)
        .post("/api/v1/procurement/direct-deliveries")
        .set(authHeader(org.accessToken))
        .send({ ...validDirectDeliveryPayload(agreementRes.body.id, prereqs), internal_lot_id: internalLotId });
      expect(first.status).toBe(201);

      const second = await request(app)
        .post("/api/v1/procurement/direct-deliveries")
        .set(authHeader(org.accessToken))
        .send({ ...validDirectDeliveryPayload(agreementRes.body.id, prereqs), internal_lot_id: internalLotId });
      expect(second.status).toBe(409);
    });

    it("rejects a payload missing required fields", async () => {
      const org = await provisionOrgAndAdmin();

      const res = await request(app)
        .post("/api/v1/procurement/direct-deliveries")
        .set(authHeader(org.accessToken))
        .send({ delivery_reference: "DEL-BAD" });

      expect(res.status).toBe(400);
      expect(res.body.issues).toBeDefined();
    });

    it("rejects an agreement_id that does not exist", async () => {
      const org = await provisionOrgAndAdmin();
      const prereqs = await createLotPrerequisites(org.accessToken);

      const res = await request(app)
        .post("/api/v1/procurement/direct-deliveries")
        .set(authHeader(org.accessToken))
        .send(validDirectDeliveryPayload(randomUUID(), prereqs));

      expect(res.status).toBe(404);
    });

    it("rejects a non-admin/trader role", async () => {
      const org = await provisionOrgAndAdmin();
      const supplierId = await createSupplier(org.accessToken, "mill");
      const prereqs = await createLotPrerequisites(org.accessToken);
      const agreementRes = await request(app)
        .post("/api/v1/procurement/direct-agreements")
        .set(authHeader(org.accessToken))
        .send(validDirectAgreementPayload(supplierId));
      const forbiddenToken = await createForbiddenRoleUser(org.accessToken);

      const res = await request(app)
        .post("/api/v1/procurement/direct-deliveries")
        .set(authHeader(forbiddenToken))
        .send(validDirectDeliveryPayload(agreementRes.body.id, prereqs));

      expect(res.status).toBe(403);
    });

    it("lists direct deliveries including a newly created one", async () => {
      const org = await provisionOrgAndAdmin();
      const supplierId = await createSupplier(org.accessToken, "mill");
      const prereqs = await createLotPrerequisites(org.accessToken);
      const agreementRes = await request(app)
        .post("/api/v1/procurement/direct-agreements")
        .set(authHeader(org.accessToken))
        .send(validDirectAgreementPayload(supplierId));

      const createRes = await request(app)
        .post("/api/v1/procurement/direct-deliveries")
        .set(authHeader(org.accessToken))
        .send(validDirectDeliveryPayload(agreementRes.body.id, prereqs));
      expect(createRes.status).toBe(201);

      const listRes = await request(app)
        .get("/api/v1/procurement/direct-deliveries")
        .set(authHeader(org.accessToken));

      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body.data)).toBe(true);
      // The create endpoint returns the underlying lot row (id = lot id),
      // while the list endpoint returns the direct_deliveries row (id =
      // delivery id) - lot_code is the field common to both responses.
      const lotCodes = listRes.body.data.map((row: { lot_code: string }) => row.lot_code);
      expect(lotCodes).toContain(createRes.body.lot_code);
    });
  });

  describe("reference-data", () => {
    it("returns option lists scoped to the caller's org", async () => {
      const org = await provisionOrgAndAdmin();
      const supplierId = await createSupplier(org.accessToken, "mill");
      const warehouseId = await createWarehouse(org.accessToken);

      const res = await request(app)
        .get("/api/v1/procurement/reference-data")
        .set(authHeader(org.accessToken));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.suppliers)).toBe(true);
      expect(Array.isArray(res.body.marketing_agents)).toBe(true);
      expect(Array.isArray(res.body.warehouses)).toBe(true);
      expect(Array.isArray(res.body.grades)).toBe(true);
      expect(Array.isArray(res.body.bag_types)).toBe(true);
      expect(Array.isArray(res.body.direct_agreements)).toBe(true);

      const supplierIds = res.body.suppliers.map((s: { id: string }) => s.id);
      expect(supplierIds).toContain(supplierId);
      const warehouseIds = res.body.warehouses.map((w: { id: string }) => w.id);
      expect(warehouseIds).toContain(warehouseId);
    });

    it("rejects an unauthenticated request", async () => {
      const res = await request(app).get("/api/v1/procurement/reference-data");
      expect(res.status).toBe(401);
    });
  });
});
