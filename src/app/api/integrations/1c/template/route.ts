import { requirePermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { buildWorkbookBuffer } from "@/lib/reports/xlsx-export";
import { ONEC_MAPPING_LABELS, ONEC_REQUIRED_TARGETS } from "@/lib/integrations/onec-mapping";

export async function GET() {
  try {
    await requirePermission(PERMISSIONS.INTEGRATIONS_MANAGE);
  } catch {
    return new Response("Недостаточно прав", { status: 403 });
  }

  const headerRow = ONEC_REQUIRED_TARGETS.map((t) => ONEC_MAPPING_LABELS[t]);
  const exampleRow = [
    "1C-DOC-000123",
    "7700000000",
    "7701234567",
    "SALE",
    "INCOME",
    "РЕАЛ-1",
    "15.09.2026",
    "100000",
    "Выручка от реализации",
  ];

  const buffer = buildWorkbookBuffer([{ name: "Шаблон 1С", rows: [headerRow, exampleRow] }]);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="1c_import_template.xlsx"',
    },
  });
}
