import { z } from "zod";

export const auctionLotSchema = z.object({
  lot_number: z.string().trim().min(1),
  sale_number: z.string().trim().min(1),
  outturn_number: z.string().trim().min(1),
  mark: z.string().trim().min(1),
  marketing_agent_id: z.string().uuid(),
  grade_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  bag_type_id: z.string().uuid(),
  crop_year: z.string().min(1),
  bags: z.number().int().positive(),
  weight_total_kg: z.number().positive(),
  purchase_price_per_kg: z.number().positive(),
  auction_fees_total: z.number().nonnegative().default(0),
  catalog_document_path: z.string().optional(),
});

export const directAgreementSchema = z.object({
  supplier_id: z.string().uuid(),
  agreement_reference: z.string().min(1),
  agreed_price_per_kg: z.number().positive(),
  currency: z.string().default("USD"),
  crop_year: z.string().min(1),
});

export const directDeliverySchema = z.object({
  agreement_id: z.string().uuid(),
  internal_lot_id: z.string().min(1),
  delivery_reference: z.string().min(1),
  grade_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  bag_type_id: z.string().uuid(),
  bags: z.number().int().positive(),
  weight_total_kg: z.number().positive(),
  moisture_percent: z.number().nonnegative(),
  screen_size: z.number().nonnegative(),
  defects_percent: z.number().nonnegative(),
  processing_cost_total: z.number().nonnegative().default(0),
  transport_cost_total: z.number().nonnegative().default(0),
});

// Edit bodies list only the fields that may change. Weights and bags are left
// out on purpose: corrections go through inventory stock adjustments.
export const auctionLotUpdateSchema = z
  .object({
    lot_number: z.string().trim().min(1),
    sale_number: z.string().trim().min(1),
    outturn_number: z.string().trim().min(1),
    mark: z.string().trim().min(1),
    marketing_agent_id: z.string().uuid(),
    grade_id: z.string().uuid(),
    warehouse_id: z.string().uuid(),
    bag_type_id: z.string().uuid(),
    crop_year: z.string().min(1),
    purchase_price_per_kg: z.number().positive(),
    auction_fees_total: z.number().nonnegative(),
    catalog_document_path: z.string(),
  })
  .partial()
  .strict();

export const directDeliveryUpdateSchema = z
  .object({
    internal_lot_id: z.string().min(1),
    delivery_reference: z.string().min(1),
    grade_id: z.string().uuid(),
    warehouse_id: z.string().uuid(),
    bag_type_id: z.string().uuid(),
    moisture_percent: z.number().nonnegative(),
    screen_size: z.number().nonnegative(),
    defects_percent: z.number().nonnegative(),
    purchase_price_per_kg: z.number().positive(),
    additional_cost_total: z.number().nonnegative(),
  })
  .partial()
  .strict();

export const directAgreementUpdateSchema = z
  .object({
    supplier_id: z.string().uuid(),
    agreement_reference: z.string().min(1),
    agreed_price_per_kg: z.number().positive(),
    currency: z.string().min(1),
    crop_year: z.string().min(1),
  })
  .partial()
  .strict();

export const lotPricingUpdateSchema = z
  .object({
    purchase_price_per_kg: z.number().positive(),
    auction_fees_total: z.number().nonnegative(),
    additional_cost_total: z.number().nonnegative(),
  })
  .partial()
  .strict();

export type AuctionLotInput = z.infer<typeof auctionLotSchema>;
export type DirectAgreementInput = z.infer<typeof directAgreementSchema>;
export type DirectDeliveryInput = z.infer<typeof directDeliverySchema>;
export type AuctionLotUpdateInput = z.infer<typeof auctionLotUpdateSchema>;
export type DirectDeliveryUpdateInput = z.infer<typeof directDeliveryUpdateSchema>;
export type DirectAgreementUpdateInput = z.infer<typeof directAgreementUpdateSchema>;
export type LotPricingUpdateInput = z.infer<typeof lotPricingUpdateSchema>;
