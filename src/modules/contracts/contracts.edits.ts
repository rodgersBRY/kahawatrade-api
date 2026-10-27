import {
  assertNotLocked,
  changedKeys,
  diffRows,
  recordAudit,
  updateColumns,
} from "../../common/audit.js";
import {
  EPSILON,
  ensureReference,
  nextContractStatus,
  refreshLotStatus,
  toNumber,
} from "../../common/dbHelpers.js";
import { ApiError } from "../../common/errors/ApiError.js";
import { withTransaction } from "../../db/pool.js";
import { AuthContext } from "../../types/auth.js";
import { ContractUpdateInput } from "./contracts.validation.js";

type Row = Record<string, unknown>;

// Fields the invoice and shipment documents use; fixed once anything ships.
const SHIPPED_LOCKED_FIELDS = ["contract_number", "buyer_id", "price_per_kg", "price_terms", "currency"];

function dateOnly(value: unknown): string {
  if (value instanceof Date) {
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${value.getFullYear()}-${month}-${day}`;
  }
  return String(value);
}

export async function updateContract(
  contractId: string,
  input: ContractUpdateInput,
  actor: AuthContext,
): Promise<Row> {
  return withTransaction(async (client) => {
    const result = await client.query(
      "SELECT * FROM contracts WHERE id = $1 AND organization_id = $2 FOR UPDATE",
      [contractId, actor.organizationId],
    );
    if (result.rowCount === 0) {
      throw new ApiError(404, "Contract not found");
    }
    const contract = result.rows[0];
    const changed = changedKeys(contract, input);
    if (changed.length === 0) {
      return contract;
    }
    if (String(contract.status) === "closed") {
      throw new ApiError(409, "Can't change a closed contract");
    }

    const usage = await client.query(
      `
      SELECT
        (SELECT COUNT(*)::int FROM allocations
          WHERE contract_id = $1 AND organization_id = $2 AND status <> 'cancelled') AS allocations,
        (SELECT COUNT(*)::int FROM shipments
          WHERE contract_id = $1 AND organization_id = $2) AS shipments
      `,
      [contractId, actor.organizationId],
    );
    if (Number(usage.rows[0].shipments) > 0) {
      assertNotLocked(changed, SHIPPED_LOCKED_FIELDS, "after the contract has shipments");
    }
    if (Number(usage.rows[0].allocations) > 0) {
      assertNotLocked(changed, ["grade_id"], "after lots are allocated to the contract");
    }

    const values: Row = {};
    for (const key of changed) {
      values[key] = input[key as keyof ContractUpdateInput];
    }

    if (changed.includes("quantity_kg")) {
      const quantity = Number(input.quantity_kg);
      const committed = Math.max(toNumber(contract.allocated_kg), toNumber(contract.shipped_kg));
      if (committed - quantity > EPSILON) {
        throw new ApiError(
          409,
          `Quantity can't be less than the ${committed} kg already allocated or shipped`,
        );
      }
      const status = nextContractStatus(toNumber(contract.shipped_kg), quantity, String(contract.status));
      if (status !== String(contract.status)) {
        values.status = status;
      }
    }

    const start = input.shipment_window_start ?? dateOnly(contract.shipment_window_start);
    const end = input.shipment_window_end ?? dateOnly(contract.shipment_window_end);
    if (new Date(`${start}T00:00:00.000Z`) > new Date(`${end}T00:00:00.000Z`)) {
      throw new ApiError(400, "shipment_window_start must be <= shipment_window_end");
    }

    if (changed.includes("buyer_id")) {
      await ensureReference(client, "buyers", String(input.buyer_id), "Buyer", actor.organizationId);
    }
    if (changed.includes("grade_id") && input.grade_id) {
      await ensureReference(client, "grades", input.grade_id, "Grade", actor.organizationId);
    }

    const updated = await updateColumns(client, "contracts", "id", contractId, actor.organizationId, values);
    await recordAudit(client, actor, {
      entityType: "contract",
      entityId: contractId,
      action: "update",
      changes: diffRows(contract, updated, Object.keys(values)),
    });
    return updated;
  }, actor);
}

/**
 * Cancels an allocation that hasn't shipped: the kg go back to the lot and
 * come off the contract's allocated total.
 */
export async function cancelAllocation(
  contractId: string,
  allocationId: string,
  actor: AuthContext,
): Promise<Row> {
  return withTransaction(async (client) => {
    const contractResult = await client.query(
      "SELECT * FROM contracts WHERE id = $1 AND organization_id = $2 FOR UPDATE",
      [contractId, actor.organizationId],
    );
    if (contractResult.rowCount === 0) {
      throw new ApiError(404, "Contract not found");
    }
    const contract = contractResult.rows[0];
    if (String(contract.status) === "closed") {
      throw new ApiError(409, "Can't change a closed contract");
    }

    const allocationResult = await client.query(
      "SELECT * FROM allocations WHERE id = $1 AND contract_id = $2 AND organization_id = $3 FOR UPDATE",
      [allocationId, contractId, actor.organizationId],
    );
    if (allocationResult.rowCount === 0) {
      throw new ApiError(404, "Allocation not found");
    }
    const allocation = allocationResult.rows[0];
    if (String(allocation.status) !== "allocated") {
      throw new ApiError(409, "Only allocations that haven't shipped can be cancelled");
    }
    const kg = toNumber(allocation.allocated_kg);

    const updatedAllocation = await updateColumns(
      client,
      "allocations",
      "id",
      allocationId,
      actor.organizationId,
      { status: "cancelled" },
    );
    const updatedContract = await updateColumns(
      client,
      "contracts",
      "id",
      contractId,
      actor.organizationId,
      { allocated_kg: Math.max(toNumber(contract.allocated_kg) - kg, 0) },
    );
    await client.query(
      "UPDATE lots SET weight_available_kg = weight_available_kg + $1 WHERE id = $2 AND organization_id = $3",
      [kg, allocation.lot_id, actor.organizationId],
    );
    await refreshLotStatus(client, String(allocation.lot_id), actor.organizationId);

    await recordAudit(client, actor, {
      entityType: "allocation",
      entityId: allocationId,
      action: "cancel",
      changes: diffRows(allocation, updatedAllocation, ["status"]),
    });
    await recordAudit(client, actor, {
      entityType: "contract",
      entityId: contractId,
      action: "update",
      changes: diffRows(contract, updatedContract, ["allocated_kg"]),
    });
    return updatedAllocation;
  }, actor);
}
