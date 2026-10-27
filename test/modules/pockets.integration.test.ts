import request from "supertest";
import { expect, it } from "vitest";
import { getTestApp } from "../testApp.js";
import { authHeader, provisionOrgAndAdmin } from "../factories.js";
import { createAuctionLot, createDirectLot } from "./fixtures.js";

import { withActor } from "../../src/db/pool.js";

const app = getTestApp();

it("calculates auction pocket weight and preserves stock during normal lot edits", async () => {
  const org = await provisionOrgAndAdmin();
  const { lot } = await createAuctionLot(org.accessToken, { bags: 10, pocket_weight_kg: 25 });
  expect(Number(lot.weight_total_kg)).toBe(625);
  expect(Number(lot.weight_available_kg)).toBe(625);
  const path = `/api/v1/procurement/auction-lots/${lot.id}`;
  const invalid = await request(app).patch(path).set(authHeader(org.accessToken)).send({ bags: 9, pocket_weight_kg: 25 });
  expect(invalid.status).toBe(400);
  const valid = await request(app).patch(path).set(authHeader(org.accessToken)).send({ pocket_weight_kg: 25, mark: "Updated mark" });
  expect(valid.status).toBe(200);
  expect(Number(valid.body.weight_total_kg)).toBe(625);
  expect(Number(valid.body.weight_available_kg)).toBe(625);
});

it("supports pocket-only direct lots and rejects an inconsistent packaging edit", async () => {
  const org = await provisionOrgAndAdmin();
  const { lot } = await createDirectLot(org.accessToken, { bags: 0, pocket_weight_kg: 25 });
  expect(Number(lot.weight_total_kg)).toBe(25);
  const response = await request(app).get("/api/v1/procurement/direct-deliveries").set(authHeader(org.accessToken));
  const delivery = response.body.data.find((row: Record<string, unknown>) => row.lot_id === lot.id);
  const edited = await request(app).patch(`/api/v1/procurement/direct-deliveries/${delivery.id}`).set(authHeader(org.accessToken)).send({ pocket_weight_kg: 24 });
  expect(edited.status).toBe(400);
});

it("reallocates an existing lot to pockets through its normal edit without changing stock", async () => {
  const org = await provisionOrgAndAdmin();
  const { lot } = await createAuctionLot(org.accessToken);
  // Reproduce a pre-migration receipt, whose total was entered independently.
  const actor = { userId: org.userId, organizationId: org.organizationId, role: "admin" as const, authType: "jwt" as const };
  await withActor(actor, "UPDATE lots SET bags_total = 11, pocket_weight_kg = NULL, weight_total_kg = 625, weight_available_kg = 525 WHERE id = $1", [lot.id]);
  const result = await request(app).patch(`/api/v1/procurement/auction-lots/${lot.id}`).set(authHeader(org.accessToken)).send({ bags: 10, pocket_weight_kg: 25 });
  expect(result.status).toBe(200);
  expect(Number(result.body.bags_total)).toBe(10);
  expect(Number(result.body.pocket_weight_kg)).toBe(25);
  expect(Number(result.body.weight_total_kg)).toBe(625);
  expect(Number(result.body.weight_available_kg)).toBe(525);
  const log = await request(app).get("/api/v1/audit-logs").query({ entity_type: "lot", entity_id: lot.id }).set(authHeader(org.accessToken));
  expect(log.body.data[0].changes.pocket_weight_kg).toEqual({ from: null, to: 25 });
});
