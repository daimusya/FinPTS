import { requirePermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { buildWorkbookBuffer } from "@/lib/reports/xlsx-export";
import { ONEC_MAPPING_LABELS, ONEC_REQUIRED_TARGETS, type OnecMappingTarget } from "@/lib/integrations/onec-mapping";

const OPTIONAL_COLUMNS: OnecMappingTarget[] = ["vatAmount", "lineDescription", "projectName", "productServiceName"];

export async function GET() {
  try {
    await requirePermission(PERMISSIONS.INTEGRATIONS_MANAGE);
  } catch {
    return new Response("Недостаточно прав", { status: 403 });
  }

  const columns = [...ONEC_REQUIRED_TARGETS, ...OPTIONAL_COLUMNS];
  const headerRow = columns.map((t) => ONEC_MAPPING_LABELS[t]);
  const example = (values: Partial<Record<OnecMappingTarget, string>>) => columns.map((t) => values[t] ?? "");
  const header = {
    organizationInn: "7700000000",
    counterpartyInn: "7701234567",
    documentType: "ACT",
    direction: "INCOME",
    number: "АКТ-15",
    date: "15.09.2026",
  };

  // One document with two lines: the same external ID on both rows; the header may repeat or stay blank.
  const rows = [
    headerRow,
    example({ externalId: "1C-DOC-000123", ...header, amount: "100000", vatAmount: "", pnlArticleCode: "Выручка от реализации", lineDescription: "Обучение по охране труда" }),
    example({ externalId: "1C-DOC-000123", amount: "45000", pnlArticleCode: "Выручка от реализации", lineDescription: "Специальная оценка условий труда" }),
    example({
      externalId: "1C-DOC-000124",
      ...header,
      number: "АКТ-16",
      amount: "30000",
      pnlArticleCode: "Выручка от реализации",
      lineDescription: "Консультация",
    }),
  ];

  const buffer = buildWorkbookBuffer([{ name: "Шаблон 1С", rows }]);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="1c_import_template.xlsx"',
    },
  });
}
