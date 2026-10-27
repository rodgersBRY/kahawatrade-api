import crypto from "node:crypto";

import { NextFunction, Request, Response } from "express";

export function requestId(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const id = req.headers["x-request-id"] ?? crypto.randomUUID();

  const requestIdValue = Array.isArray(id) ? id[0] : id;

  req.requestId = requestIdValue;

  res.setHeader("x-request-id", requestIdValue);

  next();
}
