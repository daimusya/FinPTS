import Decimal from "decimal.js";
import { toDecimal, type MoneyInput } from "@/lib/money";
import { prisma } from "@/lib/db";
import { AccrualDocumentStatus, PayrollRunKind } from "@prisma/client";
import { enqueueProjectResultsForDocument } from "@/lib/integrations/project-results";

export interface PayrollLineForPosting {
  pnlArticleId: string | null;
  departmentId: string | null;
  projectId: string | null;
  employeeName: string;
  accrualTypeName: string;
  amount: MoneyInput;
  insuranceAmount: MoneyInput;
  /** Отпуск или больничный за счёт работодателя: первый день и число календарных дней. */
  absenceStart?: Date | null;
  absenceDays?: number | null;
}

export interface AccrualLineDraft {
  pnlArticleId: string;
  departmentId: string | null;
  projectId: string | null;
  amount: Decimal;
  description: string;
}

/**
 * Строит строки документа начисления (расход) из строк расчёта зарплаты.
 * Одна строка расчёта -> одна строка документа: сумма = начислено +
 * страховые взносы (оба — реальные затраты компании на этого сотрудника
 * по этому виду начисления). Взносы относятся на ту же статью ОПиУ, что
 * и само начисление — отдельной статьи «страховые взносы» в этой версии
 * нет (сознательное упрощение, см. README). Строки без статьи ОПиУ у вида
 * начисления пропускаются — по ним начисление остаётся ручным, как и
 * раньше.
 */
export function buildPayrollAccrualLines(lines: PayrollLineForPosting[]): AccrualLineDraft[] {
  const drafts: AccrualLineDraft[] = [];
  for (const line of lines) {
    if (!line.pnlArticleId) continue;
    const amount = toDecimal(line.amount).plus(toDecimal(line.insuranceAmount));
    if (amount.lessThanOrEqualTo(0)) continue;
    drafts.push({
      pnlArticleId: line.pnlArticleId,
      departmentId: line.departmentId,
      projectId: line.projectId,
      amount,
      description: `${line.employeeName} — ${line.accrualTypeName}`,
    });
  }
  return drafts;
}

const round2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/**
 * Делит сумму по месяцам календарных дней периода (отпуск с 25.09 на 14 дней
 * — 6 дней в сентябре и 8 в октябре); последняя часть добирает копейки.
 */
export function splitByMonthDays(amount: Decimal, start: Date, days: number): Array<{ year: number; month: number; days: number; amount: Decimal }> {
  const parts: Array<{ year: number; month: number; days: number; amount: Decimal }> = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i));
    const last = parts.at(-1);
    if (last && last.year === day.getUTCFullYear() && last.month === day.getUTCMonth() + 1) last.days += 1;
    else parts.push({ year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, days: 1, amount: new Decimal(0) });
  }
  let rest = amount;
  parts.forEach((part, i) => {
    part.amount = i === parts.length - 1 ? rest : round2(amount.times(part.days).dividedBy(days));
    rest = rest.minus(part.amount);
  });
  return parts;
}

/**
 * Дата расхода расчёта зарплаты в ОПиУ (метод начисления): окончательный
 * расчёт 10-го закрывает предыдущий месяц — расход последним днём этого
 * месяца; аванс и разовые выплаты — датой выплаты.
 */
export function accrualDateForRun(kind: PayrollRunKind | string, payoutDate: Date): Date {
  if (kind !== PayrollRunKind.FINAL) return payoutDate;
  return new Date(Date.UTC(payoutDate.getUTCFullYear(), payoutDate.getUTCMonth(), 0));
}

export interface PayrollAccrualDocuments {
  /** Строки основного документа — на дату расхода расчёта (accrualDateForRun). */
  main: AccrualLineDraft[];
  /** Части отпускных и больничных за дни следующих месяцев — по документу на месяц, датой 1-го числа. */
  later: Array<{ year: number; month: number; lines: AccrualLineDraft[] }>;
}

