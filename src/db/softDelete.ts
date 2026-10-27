import {
  AuditEntityType,
  diffRows,
  recordAudit,
  updateColumns,
} from "../common/audit.js";
import { ApiError } from "../common/errors/ApiError.js";
import { AuthContext } from "../types/auth.js";
import { withTransaction } from "./pool.js";

/**
 * Tables whose rows are flagged with `deleted_at` instead of being removed.
 * Existing lots, contracts and agreements keep pointing at a deleted row, so
 * history stays intact; new records can no longer pick it.
 */
export const SOFT_DELETE_TABLES = [
  "suppliers",
  "buyers",
  "warehouses",
  "grades",
  "bag_types",
] as const;

export type SoftDeleteTable = (typeof SOFT_DELETE_TABLES)[number];

const ENTITY_TYPE: Record<SoftDeleteTable, AuditEntityType> = {
  suppliers: "supplier",
  buyers: "buyer",
  warehouses: "warehouse",
  grades: "grade",
  bag_types: "bag_type",
};

export function isSoftDeleteTable(table: string): table is SoftDeleteTable {
  return (SOFT_DELETE_TABLES as readonly string[]).includes(table);
}

function assertSoftDeleteTable(table: string): asserts table is SoftDeleteTable {
  if (!isSoftDeleteTable(table)) {
    throw new ApiError(500, `Table does not support soft delete: ${table}`);
  }
}

/**
 * Marks one row in the actor's org as deleted and logs it. A row that is
 * missing, in another org, or already deleted returns 404.
 */
export async function softDeleteById(
  actor: AuthContext,
  table: SoftDeleteTable,
  id: string,
  label: string,
): Promise<unknown> {
  assertSoftDeleteTable(table);

  return withTransaction(async (client) => {
    const result = await client.query(
      `
      UPDATE ${table}
      SET deleted_at = NOW()
      WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
      RETURNING *
      `,
      [id, actor.organizationId],
    );

    if (result.rowCount === 0) {
      throw new ApiError(404, `${label} not found`);
    }

    await recordAudit(client, actor, {
      entityType: ENTITY_TYPE[table],
      entityId: id,
      action: "delete",
      changes: {},
    });
    return result.rows[0];
  }, actor);
}

/**
 * Updates the given columns on a non-deleted row and logs what changed.
 * `values` keys must be fixed column names chosen by the caller.
 */
export async function updateActiveRow(
  actor: AuthContext,
  table: SoftDeleteTable,
  id: string,
  label: string,
  values: Record<string, unknown>,
): Promise<unknown> {
  assertSoftDeleteTable(table);

  return withTransaction(async (client) => {
    const current = await client.query(
      `SELECT * FROM ${table} WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [id, actor.organizationId],
    );
    if (current.rowCount === 0) {
      throw new ApiError(404, `${label} not found`);
    }

    const before = current.rows[0];
    const after = await updateColumns(client, table, "id", id, actor.organizationId, values);

    await recordAudit(client, actor, {
      entityType: ENTITY_TYPE[table],
      entityId: id,
      action: "update",
      changes: diffRows(before, after, Object.keys(values)),
    });
    return after;
  }, actor);
}
