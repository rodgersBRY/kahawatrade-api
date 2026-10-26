import crypto from "node:crypto";

import { ApiError } from "../../common/errors/ApiError.js";
import { buildPaginatedResult, escapeLikeQuery, ListQueryParams } from "../../common/pagination.js";
import { hashPassword, verifyPasswordHash } from "../../common/security/password.js";
import { signAccessToken } from "../../common/security/jwt.js";
import { signSuperAdminToken } from "../../common/security/superAdminJwt.js";
import { seedStandardBagTypesForOrg } from "../../bootstrap/seedStandardBagTypes.js";
import { seedStandardGradesForOrg } from "../../bootstrap/seedStandardGrades.js";
import { query, withTransaction } from "../../db/pool.js";

type SuperAdminRow = {
  id: string;
  email: string;
  password_hash: string;
};

type OrgRow = {
  id: string;
  name: string;
  slug: string;
  country: string | null;
  status: string;
  created_at: Date;
  plan: string | null;
  subscription_status: string | null;
  trial_ends_at: Date | null;
  current_period_end: Date | null;
  onboarded_by_email?: string | null;
  users_count: number;
  active_lots: number;
};

type OrgUserRow = {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  last_login_at: Date | null;
};

type OrgNoteRow = {
  id: string;
  note: string;
  created_at: Date;
  author_email: string;
};

const PLAN_PRICING: Record<string, number> = {
  starter: 99,
  growth: 299,
  enterprise: 1000,
};

