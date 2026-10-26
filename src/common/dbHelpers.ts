import { PoolClient } from "pg";

import { isSoftDeleteTable } from "../db/softDelete.js";
import { ApiError } from "./errors/ApiError.js";

export const EPSILON = 1e-6;
export const SHIPMENT_PROGRESSION = [
  "planned",
  "stuffed",
  "cleared",
  "on_vessel",
  "completed",
];

export function toNumber(value: unknown): number {
  return Number(value);
}

export function nextContractStatus(
  shippedKg: number,
  quantityKg: number,
  currentStatus: string,
): string {
  if (currentStatus === "closed") {
    return currentStatus;
  }

  if (shippedKg >= quantityKg - EPSILON) {
    return "fulfilled";
  }

  if (shippedKg > EPSILON) {
    return "partially_fulfilled";
  }

  return "open";
}

export async function ensureReference(
  client: PoolClient,
  table: string,
  id: string,
  label: string,
  organizationId?: string,
): Promise<void> {
  if (!/^[a-z_]+$/.test(table)) {
    throw new ApiError(500, `Unsafe SQL identifier for table: ${table}`);
  }

  // Soft-deleted master rows can't be picked for new records.
  const activeSql = isSoftDeleteTable(table) ? " AND deleted_at IS NULL" : "";

  const result =
    organizationId === undefined
      ? await client.query(`SELECT id FROM ${table} WHERE id = $1${activeSql}`, [id])
      : await client.query(
          `SELECT id FROM ${table} WHERE id = $1 AND organization_id = $2${activeSql}`,
          [id, organizationId],
        );

  if (result.rowCount === 0) {
    throw new ApiError(404, `${label} not found`);
  }
}

export async function refreshLotStatus(
  client: PoolClient,
  lotId: string,
  organizationId?: string,
): Promise<void> {
  const lotResult =
    organizationId === undefined
      ? await client.query(
          "SELECT weight_available_kg FROM lots WHERE id = $1 FOR UPDATE",
          [lotId],
        )
      : await client.query(
          "SELECT weight_available_kg FROM lots WHERE id = $1 AND organization_id = $2 FOR UPDATE",
          [lotId, organizationId],
        );

  if (lotResult.rowCount === 0) {
    throw new ApiError(404, `Lot not found`);
  }

  const weightAvailable = toNumber(lotResult.rows[0].weight_available_kg);

  const allocResult = await client.query(
    "SELECT COUNT(*)::int AS count FROM allocations WHERE lot_id = $1 AND status = 'allocated'",
    [lotId],
  );

  const openAllocationCount = Number(allocResult.rows[0].count);

  let status = "in_stock";

  if (weightAvailable <= EPSILON) {
    status = openAllocationCount > 0 ? "allocated" : "shipped";
  } else if (openAllocationCount > 0) {
    status = "allocated";
  }

  if (organizationId === undefined) {
    await client.query("UPDATE lots SET status = $1 WHERE id = $2", [
      status,
      lotId,
    ]);
  } else {
    await client.query("UPDATE lots SET status = $1 WHERE id = $2 AND organization_id = $3", [
      status,
      lotId,
      organizationId,
    ]);
  }
}
