import { parse as parseCookie } from "cookie";
import { COOKIE_NAME } from "@shared/const";

export function getSessionTokenFromRequest(request: { headers?: { cookie?: string; authorization?: string } }) {
  const headers = request.headers ?? {};
  const cookieToken = parseCookie(headers.cookie ?? "")[COOKIE_NAME];
  if (cookieToken) return cookieToken;
  const authorization = headers.authorization ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
}
