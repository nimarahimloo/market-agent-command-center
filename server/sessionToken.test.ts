import { describe, expect, it } from "vitest";
import { COOKIE_NAME } from "@shared/const";
import { getSessionTokenFromRequest } from "./sessionToken";

describe("getSessionTokenFromRequest", () => {
  it("prefers the authenticated session cookie", () => {
    expect(getSessionTokenFromRequest({ headers: { cookie: `${COOKIE_NAME}=cookie-token; other=value`, authorization: "Bearer bearer-token" } })).toBe("cookie-token");
  });

  it("supports the preview Bearer fallback", () => {
    expect(getSessionTokenFromRequest({ headers: { authorization: "Bearer bearer-token" } })).toBe("bearer-token");
  });

  it("returns an empty token when no supported credential exists", () => {
    expect(getSessionTokenFromRequest({ headers: {} })).toBe("");
  });
});
