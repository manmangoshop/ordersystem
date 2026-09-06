import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "manmango_admin";

function signature(payload: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET 必須至少 32 字元");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createAdminSession() {
  const expires = Date.now() + 8 * 60 * 60 * 1000;
  const payload = String(expires);
  return `${payload}.${signature(payload)}`;
}

export function verifyAdminSession(token?: string) {
  if (!token) return false;
  const [payload, supplied] = token.split(".");
  if (!payload || !supplied || Number(payload) < Date.now()) return false;
  const expected = signature(payload);
  if (expected.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

export async function isAdmin() {
  return verifyAdminSession((await cookies()).get(COOKIE_NAME)?.value);
}

export { COOKIE_NAME };