/**
 * Документы начисления расчёта зарплаты. Отпускные и больничные за счёт
 * работодателя относятся к месяцам дней отсутствия: доля дней месяца
 * основного документа и прошедших месяцев — в основной документ (прошедшие
 * периоды могут быть закрыты), доли следующих месяцев — в отдельные
 * документы этих месяцев. Остальные начисления — целиком в основной.
 */
export function buildPayrollAccrualDocuments(lines: PayrollLineForPosting[], accrualDate: Date): PayrollAccrualDocuments {
  const payoutIndex = accrualDate.getUTCFullYear() * 12 + accrualDate.getUTCMonth();
  const main: AccrualLineDraft[] = [];
  const later = new Map<number, AccrualLineDraft[]>();
  for (const line of lines) {
    const [draft] = buildPayrollAccrualLines([line]);
    if (!draft) continue;
    if (!line.absenceStart || !line.absenceDays || line.absenceDays < 1) {
      main.push(draft);
      continue;
    }
    const parts = splitByMonthDays(draft.amount, line.absenceStart, line.absenceDays);
    let now = new Decimal(0);
    const nowDays: number[] = [];
    for (const part of parts) {
      const index = part.year * 12 + part.month - 1;
      if (index <= payoutIndex) {
        now = now.plus(part.amount);
        nowDays.push(part.days);
        continue;
      }
      const list = later.get(index) ?? [];
      list.push({ ...draft, amount: part.amount, description: `${draft.description} (${part.days} дн. в ${String(part.month).padStart(2, "0")}.${part.year})` });
      later.set(index, list);
    }
    if (now.greaterThan(0)) {
      const total = nowDays.reduce((a, b) => a + b, 0);
      main.push({ ...draft, amount: now, description: total === line.absenceDays ? draft.description : `${draft.description} (${total} дн. из ${line.absenceDays})` });
    }
  }
  return {
    main,
    later: [...later.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, drafts]) => ({ year: Math.floor(index / 12), month: (index % 12) + 1, lines: drafts })),
  };
}

const PAYROLL_COUNTERPARTY_NAME = "Сотрудники (ФОТ)";

/**
 * У документа начисления обязателен контрагент, а сотрудники — не
 * контрагенты. Заводим единственную синтетическую запись-«клиринг» на всю
 * систему (не привязана к организации, как и остальные контрагенты) и
 * переиспользуем её для всех расчётов зарплаты всех организаций.
 */
async function getOrCreatePayrollCounterpartyId(): Promise<string> {
  const existing = await prisma.counterparty.findFirst({ where: { fullName: PAYROLL_COUNTERPARTY_NAME } });
  if (existing) return existing.id;
  const created = await prisma.counterparty.create({
    data: { fullName: PAYROLL_COUNTERPARTY_NAME, dataSource: "payroll-system" },
  });
  return created.id;
}

/**
 * Проводит утверждённый расчёт зарплаты в ОПиУ: документ начисления
 * (расход, статус «Проведён») на дату выплаты и, если отпуск или больничный
 * переходит на следующие месяцы, — документы этих месяцев с их частью
 * (buildPayrollAccrualDocuments). Идемпотентно — привязка к расчёту через
 * (sourceSystem, externalId): основной — id расчёта, части месяцев —
 * «id:ГГГГ-ММ»; повторный вызов ничего не создаст повторно. Если ни одна
 * строка расчёта не привязана к статье ОПиУ, документы не создаются вовсе.
 */
