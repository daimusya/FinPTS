import { PrismaClient, CashFlowDirection } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { ROLE_DEFINITIONS, PERMISSIONS, PERMISSION_LABELS } from "../src/lib/permissions";

const prisma = new PrismaClient();

const INITIAL_DEPARTMENTS = [
  "Отдел охраны труда",
  "Отдел обучения",
  "Финансовый отдел и HR",
  "Проектный отдел",
  "Отдел продаж",
  "Администрация",
];

const INITIAL_DIRECTIONS = [
  "Обучение",
  "Аутсорсинг охраны труда",
  "Разовая разработка документов",
  "Комплексная разработка документов",
  "Разработка планов эвакуации",
  "Проектирование и монтаж пожарных систем",
];

const INITIAL_CASH_FLOW_ARTICLES: Array<{ name: string; direction: CashFlowDirection }> = [
  { name: "Поступления от клиентов", direction: CashFlowDirection.INFLOW },
  { name: "Возврат от поставщика", direction: CashFlowDirection.INFLOW },
  { name: "Оплата поставщикам", direction: CashFlowDirection.OUTFLOW },
  { name: "Выплата заработной платы", direction: CashFlowDirection.OUTFLOW },
  { name: "Налоги и взносы", direction: CashFlowDirection.OUTFLOW },
  { name: "Подписка на ПО WA", direction: CashFlowDirection.OUTFLOW },
  { name: "РТН — подрядчик", direction: CashFlowDirection.OUTFLOW },
  { name: "ППР — оплата подрядчику за план производства работ", direction: CashFlowDirection.OUTFLOW },
  { name: "ЦДС — посредник", direction: CashFlowDirection.OUTFLOW },
  { name: "Перевод между своими счетами", direction: CashFlowDirection.TRANSFER },
];

const INITIAL_PNL_ARTICLES: Array<{ name: string; type: "REVENUE" | "DIRECT_VARIABLE" | "DIRECT_FIXED" | "INDIRECT" | "OTHER_INCOME" | "OTHER_EXPENSE" | "TAX" }> = [
  { name: "Выручка от реализации", type: "REVENUE" },
  { name: "Прямые переменные расходы", type: "DIRECT_VARIABLE" },
  { name: "Прямые постоянные расходы", type: "DIRECT_FIXED" },
  { name: "Косвенные расходы", type: "INDIRECT" },
  { name: "Расходы на оплату труда", type: "DIRECT_FIXED" },
  { name: "Прочие доходы", type: "OTHER_INCOME" },
  { name: "Прочие расходы", type: "OTHER_EXPENSE" },
  { name: "Налог на прибыль / УСН", type: "TAX" },
];

const INITIAL_TAX_RULES: Array<{ name: string; code: string; base: string; ratePct: number }> = [
  { name: "НДФЛ", code: "ndfl_13", base: "ndfl", ratePct: 13 },
  { name: "Пенсионное страхование", code: "pension_22", base: "pension", ratePct: 22 },
  { name: "Медицинское страхование", code: "medical_5_1", base: "medical", ratePct: 5.1 },
  { name: "Социальное страхование", code: "social_2_9", base: "social", ratePct: 2.9 },
  { name: "Травматизм", code: "injury_0_2", base: "injury", ratePct: 0.2 },
];

const INITIAL_PAYROLL_ACCRUAL_TYPES: Array<{
  name: string;
  code: string;
  subjectToNdfl: boolean;
  subjectToInsurance: boolean;
  affectsAvgEarnings: boolean;
  paymentMethod: "CASH" | "BANK" | "MIXED";
}> = [
  { name: "Оклад", code: "salary", subjectToNdfl: true, subjectToInsurance: true, affectsAvgEarnings: true, paymentMethod: "BANK" },
  { name: "Аванс", code: "advance", subjectToNdfl: true, subjectToInsurance: true, affectsAvgEarnings: true, paymentMethod: "BANK" },
  { name: "Премия", code: "bonus", subjectToNdfl: true, subjectToInsurance: true, affectsAvgEarnings: true, paymentMethod: "BANK" },
  { name: "Проектная доплата", code: "project_bonus", subjectToNdfl: true, subjectToInsurance: true, affectsAvgEarnings: true, paymentMethod: "BANK" },
  { name: "Отпускные", code: "vacation_pay", subjectToNdfl: true, subjectToInsurance: true, affectsAvgEarnings: false, paymentMethod: "BANK" },
  { name: "Больничные", code: "sick_leave_pay", subjectToNdfl: true, subjectToInsurance: false, affectsAvgEarnings: false, paymentMethod: "BANK" },
  { name: "Компенсация", code: "compensation", subjectToNdfl: false, subjectToInsurance: false, affectsAvgEarnings: false, paymentMethod: "BANK" },
  { name: "Материальная помощь", code: "financial_aid", subjectToNdfl: false, subjectToInsurance: false, affectsAvgEarnings: false, paymentMethod: "BANK" },
  { name: "Разовая выплата", code: "one_off_payment", subjectToNdfl: true, subjectToInsurance: true, affectsAvgEarnings: false, paymentMethod: "BANK" },
  { name: "Удержание", code: "deduction", subjectToNdfl: false, subjectToInsurance: false, affectsAvgEarnings: false, paymentMethod: "BANK" },
];

