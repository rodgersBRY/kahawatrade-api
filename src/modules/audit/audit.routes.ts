import { Router } from "express";

import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { auditController } from "./audit.controller.js";

export const auditRouter = Router();

auditRouter.get("/", asyncHandler(auditController.listEntityHistory.bind(auditController)));
