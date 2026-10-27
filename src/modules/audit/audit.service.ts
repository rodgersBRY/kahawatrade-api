import { AuditEntityType } from "../../common/audit.js";
import { ApiError } from "../../common/errors/ApiError.js";
import { ListQueryParams, buildPaginatedResult } from "../../common/pagination.js";
import { withActor } from "../../db/pool.js";
import { AuthContext, UserRole } from "../../types/auth.js";
import { AuditQueryInput } from "./audit.validation.js";

const MASTER_ROLES: UserRole[] = ["admin", "compliance"];

// Who may read each record's history. Mirrors who can open that area.
const VIEW_ROLES: Record<AuditEntityType, UserRole[]> = {
  supplier: MASTER_ROLES,
  buyer: MASTER_ROLES,
  warehouse: MASTER_ROLES,
  grade: MASTER_ROLES,
  bag_type: MASTER_ROLES,
  lot: ["admin", "trader", "finance"],
  direct_agreement: ["admin", "trader"],
  contract: ["admin", "trader"],
  allocation: ["admin", "trader"],
  shipment: ["admin", "trader", "warehouse", "compliance"],
  cost_entry: ["admin", "finance"],
};

export class AuditService {
  async listEntityHistory(
    input: AuditQueryInput,
    listQuery: ListQueryParams,
    actor: AuthContext,
  ): Promise<unknown> {
    if (!VIEW_ROLES[input.entity_type].includes(actor.role)) {
      throw new ApiError(403, "Insufficient permissions");
    }

    const values: unknown[] = [actor.organizationId, input.entity_type, input.entity_id];
    const whereSql = "WHERE al.organization_id = $1 AND al.entity_type = $2 AND al.entity_id = $3";
    const countResult = await withActor<{ total: number }>(
      actor,
      `SELECT COUNT(*)::int AS total FROM audit_logs al ${whereSql}`,
      values,
    );
    values.push(listQuery.pageSize, listQuery.offset);
    const result = await withActor(
      actor,
      `
      SELECT
        al.id,
        al.action,
        al.changes,
        al.actor_role,
        al.impersonated,
        al.api_key_id IS NOT NULL AS via_api_key,
        u.full_name AS changed_by,
        u.email AS changed_by_email,
        al.created_at
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.user_id
      ${whereSql}
      ORDER BY al.created_at DESC, al.id DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}
      `,
      values,
    );
    return buildPaginatedResult(result.rows, Number(countResult.rows[0].total), listQuery);
  }
}

export const auditService = new AuditService();
