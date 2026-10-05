import { describe, expect, it } from "vitest";
import { insecureRemoteLogin, isHttpsRequest } from "./request-security";

describe("isHttpsRequest", () => {
  it("follows the proxy's X-Forwarded-Proto, else the page origin", () => {
    expect(isHttpsRequest({ forwardedProto: "https" })).toBe(true);
    expect(isHttpsRequest({ forwardedProto: "http", origin: "https://fin.example.ru" })).toBe(false);
    expect(isHttpsRequest({ forwardedProto: "https, http" })).toBe(true);
    expect(isHttpsRequest({ origin: "https://fin.example.ru" })).toBe(true);
    expect(isHttpsRequest({ origin: "http://192.168.1.10:3000" })).toBe(false);
    expect(isHttpsRequest({ referer: "https://fin.example.ru/login" })).toBe(true);
    expect(isHttpsRequest({})).toBe(false);
  });
  it("COOKIE_SECURE overrides", () => {
    expect(isHttpsRequest({ setting: "always", origin: "http://x" })).toBe(true);
    expect(isHttpsRequest({ setting: "never", forwardedProto: "https" })).toBe(false);
  });
});

describe("insecureRemoteLogin", () => {
  it("warns about plain http from another machine only", () => {
    expect(insecureRemoteLogin({ https: false, host: "192.168.1.10:3000" })).toBe(true);
    expect(insecureRemoteLogin({ https: false, host: "localhost:3000" })).toBe(false);
    expect(insecureRemoteLogin({ https: false, host: "127.0.0.1" })).toBe(false);
    expect(insecureRemoteLogin({ https: true, host: "fin.example.ru" })).toBe(false);
  });
});
