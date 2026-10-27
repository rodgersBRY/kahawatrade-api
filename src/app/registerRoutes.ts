import { Express } from "express";

import { authenticate, authorize } from "../common/middleware/auth.js";
import { ensureOrgActive } from "../common/middleware/ensureOrgActive.js";
import { idempotencyMiddleware } from "../common/middleware/idempotency.js";
import { auditRouter } from "../modules/audit/audit.routes.js";
import { authRouter } from "../modules/auth/auth.routes.js";
import { contractsRouter } from "../modules/contracts/contracts.routes.js";
import { costsRouter, profitabilityRouter } from "../modules/finance/finance.routes.js";
import { inventoryRouter } from "../modules/inventory/inventory.routes.js";
import { masterRouter } from "../modules/master/master.routes.js";
import { internalRouter } from "../modules/internal/internal.routes.js";
import { procurementRouter } from "../modules/procurement/procurement.routes.js";
import { shipmentsRouter } from "../modules/shipments/shipments.routes.js";
import { traceabilityRouter } from "../modules/traceability/traceability.routes.js";
import { notificationsCronRouter } from "../modules/notifications/notifications.cron.routes.js";

export function registerRoutes(app: Express): void {
  app.use("/api/v1/cron", notificationsCronRouter);
  app.use("/api/internal/v1", internalRouter);
  app.use("/api/v1/auth", idempotencyMiddleware, authRouter);

  app.use(
    "/api/v1/master",
    authenticate,
    authorize("admin", "compliance"),
    ensureOrgActive,
    idempotencyMiddleware,
    masterRouter,
  );
  app.use(
    "/api/v1/procurement",
    authenticate,
    authorize("admin", "trader"),
    ensureOrgActive,
    idempotencyMiddleware,
    procurementRouter,
  );
  app.use(
    "/api/v1/inventory",
    authenticate,
    authorize("admin", "warehouse", "trader"),
    ensureOrgActive,
    idempotencyMiddleware,
    inventoryRouter,
  );
  app.use(
    "/api/v1/contracts",
    authenticate,
    authorize("admin", "trader"),
    ensureOrgActive,
    idempotencyMiddleware,
    contractsRouter,
  );
  app.use(
    "/api/v1/shipments",
    authenticate,
    authorize("admin", "trader", "warehouse", "compliance"),
    ensureOrgActive,
    idempotencyMiddleware,
    shipmentsRouter,
  );
  app.use(
    "/api/v1/costs",
    authenticate,
    authorize("admin", "finance"),
    ensureOrgActive,
    idempotencyMiddleware,
    costsRouter,
  );
  app.use(
    "/api/v1/profitability",
    authenticate,
    authorize("admin", "finance", "trader"),
    ensureOrgActive,
    idempotencyMiddleware,
    profitabilityRouter,
  );
  app.use(
    "/api/v1/traceability",
    authenticate,
    authorize("admin", "compliance", "trader"),
    ensureOrgActive,
    idempotencyMiddleware,
    traceabilityRouter,
  );
  // Per-entity role checks live in the audit service.
  app.use(
    "/api/v1/audit-logs",
    authenticate,
    authorize("admin", "trader", "warehouse", "finance", "compliance"),
    ensureOrgActive,
    auditRouter,
  );
}
