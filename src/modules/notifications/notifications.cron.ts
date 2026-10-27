import cron from "node-cron";

import { EPSILON, toNumber } from "../../common/dbHelpers.js";
import { logger } from "../../common/logger.js";
import { env } from "../../config/env.js";
import { query } from "../../db/pool.js";
import { notificationsService } from "./notifications.service.js";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

let jobsRegistered = false;

type ContractRiskRow = {
  organization_id: string;
  contract_number: string;
  quantity_kg: string;
  allocated_kg: string;
  shipment_window_end: Date;
};

type ApiKeyExpiryRow = {
  organization_id: string;
  name: string;
  key_prefix: string;
  expires_at: Date;
  owner_email: string;
};

function daysUntil(dateInput: Date): number {
  return Math.floor((dateInput.getTime() - Date.now()) / MS_PER_DAY);
}

export async function sendContractRiskAlerts(): Promise<void> {
  const result = await query<ContractRiskRow>(
    `
    SELECT
      organization_id,
      contract_number,
      quantity_kg,
      allocated_kg,
      shipment_window_end
    FROM contracts
    WHERE status IN ('open', 'partially_fulfilled')
    `,
  );

  let alertsSent = 0;

  for (const row of result.rows) {
    const quantityKg = toNumber(row.quantity_kg);
    const allocatedKg = toNumber(row.allocated_kg);
    const unallocatedKg = Math.max(quantityKg - allocatedKg, 0);
    const daysToWindowClose = daysUntil(new Date(row.shipment_window_end));

    if (
      unallocatedKg > EPSILON &&
      daysToWindowClose <= env.contractRiskAlertWindowDays
    ) {
      await notificationsService.notifyContractRiskAlert({
        organizationId: row.organization_id,
        contractNumber: row.contract_number,
        daysToWindowClose,
        unallocatedKg,
      });
      
      alertsSent += 1;
    }
  }

  if (alertsSent > 0) {
    logger.info("Contract risk alerts dispatched", { alerts_sent: alertsSent });
  }
}

export async function sendApiKeyExpiryAlerts(): Promise<void> {
  const result = await query<ApiKeyExpiryRow>(
    `
    SELECT
      u.organization_id,
      ak.name,
      ak.key_prefix,
      ak.expires_at,
      u.email AS owner_email
    FROM api_keys ak
    JOIN users u ON u.id = ak.user_id
    WHERE ak.is_active = TRUE
      AND ak.revoked_at IS NULL
      AND u.is_active = TRUE
      AND ak.expires_at IS NOT NULL
      AND ak.expires_at > NOW()
      AND ak.expires_at <= NOW() + ($1::int * INTERVAL '1 day')
    ORDER BY ak.expires_at ASC
    `,
    [env.apiKeyExpiryAlertWindowDays],
  );

  let alertsSent = 0;

  for (const row of result.rows) {
    const expiresAt = new Date(row.expires_at);
    const daysToExpiry = Math.max(
      Math.ceil((expiresAt.getTime() - Date.now()) / MS_PER_DAY),
      0,
    );

    await notificationsService.notifyApiKeyExpiring({
      organizationId: row.organization_id,
      keyName: row.name,
      keyPrefix: row.key_prefix,
      expiresAt,
      daysToExpiry,
      ownerEmail: row.owner_email,
    });
    alertsSent += 1;
  }

  if (alertsSent > 0) {
    logger.info("API key expiry alerts dispatched", {
      alerts_sent: alertsSent,
    });
  }
}

function scheduleTask(
  name: string,
  schedule: string,
  task: () => Promise<void>,
): void {
  if (!cron.validate(schedule)) {
    logger.error("Invalid cron schedule. Notification task skipped", {
      task: name,
      schedule,
    });
    return;
  }

  cron.schedule(
    schedule,
    () => {
      void task().catch((error) => {
        logger.error("Notification cron task failed", { task: name, error });
      });
    },
    {
      timezone: env.notificationsCronTimezone,
    },
  );

  logger.info("Notification cron task scheduled", {
    task: name,
    schedule,
    timezone: env.notificationsCronTimezone,
  });
}

export function registerNotificationCrons(): void {
  if (jobsRegistered) {
    return;
  }
  jobsRegistered = true;

  if (!env.notificationsCronEnabled) {
    logger.info("Notification cron jobs are disabled by configuration");
    return;
  }

  scheduleTask(
    "contract_risk_alerts",
    env.contractRiskCronSchedule,
    sendContractRiskAlerts,
  );
  scheduleTask(
    "api_key_expiry_alerts",
    env.apiKeyExpiryCronSchedule,
    sendApiKeyExpiryAlerts,
  );
}
