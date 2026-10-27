import { NextFunction, Request, Response } from "express";
import { MulterError } from "multer";
import { ZodError } from "zod";

import { env } from "../../config/env.js";
import { ApiError } from "../errors/ApiError.js";
import { logger } from "../logger.js";

type PgError = {
  code?: string;
  detail?: string;
  message?: string;
  errno?: string | number;
  syscall?: string;
};

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): Response {
  if (error instanceof ZodError) {
    return res.status(400).json({
      message: "Validation error",
      issues: error.issues,
    });
  }

  if (error instanceof ApiError) {
    return res.status(error.status).json({
      message: error.message,
    });
  }
  if (error instanceof MulterError) {
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "File exceeds the maximum upload size"
        : error.code === "LIMIT_UNEXPECTED_FILE"
          ? "Unexpected file field or file type"
          : "File upload error";
    return res.status(400).json({ message });
  }

  const pgError = error as PgError;
  if (pgError?.code === "23505") {
    return res.status(409).json({
      message: "Duplicate record",
      detail: pgError.detail ?? null,
    });
  }

  if (pgError?.code === "23503") {
    return res.status(409).json({
      message: "Invalid reference",
      detail: pgError.detail ?? null,
    });
  }

  if (pgError?.code === "42P01") {
    return res.status(500).json({
      message: "Database schema is out of date. Run Prisma migrations.",
      request_id: _req.requestId ?? null,
      ...(env.nodeEnv === "development"
        ? { detail: pgError.message ?? null }
        : {}),
    });
  }

  if (pgError?.code === "28P01" || pgError?.code === "3D000") {
    return res.status(500).json({
      message: "Database connection configuration is invalid.",
      request_id: _req.requestId ?? null,
      ...(env.nodeEnv === "development"
        ? { detail: pgError.message ?? null }
        : {}),
    });
  }

  if (
    typeof pgError?.message === "string" &&
    (pgError.message.includes("ECONNREFUSED") ||
      pgError.message.includes("ENOTFOUND") ||
      pgError.message.includes("ETIMEDOUT"))
  ) {
    return res.status(503).json({
      message: "Database is unreachable.",
      request_id: _req.requestId ?? null,
      ...(env.nodeEnv === "development" ? { detail: pgError.message } : {}),
    });
  }

  logger.error("Unhandled error", {
    error,
    requestId: _req.requestId,
  });
  
  return res.status(500).json({
    message: "Internal server error",
    request_id: _req.requestId ?? null,
  });
}
