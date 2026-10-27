import { NextFunction, Request, RequestHandler, Response } from "express";

import { ApiError } from "../errors/ApiError.js";
import { verifyAccessToken } from "../security/jwt.js";
import { hashSha256 } from "../security/crypto.js";
import { query } from "../../db/pool.js";
import { AuthContext, UserRole } from "../../types/auth.js";

type UserRow = {
  id: string;
  role: UserRole;
  is_active: boolean;
  organization_id: string;
};

type ApiKeyRow = {
  id: string;
  user_id: string;
  role: UserRole;
  organization_id: string;
};

function parseBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

export const authenticate: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  void resolveAuthContext(req)
    .then((auth) => {
      if (!auth) {
        throw new ApiError(401, "Authentication required");
      }

      req.auth = auth;

      next();
    })
    .catch(next);
};

export const authenticateOptional: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  void resolveAuthContext(req)
    .then((auth) => {
      req.auth = auth;

      next();
    })
    .catch(next);
};

async function resolveAuthContext(req: Request): Promise<AuthContext | undefined> {
  const bearer = parseBearerToken(req.headers.authorization);

  if (bearer) {
    const claims = verifyAccessToken(bearer);

    const userResult = await query<UserRow>(
      "SELECT id, role, is_active, organization_id FROM users WHERE id = $1",
      [claims.sub],
    );

    if (userResult.rowCount === 0 || !userResult.rows[0].is_active) {
      throw new ApiError(401, "User is inactive or missing");
    }
    if (userResult.rows[0].organization_id !== claims.organizationId) {
      throw new ApiError(401, "Organization mismatch");
    }

    const auth: AuthContext = {
      authType: "jwt",
      userId: userResult.rows[0].id,
      role: userResult.rows[0].role,
      organizationId: userResult.rows[0].organization_id,
      sessionId: claims.sessionId,
      impersonated: claims.impersonated === true,
    };

    return auth;
  }

  const apiKeyHeader = req.headers["x-api-key"];

  const apiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
  if (apiKey) {
    const keyHash = hashSha256(apiKey);

    const result = await query<ApiKeyRow>(
      `
      SELECT
        ak.id,
        ak.user_id,
        u.role,
        u.organization_id
      FROM api_keys ak
      JOIN users u ON u.id = ak.user_id
      WHERE ak.key_hash = $1
        AND ak.is_active = TRUE
        AND ak.revoked_at IS NULL
        AND (ak.expires_at IS NULL OR ak.expires_at > NOW())
        AND u.is_active = TRUE
      `,
      [keyHash],
    );

    if (result.rowCount === 0) {
      throw new ApiError(401, "Invalid API key");
    }

    const row = result.rows[0];

    await query("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", [row.id]);

    const auth: AuthContext = {
      authType: "api_key",
      userId: row.user_id,
      role: row.role,
      organizationId: row.organization_id,
      apiKeyId: row.id,
    };

    return auth;
  }

  return undefined;
}

export function authorize(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      throw new ApiError(401, "Authentication required");
    }

    if (!allowedRoles.includes(req.auth.role)) {
      throw new ApiError(403, "Insufficient permissions");
    }
    
    next();
  };
}