export async function postPayrollRunToAccrual(payrollRunId: string): Promise<string | null> {
  const existing = await prisma.accrualDocument.findFirst({
    where: { sourceSystem: "payroll", OR: [{ externalId: payrollRunId }, { externalId: { startsWith: `${payrollRunId}:` } }] },
    orderBy: { date: "asc" },
  });
  if (existing) return existing.id;

  const run = await prisma.payrollRun.findUniqueOrThrow({
    where: { id: payrollRunId },
    include: { lines: { include: { employee: true, accrualType: true } } },
  });

  const documents = buildPayrollAccrualDocuments(
    run.lines.map((l) => ({
      pnlArticleId: l.accrualType.pnlArticleId,
      departmentId: l.departmentId,
      projectId: l.projectId,
      employeeName: l.employee.fullName,
      accrualTypeName: l.accrualType.name,
      amount: l.amount,
      insuranceAmount: l.insuranceAmount,
      absenceStart: l.absenceStart,
      absenceDays: l.absenceDays,
    })),
    accrualDateForRun(run.kind, run.payoutDate),
  );
  if (documents.main.length === 0 && documents.later.length === 0) return null;
  const accrualDate = accrualDateForRun(run.kind, run.payoutDate);
  const periodOf = async (date: Date) =>
    (await prisma.accountingPeriod.findUnique({ where: { year_month: { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 } } }))?.id ?? null;

  const counterpartyId = await getOrCreatePayrollCounterpartyId();
  const base = `ФОТ-${accrualDate.toISOString().slice(0, 7)}-${run.id.slice(-6)}`;
  const create = (externalId: string, number: string, date: Date, periodId: string | null, comment: string, drafts: AccrualLineDraft[]) =>
    prisma.accrualDocument.create({
      data: {
        organizationId: run.organizationId,
        counterpartyId,
        number,
        date,
        documentType: "MANUAL",
        direction: "EXPENSE",
        status: AccrualDocumentStatus.POSTED,
        periodId,
        sourceSystem: "payroll",
        externalId,
        comment,
        lines: {
          create: drafts.map((d) => ({
            pnlArticleId: d.pnlArticleId,
            departmentId: d.departmentId,
            projectId: d.projectId,
            amount: d.amount,
            description: d.description,
          })),
        },
      },
    });

  const created: string[] = [];
  if (documents.main.length > 0) {
    const comment =
      run.kind === PayrollRunKind.FINAL
        ? `Автоматически создано при утверждении расчёта зарплаты; окончательный расчёт с выплатой ${run.payoutDate.toLocaleDateString("ru-RU", { timeZone: "UTC" })} — расход месяца, за который начислен`
        : "Автоматически создано при утверждении расчёта зарплаты";
    const doc = await create(run.id, base, accrualDate, await periodOf(accrualDate), comment, documents.main);
    created.push(doc.id);
  }
  for (const part of documents.later) {
    const month = `${part.year}-${String(part.month).padStart(2, "0")}`;
    const doc = await create(
      `${run.id}:${month}`,
      `${base}-${month}`,
      new Date(Date.UTC(part.year, part.month - 1, 1)),
      await periodOf(new Date(Date.UTC(part.year, part.month - 1, 1))),
      `Отпускные и больничные расчёта ${base} за дни ${String(part.month).padStart(2, "0")}.${part.year} — расход этого месяца`,
      part.lines,
    );
    created.push(doc.id);
  }

  for (const id of created) await enqueueProjectResultsForDocument(id);
  return created[0];
}

/**
 * Строки, которые не попадут (не попали) в документ начисления: у вида
 * начисления нет статьи ОПиУ. По видам — сколько строк и на какую сумму
 * (начислено + взносы), чтобы предупредить на странице расчёта.
 */
export function unpostedByType(
  lines: Array<{ accrualTypeName: string; pnlArticleId: string | null; amount: Decimal.Value; insuranceAmount: Decimal.Value }>,
): Array<{ name: string; count: number; total: Decimal }> {
  const byType = new Map<string, { count: number; total: Decimal }>();
  for (const line of lines) {
    if (line.pnlArticleId) continue;
    const entry = byType.get(line.accrualTypeName) ?? { count: 0, total: toDecimal(0) };
    entry.count += 1;
    entry.total = entry.total.plus(toDecimal(line.amount)).plus(toDecimal(line.insuranceAmount));
    byType.set(line.accrualTypeName, entry);
  }
  return [...byType.entries()].map(([name, v]) => ({ name, ...v }));
}
