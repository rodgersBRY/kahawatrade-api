import { z } from "zod";

const emailSchema = z.string().email();

export const superAdminLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});

export const createOrgSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).max(64).optional(),
  country: z.string().min(2).max(64).optional(),
  admin_full_name: z.string().min(2),
  admin_email: emailSchema,
  admin_password: z.string().min(process.env.NODE_ENV === "development" ? 1 : 12),
  plan: z.enum(["starter", "growth", "enterprise"]).optional(),
  trial_days: z.number().int().min(0).max(365).optional(),
});

export const updatePlanSchema = z.object({
  plan: z.enum(["starter", "growth", "enterprise"]),
  status: z.enum(["trialing", "active", "past_due", "cancelled"]).optional(),
});

export const updateTrialSchema = z
  .object({
    extend_days: z.number().int().min(1).max(365).optional(),
    trial_ends_at: z.string().date().optional(),
  })
  .refine((data) => Boolean(data.extend_days || data.trial_ends_at), {
    message: "extend_days or trial_ends_at is required",
  });

export const updateOrgStatusSchema = z.object({
  status: z.enum(["active", "suspended"]),
});

export const addOrgNoteSchema = z.object({
  note: z.string().min(3).max(2000),
});
