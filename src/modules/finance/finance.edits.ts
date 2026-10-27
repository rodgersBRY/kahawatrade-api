import { changedKeys, diffRows, recordAudit, updateColumns } from "../../common/audit.js";
import { ApiError } from "../../common/errors/ApiError.js";
import { withTransaction } from "../../db/pool.js";
import { AuthContext } from "../../types/auth.js";
import { CostEntryUpdateInput } from "./finance.validation.js";

type Row = Record<string, unknown>;

/** Cost amounts and notes stay editable; the lot or shipment link does not. */
export async function updateCostEntry(
  entryId: string,
  input: CostEntryUpdateInput,
  actor: AuthContext,
): Promise<Row> {
  return withTransaction(async (client) => {
    const result = await client.query(
      "SELECT * FROM cost_entries WHERE id = $1 AND organization_id = $2 FOR UPDATE",
      [entryId, actor.organizationId],
    );
    if (result.rowCount === 0) {
      throw new ApiError(404, "Cost entry not found");
    }
    const entry = result.rows[0];
    const changed = changedKeys(entry, input);
    if (changed.length === 0) {
      return entry;
    }

    const values: Row = {};
    for (const key of changed) {
      values[key] = input[key as keyof CostEntryUpdateInput];
    }
    const updated = await updateColumns(client, "cost_entries", "id", entryId, actor.organizationId, values);

    await recordAudit(client, actor, {
      entityType: "cost_entry",
      entityId: entryId,
      action: "update",
      changes: diffRows(entry, updated, changed),
    });
    return updated;
  }, actor);
}
