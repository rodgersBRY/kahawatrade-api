import { Request, Response } from "express";

import { ApiError } from "../../common/errors/ApiError.js";
import { parseListQuery } from "../../common/pagination.js";
import { parseUuidParam } from "../../common/params.js";
import { cancelAllocation, updateContract } from "./contracts.edits.js";
import { contractsService } from "./contracts.service.js";
import {
  allocationSchema,
  contractSchema,
  contractUpdateSchema,
} from "./contracts.validation.js";

export class ContractsController {
  private parseUuid(value: string | string[] | undefined, label: string): string {
    const rawValue = Array.isArray(value) ? value[0] : value;
    const raw = String(rawValue ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(raw)) {
      throw new ApiError(400, `Invalid ${label}`);
    }
    return raw;
  }

  async createContract(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }
    const payload = contractSchema.parse(req.body);
    const contract = await contractsService.createContract(payload, req.auth);
    res.status(201).json(contract);
  }

  async allocateLot(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }
    const contractId = this.parseUuid(req.params.contractId, "contractId");
    const payload = allocationSchema.parse(req.body);
    const allocation = await contractsService.allocateLot(
      contractId,
      payload,
      req.auth,
    );
    res.status(201).json(allocation);
  }

  async getDashboard(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }
    const query = parseListQuery(req.query as Record<string, unknown>, {
      allowedSortBy: [
        "id",
        "contract_number",
        "status",
        "quantity_kg",
        "allocated_kg",
        "shipped_kg",
        "shipment_window_start",
        "shipment_window_end",
        "created_at",
      ],
      defaultSortBy: "created_at",
    });
    const dashboard = await contractsService.getDashboard(query, req.auth);
    res.json(dashboard);
  }

  async getReferenceData(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }
    const data = await contractsService.getReferenceData(req.auth);
    res.json(data);
  }

  async listContracts(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }
    const query = parseListQuery(req.query as Record<string, unknown>, {
      allowedSortBy: [
        "contract_number",
        "status",
        "quantity_kg",
        "shipment_window_start",
        "shipment_window_end",
        "created_at",
      ],
      defaultSortBy: "created_at",
    });
    res.json(await contractsService.listContracts(query, req.auth));
  }

  async updateContract(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }
    const contractId = parseUuidParam(req.params.contractId, "contractId");
    const payload = contractUpdateSchema.parse(req.body);
    res.json(await updateContract(contractId, payload, req.auth));
  }

  async listAllocations(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }
    const contractId = parseUuidParam(req.params.contractId, "contractId");
    const query = parseListQuery(req.query as Record<string, unknown>, {
      allowedSortBy: ["created_at", "allocated_kg", "status"],
      defaultSortBy: "created_at",
    });
    res.json(await contractsService.listAllocations(contractId, query, req.auth));
  }

  async cancelAllocation(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }
    const contractId = parseUuidParam(req.params.contractId, "contractId");
    const allocationId = parseUuidParam(req.params.allocationId, "allocationId");
    res.json(await cancelAllocation(contractId, allocationId, req.auth));
  }
}

export const contractsController = new ContractsController();
