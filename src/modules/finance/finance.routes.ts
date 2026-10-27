import { Router } from "express";

import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { financeController } from "./finance.controller.js";

export const costsRouter = Router();
export const profitabilityRouter = Router();

costsRouter.post(
  "/entries",
  asyncHandler(financeController.createCostEntry.bind(financeController)),
);
costsRouter.get(
  "/entries",
  asyncHandler(financeController.listCostEntries.bind(financeController)),
);
costsRouter.patch(
  "/entries/:entryId",
  asyncHandler(financeController.updateCostEntry.bind(financeController)),
);
costsRouter.get(
  "/lots",
  asyncHandler(financeController.listLotPricing.bind(financeController)),
);
costsRouter.patch(
  "/lots/:lotId",
  asyncHandler(financeController.updateLotPricing.bind(financeController)),
);
costsRouter.get(
  "/reference-data",
  asyncHandler(financeController.getReferenceData.bind(financeController)),
);

profitabilityRouter.get(
  "/contracts/:contractId",
  asyncHandler(financeController.getContractProfitability.bind(financeController)),
);
profitabilityRouter.get(
  "/reference-data",
  asyncHandler(financeController.getReferenceData.bind(financeController)),
);
