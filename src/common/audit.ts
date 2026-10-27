import crypto from "node:crypto";

import { PoolClient } from "pg";

import { AuthContext } from "../types/auth.js";
import { ApiError } from "./errors/ApiError.js";

export const AUDIT_ENTITY_TYPES = [
  "supplier",
  "buyer",
  "warehouse",
  "grade",
  "bag_type",
  "lot",
  "direct_agreement",
  "contract",
  "allocation",
  "shipment",
  "cost_entry",
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];
export type AuditAction = "update" | "delete" | "cancel";
export type AuditChanges = Record<string, { from: unknown; to: unknown }>;

type Row = Record<string, unknown>;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Turns a DB or request value into a plain string or number. A DATE column
 * becomes "2026-01-01" so it matches what the API accepts.
 */
function normalize(value: unknown): string | number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    const isMidnight =
      value.getHours() === 0 &&
      value.getMinutes() === 0 &&
      value.getSeconds() === 0 &&
      value.getMilliseconds() === 0;
    return isMidnight
      ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
      : value.toISOString();
  }
  if (typeof value === "number") {
    return value;
  }
  return String(value);
}

function toJsonValue(value: unknown): unknown {
  return normalize(value);
}

/**
 * Compares two values. Text is compared as text so lot number "0012" differs
 * from "12"; it is compared as a number only when one side is a number, so a
 * numeric column's "4.5000" equals an input of 4.5.
 */
export function isSameValue(a: unknown, b: unknown): boolean {
  const left = normalize(a);
  const right = normalize(b);
  if (left === null || right === null) {
    return left === right;
  }
  if (typeof left === "number" || typeof right === "number") {
    return Number(left) === Number(right);
  }
  return left === right;
}

/**
 * Returns the keys in `input` whose value differs from the stored row.
 * `columnFor` maps an input key to the row column it is compared against.
 */
export function changedKeys(
  current: Row,
  input: Row,
  columnFor: (key: string) => string = (key) => key,
): string[] {
  return Object.keys(input).filter(
    (key) => input[key] !== undefined && !isSameValue(current[columnFor(key)], input[key]),
  );
}

/** Field-by-field diff between two versions of a row. */
export function diffRows(before: Row, after: Row, fields: readonly string[]): AuditChanges {
  const changes: AuditChanges = {};
  for (const field of fields) {
    if (!isSameValue(before[field], after[field])) {
      changes[field] = { from: toJsonValue(before[field]), to: toJsonValue(after[field]) };
    }
  }
  return changes;
}

/** Diff for `keys`, taking old values from the stored view and new ones from the input. */
export function diffInput(current: Row, input: Row, keys: readonly string[]): AuditChanges {
  const changes: AuditChanges = {};
  for (const key of keys) {
    changes[key] = { from: toJsonValue(current[key]), to: toJsonValue(input[key]) };
  }
  return changes;
}

function humanizeField(field: string): string {
  return field.replace(/_id$/, "").replace(/_/g, " ");
}

/**
 * Throws 409 when any of `changed` is in `locked`. The message names the
 * fields and why they are locked, e.g. "Can't change grade after the lot
 * is allocated to a contract".
 */
export function assertNotLocked(
  changed: readonly string[],
  locked: readonly string[],
  reason: string,
): void {
  const blocked = changed.filter((field) => locked.includes(field));
  if (blocked.length > 0) {
    throw new ApiError(409, `Can't change ${blocked.map(humanizeField).join(", ")} ${reason}`);
  }
}

/**
 * Updates the given columns on one org-scoped row and returns the new row.
 * Column names must come from a fixed list in the caller, never from input keys
 * the caller hasn't validated.
 */
export async function updateColumns(
  client: PoolClient,
  table: string,
  idColumn: string,
  id: string,
  organizationId: string,
  values: Row,
): Promise<Row> {
  // A key left undefined means "not sent", so it never overwrites the column.
  const columns = Object.keys(values).filter((column) => values[column] !== undefined);
  for (const identifier of [table, idColumn, ...columns]) {
    if (!/^[a-z_]+$/.test(identifier)) {
      throw new ApiError(500, `Unsafe SQL identifier: ${identifier}`);
    }
  }

  if (columns.length === 0) {
    const current = await client.query(
      `SELECT * FROM ${table} WHERE ${idColumn} = $1 AND organization_id = $2`,
      [id, organizationId],
    );
    return current.rows[0];
  }

  const setSql = columns.map((column, index) => `${column} = $${index + 1}`).join(", ");
  const params = [...columns.map((column) => values[column]), id, organizationId];
  const result = await client.query(
    `
    UPDATE ${table}
    SET ${setSql}
    WHERE ${idColumn} = $${columns.length + 1} AND organization_id = $${columns.length + 2}
    RETURNING *
    `,
    params,
  );
  if (result.rowCount === 0) {
    // RLS hides the row from this role's UPDATE policy.
    throw new ApiError(403, "Your role can't change this record");
  }
  return result.rows[0];
}

/** Writes one audit entry. An update with no changes writes nothing. */
export async function recordAudit(
  client: PoolClient,
  actor: AuthContext,
  entry: {
    entityType: AuditEntityType;
    entityId: string;
    action: AuditAction;
    changes: AuditChanges;
  },
): Promise<void> {
  if (entry.action === "update" && Object.keys(entry.changes).length === 0) {
    return;
  }

  await client.query(
    `
    INSERT INTO audit_logs (
      id, entity_type, entity_id, action, changes, user_id, actor_role, api_key_id, impersonated, organization_id
    )
    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
    `,
    [
      crypto.randomUUID(),
      entry.entityType,
      entry.entityId,
      entry.action,
      JSON.stringify(entry.changes),
      actor.userId ?? null,
      actor.role,
      actor.apiKeyId ?? null,
      actor.impersonated ?? false,
      actor.organizationId,
    ],
  );
}
