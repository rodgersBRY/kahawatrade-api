import { ApiError } from "./errors/ApiError.js";

/** Reads a UUID route param, or throws 400 naming the param. */
export function parseUuidParam(value: string | string[] | undefined, label: string): string {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const raw = String(rawValue ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(raw)) {
    throw new ApiError(400, `Invalid ${label}`);
  }
  return raw;
}
