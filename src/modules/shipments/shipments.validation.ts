import { z } from "zod";

export const shipmentCreateSchema = z.object({
  shipment_number: z.string().min(1),
  contract_id: z.string().uuid(),
  container_number: z.string().optional(),
  seal_number: z.string().optional(),
  planned_departure: z.string().date().optional(),
  allocation_ids: z.array(z.string().uuid()).min(1),
});

export const shipmentStatusSchema = z.object({
  status: z.enum(["planned", "stuffed", "cleared", "on_vessel", "completed"]),
  actual_departure: z.string().date().optional(),
});

export const docsGenerateSchema = z.object({
  doc_types: z
    .array(
      z.enum([
        "commercial_invoice",
        "packing_list",
        "traceability_report",
        "cost_breakdown_summary",
      ]),
    )
    .min(1),
});

export type ShipmentCreateInput = z.infer<typeof shipmentCreateSchema>;
export type ShipmentStatusInput = z.infer<typeof shipmentStatusSchema>;
export type DocsGenerateInput = z.infer<typeof docsGenerateSchema>;

export const shipmentUpdateSchema = z
  .object({
    shipment_number: z.string().min(1),
    container_number: z.string(),
    seal_number: z.string(),
    planned_departure: z.string().date(),
  })
  .partial()
  .strict();

export type ShipmentUpdateInput = z.infer<typeof shipmentUpdateSchema>;
