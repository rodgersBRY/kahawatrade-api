import { Router } from "express";

import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { shipmentsController } from "./shipments.controller.js";

export const shipmentsRouter = Router();

shipmentsRouter.post("/", asyncHandler(shipmentsController.createShipment.bind(shipmentsController)));
shipmentsRouter.get("/", asyncHandler(shipmentsController.listShipments.bind(shipmentsController)));
shipmentsRouter.patch(
  "/:shipmentId/status",
  asyncHandler(shipmentsController.updateStatus.bind(shipmentsController)),
);
shipmentsRouter.post(
  "/:shipmentId/documents/generate",
  asyncHandler(shipmentsController.generateDocuments.bind(shipmentsController)),
);
shipmentsRouter.get(
  "/:shipmentId/documents",
  asyncHandler(shipmentsController.listDocuments.bind(shipmentsController)),
);
shipmentsRouter.get(
  "/reference-data",
  asyncHandler(shipmentsController.getReferenceData.bind(shipmentsController)),
);
// Registered after "/reference-data" so that path never reads as an id.
shipmentsRouter.patch(
  "/:shipmentId",
  asyncHandler(shipmentsController.updateShipment.bind(shipmentsController)),
);
