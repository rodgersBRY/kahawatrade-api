import { Request, Response } from "express";

import { ApiError } from "../../common/errors/ApiError.js";
import { parseListQuery } from "../../common/pagination.js";
import { parseUuidParam } from "../../common/params.js";
import { updateLotPricing } from "../procurement/procurement.edits.js";
import { lotPricingUpdateSchema } from "../procurement/procurement.validation.js";
import { updateCostEntry } from "./finance.edits.js";
import { financeService } from "./finance.service.js";
import { costEntrySchema, costEntryUpdateSchema } from "./finance.validation.js";

export class FinanceController {
  private parseUuid(value: string | string[] | undefined, label: string): string {
    const rawValue = Array.isArray(value) ? value[0] : value;
    const raw = String(rawValue ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(raw)) {
      throw new ApiError(400, `Invalid ${label}`);
    }
    return raw;
  }

  async createCostEntry(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }
    const payload = costEntrySchema.parse(req.body);
    const costEntry = await financeService.createCostEntry(payload, req.auth);
    res.status(201).json(costEntry);
  }

  async listCostEntries(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }
    const query = parseListQuery(req.query as Record<string, unknown>, {
      allowedSortBy: ["category", "amount", "created_at"],
      defaultSortBy: "created_at",
    });
    res.json(await financeService.listCostEntries(query, req.auth));
  }

  async updateCostEntry(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }
    const entryId = parseUuidParam(req.params.entryId, "entryId");
    const payload = costEntryUpdateSchema.parse(req.body);
    res.json(await updateCostEntry(entryId, payload, req.auth));
  }

  async listLotPricing(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }
    const query = parseListQuery(req.query as Record<string, unknown>, {
      allowedSortBy: ["lot_code", "status", "purchase_price_per_kg", "created_at"],
      defaultSortBy: "created_at",
    });
    res.json(await financeService.listLotPricing(query, req.auth));
  }

  async updateLotPricing(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }
    const lotId = parseUuidParam(req.params.lotId, "lotId");
    const payload = lotPricingUpdateSchema.parse(req.body);
    res.json(await updateLotPricing(lotId, payload, req.auth));
  }

  async getContractProfitability(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }
    const contractId = this.parseUuid(req.params.contractId, "contractId");
    const data = await financeService.getContractProfitability(
      contractId,
      req.auth,
    );
    res.json(data);
  }

  async getReferenceData(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }
    const data = await financeService.getReferenceData(req.auth);
    res.json(data);
  }
}

export const financeController = new FinanceController();