// systemCode marks lines the management balance derives from operations (see BalanceArticle in the schema).
const INITIAL_BALANCE_ARTICLES: Array<{ name: string; category: "ASSET" | "LIABILITY" | "EQUITY"; systemCode?: string }> = [
  { name: "Денежные средства", category: "ASSET", systemCode: "cash" },
  { name: "Дебиторская задолженность", category: "ASSET", systemCode: "receivable" },
  { name: "Авансы выданные", category: "ASSET", systemCode: "advances_issued" },
  { name: "Прочие активы", category: "ASSET" },
  { name: "Кредиторская задолженность", category: "LIABILITY", systemCode: "payable" },
  { name: "Авансы полученные", category: "LIABILITY", systemCode: "advances_received" },
  { name: "Налоги и зарплата к выплате", category: "LIABILITY", systemCode: "payroll_payable" },
  { name: "Займы и кредиты", category: "LIABILITY" },
  { name: "Капитал", category: "EQUITY" },
  { name: "Нераспределённая прибыль", category: "EQUITY", systemCode: "retained_earnings" },
];

async function main() {
  console.log("Сидирование прав и ролей...");
  for (const code of Object.values(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { code },
      update: { description: PERMISSION_LABELS[code] },
      create: { code, description: PERMISSION_LABELS[code] },
    });
  }

  for (const roleDef of ROLE_DEFINITIONS) {
    const role = await prisma.role.upsert({
      where: { code: roleDef.code },
      update: { name: roleDef.name, isSystem: roleDef.isSystem },
      create: { code: roleDef.code, name: roleDef.name, isSystem: roleDef.isSystem },
    });

    for (const permCode of roleDef.permissions) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code: permCode } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  console.log("Сидирование подразделений...");
  for (const name of INITIAL_DEPARTMENTS) {
    const existing = await prisma.department.findFirst({ where: { name, organizationId: null } });
    if (!existing) {
      await prisma.department.create({ data: { name } });
    }
  }

  console.log("Сидирование направлений...");
  for (const name of INITIAL_DIRECTIONS) {
    const existing = await prisma.direction.findFirst({ where: { name } });
    if (!existing) {
      await prisma.direction.create({ data: { name } });
    }
  }

  console.log("Сидирование статей ДДС...");
  for (const article of INITIAL_CASH_FLOW_ARTICLES) {
    const existing = await prisma.cashFlowArticle.findFirst({ where: { name: article.name } });
    if (!existing) {
      await prisma.cashFlowArticle.create({ data: article });
    }
  }

  console.log("Сидирование статей ОПиУ...");
  for (const article of INITIAL_PNL_ARTICLES) {
    const existing = await prisma.pnlArticle.findFirst({ where: { name: article.name } });
    if (!existing) {
      await prisma.pnlArticle.create({ data: article });
    }
  }

  console.log("Сидирование статей баланса...");
  for (const article of INITIAL_BALANCE_ARTICLES) {
    const existing = await prisma.balanceArticle.findFirst({ where: { name: article.name } });
    if (!existing) {
      await prisma.balanceArticle.create({ data: article });
    } else if (article.systemCode && !existing.systemCode) {
      await prisma.balanceArticle.update({ where: { id: existing.id }, data: { systemCode: article.systemCode } });
    }
  }

  console.log("Сидирование налоговых и страховых правил...");
  for (const rule of INITIAL_TAX_RULES) {
    await prisma.taxRule.upsert({
      where: { code: rule.code },
      update: {},
      create: rule,
    });
  }

  console.log("Сидирование видов начислений зарплаты...");
  const payrollArticle = await prisma.pnlArticle.findFirst({ where: { name: "Расходы на оплату труда" } });
  for (const type of INITIAL_PAYROLL_ACCRUAL_TYPES) {
    await prisma.payrollAccrualType.upsert({
      where: { code: type.code },
      update: {},
      create: { ...type, pnlArticleId: payrollArticle?.id },
    });
  }

  console.log("Сидирование графика работы по умолчанию...");
  const defaultSchedule = await prisma.workSchedule.findFirst({ where: { name: "Полная занятость 5/2" } });
  if (!defaultSchedule) {
    await prisma.workSchedule.create({ data: { name: "Полная занятость 5/2" } });
  }

  console.log("Сидирование администратора...");
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    const tempPassword = process.env.SEED_ADMIN_PASSWORD ?? crypto.randomBytes(9).toString("base64url");
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        fullName: "Администратор ПРОМТЕХНОСФЕРА",
      },
    });
    const fullAdminRole = await prisma.role.findUniqueOrThrow({ where: { code: "full_admin" } });
    await prisma.userRole.create({ data: { userId: admin.id, roleId: fullAdminRole.id } });

    console.log("=".repeat(60));
    console.log(`Создан администратор: ${adminEmail}`);
    console.log(`Временный пароль: ${tempPassword}`);
    console.log("Смените пароль после первого входа.");
    console.log("=".repeat(60));
  } else {
    console.log(`Администратор ${adminEmail} уже существует, пропуск.`);
  }

  const currentPeriod = { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
  await prisma.accountingPeriod.upsert({
    where: { year_month: currentPeriod },
    update: {},
    create: { ...currentPeriod, status: "OPEN" },
  });

  console.log("Готово.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
