import { Request, Response } from "express";

import { ApiError } from "../../common/errors/ApiError.js";
import { parseListQuery } from "../../common/pagination.js";
import { parseUuidParam } from "../../common/params.js";
import {
  updateAuctionLot,
  updateDirectAgreement,
  updateDirectDelivery,
} from "./procurement.edits.js";
import { procurementService } from "./procurement.service.js";
import {
  auctionLotSchema,
  auctionLotUpdateSchema,
  directAgreementSchema,
  directAgreementUpdateSchema,
  directDeliverySchema,
  directDeliveryUpdateSchema,
} from "./procurement.validation.js";

export class ProcurementController {
  async createAuctionLot(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }
    const payload = auctionLotSchema.parse(req.body);
    const lot = await procurementService.createAuctionLot(payload, req.auth);
    res.status(201).json(lot);
  }

  async createDirectAgreement(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }
    const payload = directAgreementSchema.parse(req.body);
    const agreement = await procurementService.createDirectAgreement(
      payload,
      req.auth,
    );
    res.status(201).json(agreement);
  }

  async listDirectAgreements(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }
    const query = parseListQuery(req.query as Record<string, unknown>, {
      allowedSortBy: ["id", "agreement_reference", "supplier_id", "crop_year", "created_at"],
      defaultSortBy: "created_at",
    });
    const agreements = await procurementService.listDirectAgreements(
      query,
      req.auth,
    );
    res.json(agreements);
  }

  async listAuctionLots(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }
    const query = parseListQuery(req.query as Record<string, unknown>, {
      allowedSortBy: [
        "id",
        "auction_lot_number",
        "sale_number",
        "outturn_number",
        "mark",
        "marketing_agent",
        "grade",
        "warehouse",
        "crop_year",
        "bags",
        "weight_total_kg",
        "weight_available_kg",
        "purchase_price_per_kg",
        "auction_fees_total",
        "status",
        "created_at",
      ],
      defaultSortBy: "created_at",
    });
    const lots = await procurementService.listAuctionLots(query, req.auth);
    res.json(lots);
  }

  async createDirectDelivery(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }
    const payload = directDeliverySchema.parse(req.body);
    const lot = await procurementService.createDirectDelivery(payload, req.auth);
    res.status(201).json(lot);
  }

  async listDirectDeliveries(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }
    const query = parseListQuery(req.query as Record<string, unknown>, {
      allowedSortBy: [
        "id",
        "delivery_reference",
        "lot_code",
        "agreement_reference",
        "supplier",
        "grade",
        "warehouse",
        "crop_year",
        "bags",
        "weight_total_kg",
        "weight_available_kg",
        "agreed_price_per_kg",
        "status",
        "received_at",
        "created_at",
      ],
      defaultSortBy: "created_at",
    });
    const deliveries = await procurementService.listDirectDeliveries(
      query,
      req.auth,
    );
    res.json(deliveries);
  }

  async getReferenceData(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }
    const data = await procurementService.getReferenceData(req.auth);
    res.json(data);
  }

  async updateAuctionLot(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }
    const lotId = parseUuidParam(req.params.lotId, "lotId");
    const payload = auctionLotUpdateSchema.parse(req.body);
    res.json(await updateAuctionLot(lotId, payload, req.auth));
  }

  async updateDirectDelivery(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }
    const deliveryId = parseUuidParam(req.params.deliveryId, "deliveryId");
    const payload = directDeliveryUpdateSchema.parse(req.body);
    res.json(await updateDirectDelivery(deliveryId, payload, req.auth));
  }

  async updateDirectAgreement(req: Request, res: Response): Promise<void> {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }
    const agreementId = parseUuidParam(req.params.agreementId, "agreementId");
    const payload = directAgreementUpdateSchema.parse(req.body);
    res.json(await updateDirectAgreement(agreementId, payload, req.auth));
  }
}

export const procurementController = new ProcurementController();
