import argon2 from "argon2";

import { ApiError } from "../errors/ApiError.js";

const MIN_PASSWORD_LENGTH = 12;
const PASSWORD_COMPLEXITY_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).+$/;

export function validatePasswordStrength(password: string): void {
  if (process.env.NODE_ENV === "development" && password.length > 0) {
    return;
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ApiError(
      400,
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`,
    );
  }
  if (
    process.env.NODE_ENV !== "development" &&
    !PASSWORD_COMPLEXITY_REGEX.test(password)
  ) {
    throw new ApiError(
      400,
      "Password must include uppercase, lowercase, number, and special character",
    );
  }
}

export async function hashPassword(password: string): Promise<string> {
  validatePasswordStrength(password);
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPasswordHash(
  hash: string,
  password: string,
): Promise<boolean> {
  return argon2.verify(hash, password);
}
