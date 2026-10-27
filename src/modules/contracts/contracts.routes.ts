import { Router } from "express";

import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { contractsController } from "./contracts.controller.js";

export const contractsRouter = Router();

contractsRouter.post("/", asyncHandler(contractsController.createContract.bind(contractsController)));
contractsRouter.get("/", asyncHandler(contractsController.listContracts.bind(contractsController)));
contractsRouter.post(
  "/:contractId/allocations",
  asyncHandler(contractsController.allocateLot.bind(contractsController)),
);
contractsRouter.get(
  "/dashboard",
  asyncHandler(contractsController.getDashboard.bind(contractsController)),
);
contractsRouter.get(
  "/reference-data",
  asyncHandler(contractsController.getReferenceData.bind(contractsController)),
);
// Registered after the fixed paths above so "/dashboard" never reads as an id.
contractsRouter.patch(
  "/:contractId",
  asyncHandler(contractsController.updateContract.bind(contractsController)),
);
contractsRouter.get(
  "/:contractId/allocations",
  asyncHandler(contractsController.listAllocations.bind(contractsController)),
);
contractsRouter.post(
  "/:contractId/allocations/:allocationId/cancel",
  asyncHandler(contractsController.cancelAllocation.bind(contractsController)),
);
