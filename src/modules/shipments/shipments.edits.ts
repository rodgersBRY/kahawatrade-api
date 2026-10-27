import {
  assertNotLocked,
  changedKeys,
  diffRows,
  recordAudit,
  updateColumns,
} from "../../common/audit.js";
import { ApiError } from "../../common/errors/ApiError.js";
import { withTransaction } from "../../db/pool.js";
import { AuthContext } from "../../types/auth.js";
import { ShipmentUpdateInput } from "./shipments.validation.js";

type Row = Record<string, unknown>;

const DEPARTED_STATUSES = ["on_vessel", "completed"];

export async function updateShipment(
  shipmentId: string,
  input: ShipmentUpdateInput,
  actor: AuthContext,
): Promise<Row> {
  return withTransaction(async (client) => {
    const result = await client.query(
      "SELECT * FROM shipments WHERE id = $1 AND organization_id = $2 FOR UPDATE",
      [shipmentId, actor.organizationId],
    );
    if (result.rowCount === 0) {
      throw new ApiError(404, "Shipment not found");
    }
    const shipment = result.rows[0];
    const changed = changedKeys(shipment, input);
    if (changed.length === 0) {
      return shipment;
    }

    const status = String(shipment.status);
    if (status === "completed") {
      assertNotLocked(changed, changed, "after the shipment is completed");
    }
    if (DEPARTED_STATUSES.includes(status)) {
      assertNotLocked(
        changed,
        ["container_number", "seal_number", "planned_departure"],
        "after the shipment is on the vessel",
      );
    }
    if (changed.includes("shipment_number")) {
      if (status !== "planned") {
        assertNotLocked(changed, ["shipment_number"], "after the shipment leaves the planned stage");
      }
      const docs = await client.query(
        "SELECT COUNT(*)::int AS count FROM shipment_documents WHERE shipment_id = $1 AND organization_id = $2",
        [shipmentId, actor.organizationId],
      );
      if (Number(docs.rows[0].count) > 0) {
        assertNotLocked(changed, ["shipment_number"], "after shipment documents are generated");
      }
    }

    const values: Row = {};
    for (const key of changed) {
      values[key] = input[key as keyof ShipmentUpdateInput];
    }
    let updated = await updateColumns(client, "shipments", "id", shipmentId, actor.organizationId, values);

    if (changed.includes("shipment_number")) {
      // Keep the traceability snapshot's copy of the number in step.
      const snapshot = await client.query(
        `
        UPDATE shipments
        SET traceability_snapshot = jsonb_set(traceability_snapshot, '{shipment_number}', to_jsonb($1::text))
        WHERE id = $2 AND organization_id = $3 AND traceability_snapshot ? 'shipment_number'
        RETURNING *
        `,
        [input.shipment_number, shipmentId, actor.organizationId],
      );
      updated = snapshot.rows[0] ?? updated;
    }

    await recordAudit(client, actor, {
      entityType: "shipment",
      entityId: shipmentId,
      action: "update",
      changes: diffRows(shipment, updated, changed),
    });
    return updated;
  }, actor);
}
