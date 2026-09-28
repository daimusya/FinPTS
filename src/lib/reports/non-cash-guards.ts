import { prisma } from "@/lib/db";
import { toDecimal } from "@/lib/money";

/**
 * Проверки записей реестров «Основные средства» и «Займы и кредиты» перед
 * сохранением (DictionaryConfig.validateRecord). Главное — амортизация и
 * проценты входят в ОПиУ, поэтому изменение, которое задним числом поменяло
 * бы закрытый период, не сохраняется.
 */
type Row = Record<string, unknown>;

const asDate = (v: unknown): Date | null => (v instanceof Date ? v : v ? new Date(String(v)) : null);
const monthIndex = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();
const same = (a: unknown, b: unknown) => String(a ?? "") === String(b ?? "") || (a instanceof Date && b instanceof Date && a.getTime() === b.getTime());

/** Первый закрытый период не раньше месяца fromIndex (год × 12 + месяц − 1) — или null. */
async function closedPeriodFrom(fromIndex: number): Promise<string | null> {
  const closed = await prisma.accountingPeriod.findMany({ where: { status: "CLOSED" }, select: { year: true, month: true } });
  const hit = closed.map((p) => p.year * 12 + p.month - 1).filter((i) => i >= fromIndex).sort((a, b) => a - b)[0];
  return hit === undefined ? null : `${(hit % 12) + 1}.${Math.floor(hit / 12)}`;
}

async function expenseArticle(id: unknown): Promise<string | null> {
  const article = id ? await prisma.pnlArticle.findUnique({ where: { id: String(id) } }) : null;
  if (!article) return "Выберите статью ОПиУ";
  return article.type === "REVENUE" || article.type === "OTHER_INCOME" ? "Статья ОПиУ должна быть расходной, а не доходной" : null;
}

export async function validateFixedAssetRecord(data: Row, before: Row | null): Promise<string | null> {
  const life = Number(data.usefulLifeMonths);
  if (!Number.isInteger(life) || life < 1 || life > 600) return "Срок полезного использования — целое число месяцев от 1 до 600";
  if (!(toDecimal(String(data.cost ?? 0)).greaterThan(0))) return "Стоимость — положительная сумма";
  const commissioning = asDate(data.commissioningDate);
  if (!commissioning) return "Укажите дату ввода в эксплуатацию";
  const disposal = asDate(data.disposalDate);
  if (disposal && disposal < commissioning) return "Дата выбытия не может быть раньше даты ввода";
  const article = await expenseArticle(data.pnlArticleId);
  if (article) return article;

  const relevant = ["cost", "commissioningDate", "usefulLifeMonths", "disposalDate", "pnlArticleId", "organizationId", "departmentId"];
  if (before && relevant.every((f) => same(before[f], data[f] ?? before[f]))) return null;
  // Depreciation starts the month after commissioning; a changed disposal date shifts the end.
  const candidates = [commissioning, asDate(before?.commissioningDate)].filter(Boolean).map((d) => monthIndex(d!) + 1);
  for (const d of [disposal, asDate(before?.disposalDate)]) if (d) candidates.push(monthIndex(d) + 1);
  const closed = await closedPeriodFrom(Math.min(...candidates));
  return closed
    ? `Это изменение поменяет амортизацию закрытого периода ${closed}. Откройте период (Администрирование → Периоды) или внесите изменение датой после него`
    : null;
}

export async function validateCreditAgreementRecord(data: Row, before: Row | null): Promise<string | null> {
  const rate = toDecimal(String(data.annualRatePct ?? "x").replace(",", "."));
  if (rate.isNaN() || rate.lessThan(0) || rate.greaterThan(100)) return "Ставка — от 0 до 100 % годовых";
  const start = asDate(data.startDate);
  if (!start) return "Укажите дату начала начисления процентов";
  const end = asDate(data.endDate);
  if (end && end < start) return "Дата окончания не может быть раньше даты начала";
  const balanceArticle = data.balanceArticleId ? await prisma.balanceArticle.findUnique({ where: { id: String(data.balanceArticleId) } }) : null;
  if (!balanceArticle || balanceArticle.category !== "LIABILITY" || balanceArticle.systemCode) {
    return "Статья баланса займа — обязательство без системного кода (например, «Кредит Сбербанк»): по ней считается остаток долга";
  }
  const article = await expenseArticle(data.pnlArticleId);
  if (article) return article;

  const relevant = ["annualRatePct", "startDate", "endDate", "balanceArticleId", "pnlArticleId", "organizationId"];
  if (before && relevant.every((f) => same(before[f], data[f] ?? before[f]))) return null;
  const candidates = [start, asDate(before?.startDate)].filter(Boolean).map((d) => monthIndex(d!));
  for (const d of [end, asDate(before?.endDate)]) if (d) candidates.push(monthIndex(d));
  const closed = await closedPeriodFrom(Math.min(...candidates));
  return closed
    ? `Это изменение поменяет проценты закрытого периода ${closed}. Откройте период (Администрирование → Периоды) или внесите изменение датой после него`
    : null;
}
