import { Request, Response } from "express";

import { ApiError } from "../../common/errors/ApiError.js";
import { parseListQuery } from "../../common/pagination.js";
import { auditService } from "./audit.service.js";
import { auditQuerySchema } from "./audit.validation.js";

export class AuditController {
  async listEntityHistory(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }
    const input = auditQuerySchema.parse(req.query);
    const query = parseListQuery(req.query as Record<string, unknown>, {
      allowedSortBy: ["created_at"],
      defaultSortBy: "created_at",
    });
    res.json(await auditService.listEntityHistory(input, query, req.auth));
  }
}

export const auditController = new AuditController();
