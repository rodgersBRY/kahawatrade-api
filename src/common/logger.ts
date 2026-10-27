import { createLogger, format, transports } from "winston";
import util from "node:util";

import { env } from "../config/env.js";

const isDevelopment = env.nodeEnv === "development";

const devFormat = format.combine(
  format.colorize({ all: true }),
  format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  format.errors({ stack: true }),
  format.printf((info) => {
    const {
      timestamp,
      level,
      message,
      service,
      env: nodeEnv,
      stack,
      ...meta
    } = info;

    const metaPayload = Object.keys(meta).length
      ? ` ${util.inspect(meta, { colors: true, compact: true, breakLength: 140 })}`
      : "";

    const stackPayload = stack ? `\n${stack}` : "";

    return `${timestamp} [${service}/${nodeEnv}] ${level}: ${message}${metaPayload}${stackPayload}`;
  }),
);

const prodFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  format.json(),
);

export const logger = createLogger({
  level: env.logLevel,
  format: isDevelopment ? devFormat : prodFormat,
  defaultMeta: {
    service: "kahawatrade-api",
    env: env.nodeEnv,
  },
  transports: [new transports.Console()],
});
