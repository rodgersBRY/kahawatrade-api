import crypto from "node:crypto";

import { env } from "../../config/env.js";

type EncryptedPayload = {
  iv: string;
  tag: string;
  value: string;
};

const encryptionKey = Buffer.from(env.dataEncryptionKey, "base64");
if (encryptionKey.length !== 32) {
  throw new Error(
    "DATA_ENCRYPTION_KEY must decode to exactly 32 bytes (base64)",
  );
}

export function encryptSensitiveText(plaintext: string): string {
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  const payload: EncryptedPayload = {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    value: encrypted.toString("base64"),
  };

  return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64");
}

export function decryptSensitiveText(ciphertext: string): string {
  const decoded = Buffer.from(ciphertext, "base64").toString("utf-8");

  const payload = JSON.parse(decoded) as EncryptedPayload;

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey,
    Buffer.from(payload.iv, "base64"),
  );

  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.value, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf-8");
}

export function hashSha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function secureRandomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}
