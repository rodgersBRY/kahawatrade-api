import crypto from "node:crypto";

import { logger } from "../common/logger.js";
import { withTransaction } from "../db/pool.js";
import { bootstrapBagTypes } from "./defaultBagTypes.js";

type BagTypeRow = {
  id: string;
  name: string;
  weight_kg: string | number;
  organization_id?: string;
};

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function sameWeight(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.0001;
}

export async function seedStandardBagTypesIfMissing(): Promise<void> {
  await withTransaction(async (client) => {
    const orgResult = await client.query<{ id: string }>(
      "SELECT id FROM organizations",
    );
    const organizationIds = orgResult.rows.map((row) => row.id);
    if (organizationIds.length === 0) {
      logger.warn("No organizations found. Skipping bag type bootstrap.");
      return;
    }

    const inserted: Array<{ name: string; weight_kg: number; organization_id: string }> = [];
    for (const organizationId of organizationIds) {
      const existingResult = await client.query<BagTypeRow>(
        "SELECT id, name, weight_kg FROM bag_types WHERE organization_id = $1",
        [organizationId],
      );
      const existing = existingResult.rows;

      for (const seed of bootstrapBagTypes) {
        const found = existing.some((row) => {
          const existingWeight = Number(row.weight_kg);
          return (
            normalizeName(row.name) === normalizeName(seed.name) ||
            sameWeight(existingWeight, seed.weightKg)
          );
        });

        if (found) {
          continue;
        }

        const insertResult = await client.query<BagTypeRow>(
          `
          INSERT INTO bag_types (id, name, weight_kg, organization_id)
          VALUES ($1, $2, $3, $4)
          RETURNING id, name, weight_kg
          `,
          [crypto.randomUUID(), seed.name, seed.weightKg, organizationId],
        );

        existing.push(insertResult.rows[0]);
        inserted.push({ name: seed.name, weight_kg: seed.weightKg, organization_id: organizationId });
      }
    }

    if (inserted.length === 0) {
      logger.info("Standard bag types already present. Bootstrap skipped.");
      return;
    }

    logger.info("Standard bag types bootstrapped", {
      inserted,
    });
  });
}

export async function seedStandardBagTypesForOrg(organizationId: string): Promise<void> {
  await withTransaction(async (client) => {
    const existingResult = await client.query<BagTypeRow>(
      "SELECT id, name, weight_kg FROM bag_types WHERE organization_id = $1",
      [organizationId],
    );

    const existing = existingResult.rows;

    const inserted: Array<{ name: string; weight_kg: number; organization_id: string }> = [];

    for (const seed of bootstrapBagTypes) {
      const found = existing.some((row) => {
        const existingWeight = Number(row.weight_kg);
        
        return (
          normalizeName(row.name) === normalizeName(seed.name) ||
          sameWeight(existingWeight, seed.weightKg)
        );
      });

      if (found) {
        continue;
      }

      const insertResult = await client.query<BagTypeRow>(
        `
        INSERT INTO bag_types (id, name, weight_kg, organization_id)
        VALUES ($1, $2, $3, $4)
        RETURNING id, name, weight_kg
        `,
        [crypto.randomUUID(), seed.name, seed.weightKg, organizationId],
      );

      existing.push(insertResult.rows[0]);
      inserted.push({ name: seed.name, weight_kg: seed.weightKg, organization_id: organizationId });
    }

    if (inserted.length > 0) {
      logger.info("Standard bag types bootstrapped for organization", {
        organization_id: organizationId,
        inserted,
      });
    }
  });
}
