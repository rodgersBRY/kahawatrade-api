import { NextFunction, Request, Response } from "express";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function sanitizeString(input: string): string {
  return input
    .replace(/\0/g, "") // Removes null bytes (\0) — prevents null byte injection attacks
    .replace(
      /[\u0000-\u001F\u007F]/g,
      "",
    ) /* Removes all ASCII control characters (\u0000–\u001F, \u007F) — strips things like newlines, tabs,
  backspace injected into input */
    .trim();
}

function sanitizeValue(value: unknown): JsonValue {
  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  /*  each key-value pair sanitized, and any key starting with $ is dropped entirely
     (NoSQL/MongoDB operator injection prevention, e.g. $where, $gt) */
  if (typeof value === "object" && value !== null) {
    const result: { [key: string]: JsonValue } = {};

    for (const [key, raw] of Object.entries(value)) {
      if (key.startsWith("$")) {
        continue;
      }

      const sanitizedKey = sanitizeString(key);

      result[sanitizedKey] = sanitizeValue(raw);
    }

    return result;
  }

  return String(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function overwriteObject(
  target: Record<string, unknown>,
  sanitized: Record<string, JsonValue>,
): void {
  for (const key of Object.keys(target)) {
    delete target[key];
  }

  for (const [key, value] of Object.entries(sanitized)) {
    target[key] = value;
  }
}

export function sanitizeInput(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  req.body = sanitizeValue(req.body);

  const sanitizedQuery = sanitizeValue(req.query);
  if (isPlainRecord(req.query) && isPlainRecord(sanitizedQuery)) {
    overwriteObject(req.query, sanitizedQuery);
  }

  const sanitizedParams = sanitizeValue(req.params);
  if (isPlainRecord(req.params) && isPlainRecord(sanitizedParams)) {
    overwriteObject(req.params, sanitizedParams);
  }

  next();
}
