import { z } from "zod";

export const contractSchema = z
  .object({
    contract_number: z.string().min(1),
    buyer_id: z.string().uuid(),
    grade_id: z.string().uuid().optional(),
    quantity_kg: z.number().positive(),
    price_per_kg: z.number().positive(),
    price_terms: z.enum(["fob", "cif"]),
    currency: z.string().default("USD"),
    shipment_window_start: z.string().date(),
    shipment_window_end: z.string().date(),
  })
  .refine(
    (val) =>
      new Date(`${val.shipment_window_start}T00:00:00.000Z`) <=
      new Date(`${val.shipment_window_end}T00:00:00.000Z`),
    { message: "shipment_window_start must be <= shipment_window_end" },
  );

export const allocationSchema = z.object({
  lot_id: z.string().uuid(),
  allocated_kg: z.number().positive(),
});

export type ContractInput = z.infer<typeof contractSchema>;
export type AllocationInput = z.infer<typeof allocationSchema>;

export const contractUpdateSchema = z
  .object({
    contract_number: z.string().min(1),
    buyer_id: z.string().uuid(),
    grade_id: z.string().uuid().nullable(),
    quantity_kg: z.number().positive(),
    price_per_kg: z.number().positive(),
    price_terms: z.enum(["fob", "cif"]),
    currency: z.string().min(1),
    shipment_window_start: z.string().date(),
    shipment_window_end: z.string().date(),
  })
  .partial()
  .strict();

export type ContractUpdateInput = z.infer<typeof contractUpdateSchema>;
