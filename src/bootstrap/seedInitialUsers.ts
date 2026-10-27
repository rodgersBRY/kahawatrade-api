import crypto from "node:crypto";

import { logger } from "../common/logger.js";
import { hashPassword } from "../common/security/password.js";
import { withTransaction } from "../db/pool.js";
import { bootstrapUsers } from "./defaultUsers.js";

type CountRow = {
  count: number;
};

export async function seedInitialUsersIfEmpty(): Promise<void> {
  await withTransaction(async (client) => {
    const countResult = await client.query<CountRow>(
      "SELECT COUNT(*)::int AS count FROM users",
    );

    const usersCount = Number(countResult.rows[0]?.count ?? 0);

    if (usersCount > 0) {
      logger.info("User bootstrap skipped: users already exist", {
        usersCount,
      });
      return;
    }

    logger.warn("Users table is empty. Bootstrapping default test users.", {
      totalUsers: bootstrapUsers.length,
    });

    const orgInsertId = crypto.randomUUID();
    const orgResult = await client.query<{ id: string }>(
      `
      INSERT INTO organizations (id, name, slug)
      VALUES ($1, 'Default Organization', 'default')
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
      `,
      [orgInsertId],
    );
    const organizationId =
      orgResult.rows[0]?.id ??
      (await client.query<{ id: string }>(
        `SELECT id FROM organizations WHERE slug = 'default' LIMIT 1`,
      )).rows[0]?.id;

    if (!organizationId) {
      throw new Error("Failed to resolve default organization for bootstrap");
    }

    await client.query(
      `
      INSERT INTO subscriptions (id, organization_id, plan, status, trial_ends_at)
      VALUES ($1, $2, 'starter', 'trialing', NOW() + INTERVAL '14 days')
      ON CONFLICT (organization_id) DO NOTHING
      `,
      [crypto.randomUUID(), organizationId],
    );

    for (const user of bootstrapUsers) {
      const passwordHash = await hashPassword(user.password);

      await client.query(
        `
        INSERT INTO users (id, email, password_hash, full_name, role, is_active, updated_at, organization_id)
        VALUES ($1, $2, $3, $4, $5, TRUE, NOW(), $6)
        ON CONFLICT (email) DO NOTHING
        `,
        [crypto.randomUUID(), user.email.toLowerCase(), passwordHash, user.fullName, user.role, organizationId],
      );
    }

    logger.info("Default test users bootstrapped", {
      users: bootstrapUsers.map((user) => ({
        email: user.email,
        role: user.role,
      })),
    });
  });
}
