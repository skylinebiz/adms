import jwt from "jsonwebtoken";
import { config } from "../config";

export interface AdminTokenPayload {
  sub: string;
  email: string;
  role: "SUPER_ADMIN" | "COMPANY_ADMIN";
  companyId: string | null;
}

const TOKEN_TTL = "12h";

export function signAdminToken(payload: AdminTokenPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: TOKEN_TTL });
}

export function verifyAdminToken(token: string): AdminTokenPayload {
  return jwt.verify(token, config.jwtSecret) as AdminTokenPayload;
}
