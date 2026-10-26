import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  auctionLotSchema,
  directAgreementSchema,
  directDeliverySchema,
} from "../../src/modules/procurement/procurement.validation.js";

const VALID_UUID_1 = randomUUID();
const VALID_UUID_2 = randomUUID();
const VALID_UUID_3 = randomUUID();
const VALID_UUID_4 = randomUUID();

describe("procurement.validation", () => {
  describe("auctionLotSchema", () => {
    const validPayload = {
      lot_number: "AUC-2026-001",
      sale_number: "SALE-01",
      outturn_number: "OT-1234",
      mark: "Test Factory",
      marketing_agent_id: VALID_UUID_1,
      grade_id: VALID_UUID_2,
      warehouse_id: VALID_UUID_3,
      bag_type_id: VALID_UUID_4,
      crop_year: "2025/2026",
      bags: 100,
      weight_total_kg: 6000,
      purchase_price_per_kg: 4.5,
    };

    it("accepts a valid payload", () => {
      const result = auctionLotSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("defaults auction_fees_total to 0 when omitted", () => {
      const result = auctionLotSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.auction_fees_total).toBe(0);
      }
    });

    it.each(["sale_number", "outturn_number", "mark"] as const)("rejects a missing %s", (field) => {
      const { [field]: _omitted, ...rest } = validPayload;
      const result = auctionLotSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects a missing lot_number", () => {
      const { lot_number, ...rest } = validPayload;
      const result = auctionLotSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects an empty lot_number", () => {
      const result = auctionLotSchema.safeParse({ ...validPayload, lot_number: "" });
      expect(result.success).toBe(false);
    });

    it("rejects a non-uuid marketing_agent_id", () => {
      const result = auctionLotSchema.safeParse({
        ...validPayload,
        marketing_agent_id: "not-a-uuid",
      });
      expect(result.success).toBe(false);
    });

    it("rejects a non-uuid grade_id", () => {
      const result = auctionLotSchema.safeParse({ ...validPayload, grade_id: "not-a-uuid" });
      expect(result.success).toBe(false);
    });

    it("rejects a non-uuid warehouse_id", () => {
      const result = auctionLotSchema.safeParse({ ...validPayload, warehouse_id: "not-a-uuid" });
      expect(result.success).toBe(false);
    });

    it("rejects a non-uuid bag_type_id", () => {
      const result = auctionLotSchema.safeParse({ ...validPayload, bag_type_id: "not-a-uuid" });
      expect(result.success).toBe(false);
    });

    it("rejects a missing crop_year", () => {
      const { crop_year, ...rest } = validPayload;
      const result = auctionLotSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects zero bags", () => {
      const result = auctionLotSchema.safeParse({ ...validPayload, bags: 0 });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer bags", () => {
      const result = auctionLotSchema.safeParse({ ...validPayload, bags: 10.5 });
      expect(result.success).toBe(false);
    });

    it("rejects a non-positive weight_total_kg", () => {
      const result = auctionLotSchema.safeParse({ ...validPayload, weight_total_kg: 0 });
      expect(result.success).toBe(false);
    });

    it("rejects a non-positive purchase_price_per_kg", () => {
      const result = auctionLotSchema.safeParse({ ...validPayload, purchase_price_per_kg: -1 });
      expect(result.success).toBe(false);
    });

    it("rejects a negative auction_fees_total", () => {
      const result = auctionLotSchema.safeParse({ ...validPayload, auction_fees_total: -5 });
      expect(result.success).toBe(false);
    });

    it("accepts an optional catalog_document_path", () => {
      const result = auctionLotSchema.safeParse({
        ...validPayload,
        catalog_document_path: "/uploads/catalog.pdf",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("directAgreementSchema", () => {
    const validPayload = {
      supplier_id: VALID_UUID_1,
      agreement_reference: "DA-2026-001",
      agreed_price_per_kg: 3.75,
      crop_year: "2025/2026",
    };

    it("accepts a valid payload", () => {
      const result = directAgreementSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("defaults currency to USD when omitted", () => {
      const result = directAgreementSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.currency).toBe("USD");
      }
    });

    it("rejects a non-uuid supplier_id", () => {
      const result = directAgreementSchema.safeParse({ ...validPayload, supplier_id: "abc" });
      expect(result.success).toBe(false);
    });

    it("rejects a missing agreement_reference", () => {
      const { agreement_reference, ...rest } = validPayload;
      const result = directAgreementSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects an empty agreement_reference", () => {
      const result = directAgreementSchema.safeParse({ ...validPayload, agreement_reference: "" });
      expect(result.success).toBe(false);
    });

    it("rejects a non-positive agreed_price_per_kg", () => {
      const result = directAgreementSchema.safeParse({ ...validPayload, agreed_price_per_kg: 0 });
      expect(result.success).toBe(false);
    });

    it("rejects a missing crop_year", () => {
      const { crop_year, ...rest } = validPayload;
      const result = directAgreementSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });
  });

  describe("directDeliverySchema", () => {
    const validPayload = {
      agreement_id: VALID_UUID_1,
      internal_lot_id: "INT-LOT-001",
      delivery_reference: "DEL-2026-001",
      grade_id: VALID_UUID_2,
      warehouse_id: VALID_UUID_3,
      bag_type_id: VALID_UUID_4,
      bags: 50,
      weight_total_kg: 3000,
      moisture_percent: 11.5,
      screen_size: 15,
      defects_percent: 2.5,
    };

    it("accepts a valid payload", () => {
      const result = directDeliverySchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("defaults processing_cost_total and transport_cost_total to 0", () => {
      const result = directDeliverySchema.safeParse(validPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.processing_cost_total).toBe(0);
        expect(result.data.transport_cost_total).toBe(0);
      }
    });

    it("rejects a non-uuid agreement_id", () => {
      const result = directDeliverySchema.safeParse({ ...validPayload, agreement_id: "abc" });
      expect(result.success).toBe(false);
    });

    it("rejects a missing internal_lot_id", () => {
      const { internal_lot_id, ...rest } = validPayload;
      const result = directDeliverySchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects a missing delivery_reference", () => {
      const { delivery_reference, ...rest } = validPayload;
      const result = directDeliverySchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects a non-uuid grade_id", () => {
      const result = directDeliverySchema.safeParse({ ...validPayload, grade_id: "abc" });
      expect(result.success).toBe(false);
    });

    it("rejects a non-uuid warehouse_id", () => {
      const result = directDeliverySchema.safeParse({ ...validPayload, warehouse_id: "abc" });
      expect(result.success).toBe(false);
    });

    it("rejects a non-uuid bag_type_id", () => {
      const result = directDeliverySchema.safeParse({ ...validPayload, bag_type_id: "abc" });
      expect(result.success).toBe(false);
    });

    it("rejects a non-positive bags", () => {
      const result = directDeliverySchema.safeParse({ ...validPayload, bags: 0 });
      expect(result.success).toBe(false);
    });

    it("rejects a non-positive weight_total_kg", () => {
      const result = directDeliverySchema.safeParse({ ...validPayload, weight_total_kg: -1 });
      expect(result.success).toBe(false);
    });

    it("rejects a negative moisture_percent", () => {
      const result = directDeliverySchema.safeParse({ ...validPayload, moisture_percent: -1 });
      expect(result.success).toBe(false);
    });

    it("rejects a negative screen_size", () => {
      const result = directDeliverySchema.safeParse({ ...validPayload, screen_size: -1 });
      expect(result.success).toBe(false);
    });

    it("rejects a negative defects_percent", () => {
      const result = directDeliverySchema.safeParse({ ...validPayload, defects_percent: -1 });
      expect(result.success).toBe(false);
    });
  });
});
