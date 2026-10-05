import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { HIDDEN, auditChanges, entityLink, redactSecrets } from "./audit-view";

const id = "cmul5eggk000klgbsyfnidypl";

describe("redactSecrets", () => {
  it("hides password hashes, link codes, tokens and keys, keeps flags", () => {
    expect(
      redactSecrets({
        email: "a@b.ru",
        passwordHash: "$2b$10$abc",
        telegramLinkCode: "123456",
        smtp: { password: "p", passwordChanged: true, host: "smtp.ru" },
        apiKeyEnc: "enc",
        hasWebhook: true,
        roles: [{ token: "t" }],
      }),
    ).toEqual({
      email: "a@b.ru",
      passwordHash: HIDDEN,
      telegramLinkCode: HIDDEN,
      smtp: { password: HIDDEN, passwordChanged: true, host: "smtp.ru" },
      apiKeyEnc: HIDDEN,
      hasWebhook: true,
      roles: [{ token: HIDDEN }],
    });
    expect(redactSecrets(null)).toBeNull();
    const amount = new Prisma.Decimal("1500.50");
    expect(JSON.stringify(redactSecrets({ amount, passwordHash: "x" }))).toBe('{"amount":"1500.5","passwordHash":"[скрыто]"}');
  });
});

describe("auditChanges", () => {
  it("shows only changed fields of an update, without record timestamps", () => {
    expect(
      auditChanges(
        { fullName: "Иванов", isActive: true, updatedAt: "2026-10-01" },
        { fullName: "Иванов И.", isActive: true, updatedAt: "2026-10-05" },
      ),
    ).toEqual([{ field: "fullName", before: "Иванов", after: "Иванов И." }]);
  });

  it("creation lists the new values, deletion the old ones, secrets hidden", () => {
    expect(auditChanges(null, { name: "Склад", note: null })).toEqual([
      { field: "name", before: "—", after: "Склад" },
      { field: "note", before: "—", after: "—" },
    ]);
    expect(auditChanges({ amount: "100.00" }, null)).toEqual([{ field: "amount", before: "100.00", after: "—" }]);
    expect(auditChanges({ passwordHash: "old" }, { passwordHash: "new" })).toEqual([]);
  });

  it("dates and flags read naturally", () => {
    expect(auditChanges({ validFrom: "1919-10-01T00:00:00.000Z", isActive: true }, { validFrom: "2019-10-01T00:00:00.000Z", isActive: false })).toEqual([
      { field: "validFrom", before: "01.10.1919", after: "01.10.2019" },
      { field: "isActive", before: "да", after: "нет" },
    ]);
    expect(auditChanges(null, { decidedAt: "2026-10-05T10:30:00.000Z" })).toEqual([{ field: "decidedAt", before: "—", after: "05.10.2026, 13:30" }]);
  });

  it("long values are shortened", () => {
    const [change] = auditChanges(null, { purpose: "x".repeat(300) });
    expect(change.after).toHaveLength(121);
  });
});

describe("entityLink", () => {
  it("links records to their pages, dictionaries via their slug, summaries nowhere", () => {
    expect(entityLink("payment_request", id, {})).toBe(`/payment-requests/${id}`);
    expect(entityLink("bank_account", id, { bank_account: "bank-accounts" })).toBe(`/master-data/bank-accounts/${id}/edit`);
    expect(entityLink("bank_import_batch", id, {})).toBeNull();
    expect(entityLink("counterparty", "import", { counterparty: "counterparties" })).toBeNull();
  });
});
