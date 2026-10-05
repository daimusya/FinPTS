import { describe, expect, it } from "vitest";
import { securityHeaders } from "./security-headers";

const byKey = (production: boolean) => Object.fromEntries(securityHeaders(production).map((h) => [h.key, h.value]));

describe("securityHeaders", () => {
  it("forbids framing, MIME sniffing, foreign form targets and leaking addresses", () => {
    const h = byKey(false);
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["Content-Security-Policy"]).toContain("form-action 'self'");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("same-origin");
  });

  it("does not block Next.js inline scripts", () => {
    expect(byKey(true)["Content-Security-Policy"]).not.toMatch(/script-src|default-src/);
  });

  it("HSTS only in production", () => {
    expect(byKey(false)["Strict-Transport-Security"]).toBeUndefined();
    expect(byKey(true)["Strict-Transport-Security"]).toBe("max-age=15552000");
  });
});
