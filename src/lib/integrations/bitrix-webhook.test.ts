import { describe, expect, it } from "vitest";
import { bitrixWebhookProblem } from "./bitrix-webhook";

describe("bitrixWebhookProblem", () => {
  it("accepts an incoming webhook of a cloud or on-premise portal", () => {
    expect(bitrixWebhookProblem("https://pts.bitrix24.ru/rest/1/abc123xyz/")).toBeNull();
    expect(bitrixWebhookProblem("https://crm.example.ru/rest/15/Q1w2E3r4")).toBeNull();
    expect(bitrixWebhookProblem("http://192.168.1.10/rest/1/abc123/")).toBeNull();
  });
  it("refuses text that is not a link, other schemes, credentials in the link and other pages", () => {
    expect(bitrixWebhookProblem("pts.bitrix24.ru/rest/1/abc/")).toMatch(/не похож на ссылку/);
    expect(bitrixWebhookProblem("ftp://pts.bitrix24.ru/rest/1/abc/")).toMatch(/https/);
    expect(bitrixWebhookProblem("https://user:pass@pts.bitrix24.ru/rest/1/abc/")).toMatch(/логина и пароля/);
    expect(bitrixWebhookProblem("https://pts.bitrix24.ru/crm/deal/list/")).toMatch(/не адрес входящего вебхука/);
    expect(bitrixWebhookProblem("https://pts.bitrix24.ru/rest/abc/")).toMatch(/не адрес входящего вебхука/);
  });
});
