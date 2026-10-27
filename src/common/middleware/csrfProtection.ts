import { NextFunction, Request, Response } from "express";

import { csrfCookieName, verifyCsrfToken } from "../security/csrf.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_EXEMPT_PATHS = new Set([
  "/api/v1/auth/login",
  "/api/v1/auth/register",
  "/api/v1/auth/refresh",
  "/api/v1/auth/csrf-token",
]);

export function csrfProtection(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    next();

    return;
  }

  if (CSRF_EXEMPT_PATHS.has(req.path)) {
    next();

    return;
  }

  const origin = req.headers.origin;
  if (!origin) {
    // Non-browser clients (no Origin header) are not CSRF-vulnerable in the same way.
    next();

    return;
  }

  const headerTokenRaw = req.headers["x-csrf-token"];

  const headerToken = Array.isArray(headerTokenRaw)
    ? headerTokenRaw[0]
    : headerTokenRaw;

  const cookieToken = req.cookies?.[csrfCookieName] as string | undefined;

  verifyCsrfToken(headerToken, cookieToken);

  next();
}