function slugifyOrganization(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function deriveMrr(plan: string | null, status: string | null): number | null {
  if (!plan) {
    return null;
  }
  if (status && status !== "active" && status !== "past_due") {
    return 0;
  }
  return PLAN_PRICING[plan] ?? null;
}

export class InternalService {
  async login(input: { email: string; password: string }): Promise<Record<string, unknown>> {
    const email = input.email.toLowerCase();
    const result = await query<SuperAdminRow>(
      "SELECT id, email, password_hash FROM super_admins WHERE email = $1",
      [email],
    );
    if (result.rowCount === 0) {
      throw new ApiError(401, "Invalid credentials");
    }
    const admin = result.rows[0];
    const ok = await verifyPasswordHash(admin.password_hash, input.password);
    if (!ok) {
      throw new ApiError(401, "Invalid credentials");
    }

    const token = signSuperAdminToken({
      superAdminId: admin.id,
      email: admin.email,
    });

    return {
      access_token: token,
      token_type: "Bearer",
      admin: {
        id: admin.id,
        email: admin.email,
      },
    };
  }

  async listOrganizations(listQuery: ListQueryParams): Promise<unknown> {
    const whereClauses: string[] = [];
    const values: unknown[] = [];

    if (listQuery.search) {
      values.push(`%${escapeLikeQuery(listQuery.search)}%`);
      whereClauses.push(`(o.name ILIKE $${values.length} ESCAPE '\\' OR o.slug ILIKE $${values.length} ESCAPE '\\')`);
    }

    if (listQuery.filters.plan) {
      values.push(listQuery.filters.plan);
      whereClauses.push(`s.plan = $${values.length}`);
    }
    if (listQuery.filters.status) {
      values.push(listQuery.filters.status);
      whereClauses.push(`s.status = $${values.length}`);
    }
    if (listQuery.filters.country) {
      values.push(listQuery.filters.country);
      whereClauses.push(`o.country = $${values.length}`);
    }
    if (listQuery.filters.created_from) {
      values.push(listQuery.filters.created_from);
      whereClauses.push(`o.created_at >= $${values.length}::date`);
    }
    if (listQuery.filters.created_to) {
      values.push(listQuery.filters.created_to);
      whereClauses.push(`o.created_at <= $${values.length}::date`);
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const countResult = await query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM organizations o LEFT JOIN subscriptions s ON s.organization_id = o.id ${whereSql}`,
      values,
    );

    const sortMap: Record<string, string> = {
      created_at: "o.created_at",
      name: "o.name",
      plan: "s.plan",
      status: "s.status",
      users: "users_count",
      active_lots: "active_lots",
      id: "o.id",
    };
    const orderBy = sortMap[listQuery.sortBy] ?? "o.created_at";

    values.push(listQuery.pageSize, listQuery.offset);

    const result = await query<OrgRow>(
      `
      SELECT
        o.id,
        o.name,
        o.slug,
        o.country,
        o.status::text AS status,
        o.created_at,
        s.plan::text AS plan,
        s.status::text AS subscription_status,
        s.trial_ends_at,
        s.current_period_end,
        (SELECT COUNT(*)::int FROM users u WHERE u.organization_id = o.id AND u.is_active = TRUE) AS users_count,
        (SELECT COUNT(*)::int FROM lots l WHERE l.organization_id = o.id AND l.status != 'shipped') AS active_lots
      FROM organizations o
      LEFT JOIN subscriptions s ON s.organization_id = o.id
      ${whereSql}
      ORDER BY ${orderBy} ${listQuery.sortOrder}
      LIMIT $${values.length - 1} OFFSET $${values.length}
      `,
      values,
    );

    const data = result.rows.map((row) => ({
      ...row,
      mrr: deriveMrr(row.plan, row.subscription_status),
      billing_next_date:
        row.subscription_status === "trialing"
          ? row.trial_ends_at
          : row.current_period_end,
    }));

    return buildPaginatedResult(data, Number(countResult.rows[0]?.total ?? 0), listQuery);
  }

  async getOrganization(orgId: string): Promise<unknown> {
    const orgResult = await query<OrgRow>(
      `
      SELECT
        o.id,
        o.name,
        o.slug,
        o.country,
        o.status::text AS status,
        o.created_at,
        s.plan::text AS plan,
        s.status::text AS subscription_status,
        s.trial_ends_at,
        s.current_period_end,
        sa.email AS onboarded_by_email,
        (SELECT COUNT(*)::int FROM users u WHERE u.organization_id = o.id AND u.is_active = TRUE) AS users_count,
        (SELECT COUNT(*)::int FROM lots l WHERE l.organization_id = o.id AND l.status != 'shipped') AS active_lots
      FROM organizations o
      LEFT JOIN subscriptions s ON s.organization_id = o.id
      LEFT JOIN super_admins sa ON sa.id = o.onboarded_by
      WHERE o.id = $1
      `,
      [orgId],
    );
    if (orgResult.rowCount === 0) {
      throw new ApiError(404, `Organization not found`);
    }

    const usageResult = await query(
      `
      SELECT
        (SELECT COUNT(*)::int FROM users u WHERE u.organization_id = $1) AS users_total,
        (SELECT COUNT(*)::int FROM users u WHERE u.organization_id = $1 AND u.is_active = TRUE) AS users_active,
        (SELECT COUNT(*)::int FROM lots l WHERE l.organization_id = $1) AS lots_total,
        (SELECT COUNT(*)::int FROM contracts c WHERE c.organization_id = $1) AS contracts_total,
        (SELECT COUNT(*)::int FROM contracts c WHERE c.organization_id = $1 AND c.status IN ('open', 'partially_fulfilled')) AS contracts_open,
        (SELECT COUNT(*)::int FROM shipments s WHERE s.organization_id = $1) AS shipments_total,
        (SELECT COUNT(*)::int FROM shipment_documents d WHERE d.organization_id = $1) AS documents_total,
        GREATEST(
          COALESCE((SELECT MAX(created_at) FROM lots WHERE organization_id = $1), 'epoch'::timestamp),
          COALESCE((SELECT MAX(created_at) FROM contracts WHERE organization_id = $1), 'epoch'::timestamp),
          COALESCE((SELECT MAX(created_at) FROM shipments WHERE organization_id = $1), 'epoch'::timestamp)
        ) AS last_activity
      `,
      [orgId],
    );

    const usersResult = await query<OrgUserRow>(
      `
      SELECT id, email, full_name, role::text AS role, is_active, last_login_at
      FROM users
      WHERE organization_id = $1
      ORDER BY created_at DESC, id DESC
      `,
      [orgId],
    );

    const notesResult = await query<OrgNoteRow>(
      `
      SELECT n.id, n.note, n.created_at, a.email AS author_email
      FROM org_notes n
      JOIN super_admins a ON a.id = n.super_admin_id
      WHERE n.organization_id = $1
      ORDER BY n.created_at DESC
      LIMIT 50
      `,
      [orgId],
    );

    const org = orgResult.rows[0];
    const usage = usageResult.rows[0] ?? {};

    return {
      organization: {
        ...org,
        mrr: deriveMrr(org.plan, org.subscription_status),
      },
      subscription: {
        plan: org.plan,
        status: org.subscription_status,
        trial_ends_at: org.trial_ends_at,
        current_period_end: org.current_period_end,
      },
      usage,
      users: usersResult.rows,
      notes: notesResult.rows,
    };
  }

  async createOrganization(
    input: {
      name: string;
      slug?: string;
      country?: string;
      admin_full_name: string;
      admin_email: string;
      admin_password: string;
      plan?: string;
      trial_days?: number;
      onboarded_by?: string;
    },
  ): Promise<unknown> {
    const plan = input.plan ?? "growth";
    const trialDays = input.trial_days ?? 14;

    const created = await withTransaction(async (client) => {
      const baseSlug = input.slug?.trim() || slugifyOrganization(input.name);
      if (!baseSlug) {
        throw new ApiError(400, "Invalid organization name");
      }

      let slug = baseSlug;
      let orgId = crypto.randomUUID();
      let orgResult = await client.query<{ id: string }>(
        `
        INSERT INTO organizations (id, name, slug, country, onboarded_by)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (slug) DO NOTHING
        RETURNING id
        `,
        [orgId, input.name, slug, input.country ?? null, input.onboarded_by ?? null],
      );

      let attempts = 0;
      while (orgResult.rowCount === 0 && attempts < 5) {
        attempts += 1;
        slug = `${baseSlug}-${Math.floor(Math.random() * 10000)}`;
        orgId = crypto.randomUUID();
        orgResult = await client.query<{ id: string }>(
          `
          INSERT INTO organizations (id, name, slug, country, onboarded_by)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (slug) DO NOTHING
          RETURNING id
          `,
          [orgId, input.name, slug, input.country ?? null, input.onboarded_by ?? null],
        );
      }

      if (orgResult.rowCount === 0) {
        throw new ApiError(409, "Unable to create organization. Try a different name.");
      }

      const organizationId = orgResult.rows[0].id;

      const status = trialDays > 0 ? "trialing" : "active";
      const subscriptionId = crypto.randomUUID();

      await client.query(
        `
        INSERT INTO subscriptions (id, organization_id, plan, status, trial_ends_at)
        VALUES (
          $1,
          $2,
          $3,
          $4,
          CASE WHEN $5::int > 0 THEN NOW() + ($5::int * INTERVAL '1 day') ELSE NULL END
        )
        ON CONFLICT (organization_id) DO NOTHING
        `,
        [subscriptionId, organizationId, plan, status, trialDays],
      );

      const passwordHash = await hashPassword(input.admin_password);
      const adminUserId = crypto.randomUUID();
      await client.query(
        `
        INSERT INTO users (id, email, password_hash, full_name, role, is_active, updated_at, organization_id)
        VALUES ($1, $2, $3, $4, 'admin', TRUE, NOW(), $5)
        `,
        [adminUserId, input.admin_email.toLowerCase(), passwordHash, input.admin_full_name, organizationId],
      );

      return organizationId;
    });

    await seedStandardBagTypesForOrg(created);
    await seedStandardGradesForOrg(created);
    return this.getOrganization(created);
  }

  async updatePlan(orgId: string, input: { plan: string; status?: string }): Promise<unknown> {
    const result = await query(
      `
      UPDATE subscriptions
      SET plan = $1, status = COALESCE($2, status), updated_at = NOW()
      WHERE organization_id = $3
      RETURNING *
      `,
      [input.plan, input.status ?? null, orgId],
    );
    if (result.rowCount === 0) {
      throw new ApiError(404, "Subscription not found");
    }
    return result.rows[0];
  }

  async extendTrial(
    orgId: string,
    input: { extend_days?: number; trial_ends_at?: string },
  ): Promise<unknown> {
    let result;
    if (input.extend_days) {
      result = await query(
        `
        UPDATE subscriptions
        SET trial_ends_at = COALESCE(trial_ends_at, NOW()) + ($1::int * INTERVAL '1 day'),
            status = 'trialing',
            updated_at = NOW()
        WHERE organization_id = $2
        RETURNING *
        `,
        [input.extend_days, orgId],
      );
    } else {
      result = await query(
        `
        UPDATE subscriptions
        SET trial_ends_at = $1::date,
            status = 'trialing',
            updated_at = NOW()
        WHERE organization_id = $2
        RETURNING *
        `,
        [input.trial_ends_at, orgId],
      );
    }

    if (result.rowCount === 0) {
      throw new ApiError(404, "Subscription not found");
    }
    return result.rows[0];
  }

  async updateOrganizationStatus(orgId: string, status: string): Promise<unknown> {
    const result = await query(
      `
      UPDATE organizations
      SET status = $1
      WHERE id = $2
      RETURNING *
      `,
      [status, orgId],
    );
    if (result.rowCount === 0) {
      throw new ApiError(404, "Organization not found");
    }
    return result.rows[0];
  }

  async addNote(orgId: string, superAdminId: string, note: string): Promise<unknown> {
    const result = await query(
      `
      INSERT INTO org_notes (id, organization_id, super_admin_id, note)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [crypto.randomUUID(), orgId, superAdminId, note],
    );
    return result.rows[0];
  }

  async impersonate(orgId: string, superAdminId: string): Promise<unknown> {
    const userResult = await query<{ id: string }>(
      `
      SELECT id
      FROM users
      WHERE organization_id = $1 AND role = 'admin' AND is_active = TRUE
      ORDER BY id ASC
      LIMIT 1
      `,
      [orgId],
    );
    if (userResult.rowCount === 0) {
      throw new ApiError(404, "No active admin user found for organization");
    }
    const adminUserId = userResult.rows[0].id;

    await query(
      `
      INSERT INTO impersonation_logs (id, organization_id, super_admin_id)
      VALUES ($1, $2, $3)
      `,
      [crypto.randomUUID(), orgId, superAdminId],
    );

    const token = signAccessToken({
      userId: adminUserId,
      role: "admin",
      organizationId: orgId,
      sessionId: crypto.randomUUID(),
      impersonated: true,
      expiresIn: "15m",
    });

    return {
      access_token: token,
      token_type: "Bearer",
      expires_in: 900,
    };
  }

  async getRevenue(): Promise<unknown> {
    const result = await query(
      `
      SELECT
        plan::text AS plan,
        status::text AS status,
        COUNT(*)::int AS orgs
      FROM subscriptions
      GROUP BY plan, status
      `,
    );

    let mrr = 0;
    let activeOrgs = 0;
    let trialing = 0;
    let pastDue = 0;
    const breakdown: Record<string, { orgs: number; mrr: number }> = {};

    for (const row of result.rows as Array<{ plan: string; status: string; orgs: number }>) {
      const plan = row.plan;
      const status = row.status;
      const count = Number(row.orgs);
      const planMrr = PLAN_PRICING[plan] ?? 0;
      if (!breakdown[plan]) {
        breakdown[plan] = { orgs: 0, mrr: 0 };
      }
      breakdown[plan].orgs += count;

      if (status === "active") {
        activeOrgs += count;
        mrr += planMrr * count;
        breakdown[plan].mrr += planMrr * count;
      } else if (status === "trialing") {
        trialing += count;
      } else if (status === "past_due") {
        pastDue += count;
      }
    }

    return {
      mrr,
      arr_run_rate: mrr * 12,
      active_orgs: activeOrgs,
      trialing_orgs: trialing,
      past_due_orgs: pastDue,
      breakdown,
    };
  }

  async getAlerts(): Promise<unknown> {
    const alerts: Array<Record<string, unknown>> = [];

    const trialResult = await query(
      `
      SELECT o.id, o.name, s.trial_ends_at
      FROM subscriptions s
      JOIN organizations o ON o.id = s.organization_id
      WHERE s.status = 'trialing'
        AND s.trial_ends_at IS NOT NULL
        AND s.trial_ends_at <= NOW() + INTERVAL '7 days'
      ORDER BY s.trial_ends_at ASC
      LIMIT 50
      `,
    );

    for (const row of trialResult.rows as Array<{ id: string; name: string; trial_ends_at: Date }>) {
      alerts.push({
        type: "trial_expiring",
        organization_id: row.id,
        organization_name: row.name,
        trial_ends_at: row.trial_ends_at,
      });
    }

    const pastDueResult = await query(
      `
      SELECT o.id, o.name
      FROM subscriptions s
      JOIN organizations o ON o.id = s.organization_id
      WHERE s.status = 'past_due'
      ORDER BY o.created_at DESC
      LIMIT 50
      `,
    );

    for (const row of pastDueResult.rows as Array<{ id: string; name: string }>) {
      alerts.push({
        type: "past_due",
        organization_id: row.id,
        organization_name: row.name,
      });
    }

    return { alerts };
  }
}

export const internalService = new InternalService();
