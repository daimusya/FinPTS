import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/session";
import { DICTIONARY_REGISTRY, getDictionaryConfig } from "@/lib/dictionaries/registry";
import { resolveSheetFields } from "@/lib/dictionaries/sheet-fields";
import { buildExportRows } from "@/lib/dictionaries/spreadsheet";
import { buildWorkbookBuffer, type ExportSheet } from "@/lib/reports/xlsx-export";
import { prisma } from "@/lib/db";
import { BANK_SHEET, CONTACT_SHEET, buildBankDetailRows, buildContactRows } from "@/lib/counterparties/details-sheets";

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug") ?? "";
  if (!DICTIONARY_REGISTRY[slug]) return new Response("Неизвестный справочник", { status: 400 });
  const config = getDictionaryConfig(slug);

  try {
    await requirePermission(config.permissionView);
  } catch {
    return new Response("Недостаточно прав", { status: 403 });
  }

  const [fields, items] = await Promise.all([
    resolveSheetFields(config),
    config.delegate.findMany({ orderBy: config.orderBy ?? { name: "asc" } }),
  ]);

  const sheets: ExportSheet[] = [{ name: config.title, rows: buildExportRows(fields, items) }];
  // Counterparties also carry their bank details and contacts — on separate sheets that import reads back.
  if (slug === "counterparties") {
    const owner = { select: { id: true, inn: true, fullName: true, shortName: true } } as const;
    const [bankDetails, contacts] = await Promise.all([
      prisma.counterpartyBankDetail.findMany({ include: { counterparty: owner }, orderBy: [{ counterpartyId: "asc" }, { isPrimary: "desc" }, { createdAt: "asc" }] }),
      prisma.counterpartyContact.findMany({ include: { counterparty: owner }, orderBy: [{ counterpartyId: "asc" }, { name: "asc" }] }),
    ]);
    sheets.push({ name: BANK_SHEET, rows: buildBankDetailRows(bankDetails) }, { name: CONTACT_SHEET, rows: buildContactRows(contacts) });
  }
  const buffer = buildWorkbookBuffer(sheets);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${slug}.xlsx"`,
    },
  });
}
