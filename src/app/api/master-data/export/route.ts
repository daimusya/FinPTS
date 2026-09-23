import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/session";
import { DICTIONARY_REGISTRY, getDictionaryConfig } from "@/lib/dictionaries/registry";
import { resolveSheetFields } from "@/lib/dictionaries/sheet-fields";
import { buildExportRows } from "@/lib/dictionaries/spreadsheet";
import { buildWorkbookBuffer } from "@/lib/reports/xlsx-export";

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

  const buffer = buildWorkbookBuffer([{ name: config.title, rows: buildExportRows(fields, items) }]);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${slug}.xlsx"`,
    },
  });
}
