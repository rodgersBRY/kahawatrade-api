import type { PoolClient } from "pg";
import { ApiError } from "../../common/errors/ApiError.js";

export function packagingWeight(bags: number, bagWeight: number, pocket: number): number {
  if (!Number.isFinite(bagWeight) || bagWeight <= 0 || !Number.isInteger(bags) || bags < 0 || !Number.isFinite(pocket) || pocket < 0 || pocket >= bagWeight || Math.abs(pocket * 1000 - Math.round(pocket * 1000)) > 0.000001) {
    throw new ApiError(400, "Bags must be a nonnegative integer and pocket weight must be less than the bag weight, with at most three decimal places");
  }
  const total = Math.round(bags * bagWeight * 1000) + Math.round(pocket * 1000);
  if (total <= 0) throw new ApiError(400, "Lot weight must be positive");
  return total / 1000;
}

export async function calculatePackaging(client: PoolClient, organizationId: string, bagTypeId: string, bags: number, pocket: number): Promise<number> {
  const result = await client.query("SELECT weight_kg FROM bag_types WHERE id = $1 AND organization_id = $2", [bagTypeId, organizationId]);
  if (!result.rowCount) throw new ApiError(404, "Bag type not found");
  return packagingWeight(bags, Number(result.rows[0].weight_kg), pocket);
}
