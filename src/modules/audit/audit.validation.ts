import { z } from "zod";

import { AUDIT_ENTITY_TYPES } from "../../common/audit.js";

export const auditQuerySchema = z.object({
  entity_type: z.enum(AUDIT_ENTITY_TYPES),
  entity_id: z.string().uuid(),
});

export type AuditQueryInput = z.infer<typeof auditQuerySchema>;
