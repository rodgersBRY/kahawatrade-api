import crypto from "node:crypto";

import { Response } from "express";

import { env } from "../../config/env.js";
import { ApiError } from "../errors/ApiError.js";

const COOKIE_NAME = "kahawatrade_csrf";

function signToken(rawToken: string): string {
  return crypto
    .createHmac("sha256", env.csrfSecret)
    .update(rawToken)
    .digest("base64url");
}

function buildToken(): string {
  const raw = crypto.randomBytes(24).toString("base64url");

  const signature = signToken(raw);

  return `${raw}.${signature}`;
}

function validateTokenShape(token: string): boolean {
  const [raw, signature] = token.split(".");
  if (!raw || !signature) {
    return false;
  }

  const expected = signToken(raw);

  return crypto.timingSafeEqual(
    Buffer.from(signature, "utf-8"),
    Buffer.from(expected, "utf-8"),
  );
}

export function issueCsrfToken(res: Response): string {
  const token = buildToken();

  res.cookie(COOKIE_NAME, token, {
    httpOnly: false,
    secure: env.nodeEnv === "production",
    sameSite: "strict",
    path: "/",
  });

  return token;
}

export function verifyCsrfToken(
  headerToken: string | undefined,
  cookieToken: string | undefined,
): void {
  if (!headerToken || !cookieToken) {
    throw new ApiError(403, "CSRF token is required");
  }

  if (!validateTokenShape(headerToken) || !validateTokenShape(cookieToken)) {
    throw new ApiError(403, "Invalid CSRF token");
  }
  
  if (
    !crypto.timingSafeEqual(
      Buffer.from(headerToken, "utf-8"),
      Buffer.from(cookieToken, "utf-8"),
    )
  ) {
    throw new ApiError(403, "CSRF token mismatch");
  }
}

export const csrfCookieName = COOKIE_NAME;
