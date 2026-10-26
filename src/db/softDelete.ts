import { ApiError } from "../common/errors/ApiError.js";
import { AuthContext } from "../types/auth.js";
import { withActor } from "./pool.js";

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

export function isSoftDeleteTable(table: string): table is SoftDeleteTable {
  return (SOFT_DELETE_TABLES as readonly string[]).includes(table);
}

/**
 * Marks one row in the actor's org as deleted. A row that is missing, in
 * another org, or already deleted returns 404.
 */
export async function softDeleteById(
  actor: AuthContext,
  table: SoftDeleteTable,
  id: string,
  label: string,
): Promise<unknown> {
  if (!isSoftDeleteTable(table)) {
    throw new ApiError(500, `Table does not support soft delete: ${table}`);
  }

  const result = await withActor(
    actor,
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
  return result.rows[0];
}
