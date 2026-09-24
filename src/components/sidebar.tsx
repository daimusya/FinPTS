"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Обзор",
    items: [{ href: "/dashboard", label: "Дашборд" }],
  },
  {
    title: "Справочники",
    items: [
      { href: "/master-data/organizations", label: "Организации и ИП" },
      { href: "/master-data/bank-accounts", label: "Банковские счета" },
      { href: "/master-data/cash-accounts", label: "Кассы" },
      { href: "/master-data/departments", label: "Подразделения" },
      { href: "/master-data/cost-centers", label: "ЦФО" },
      { href: "/master-data/projects", label: "Проекты" },
      { href: "/master-data/directions", label: "Направления" },
      { href: "/master-data/products-services", label: "Продукты и услуги" },
      { href: "/master-data/counterparties", label: "Контрагенты" },
      { href: "/master-data/contracts", label: "Договоры" },
      { href: "/master-data/cash-flow-articles", label: "Статьи ДДС" },
      { href: "/master-data/pnl-articles", label: "Статьи ОПиУ" },
      { href: "/master-data/balance-articles", label: "Статьи баланса" },
      { href: "/master-data/positions", label: "Должности" },
      { href: "/master-data/work-schedules", label: "Графики работы" },
      { href: "/master-data/payroll-accrual-types", label: "Виды начислений зарплаты" },
      { href: "/master-data/tax-rules", label: "Налоговые и страховые правила" },
      { href: "/master-data/payroll-parameters", label: "Параметры расчёта зарплаты" },
      { href: "/master-data/production-calendar", label: "Производственный календарь" },
    ],
  },
  {
    title: "Сотрудники и зарплата",
    items: [
      { href: "/employees", label: "Сотрудники" },
      { href: "/timesheet", label: "Табель" },
      { href: "/payroll", label: "Расчёты зарплаты" },
      { href: "/payroll/summary", label: "Сводная ведомость" },
    ],
  },
  {
    title: "Начисления и деньги",
    items: [
      { href: "/accruals", label: "Документы начисления" },
      { href: "/cash/transactions", label: "Банк и касса" },
      { href: "/cash/import", label: "Загрузка выписки" },
      { href: "/cash/classification-rules", label: "Правила классификации" },
      { href: "/payment-requests", label: "Заявки на оплату" },
      { href: "/payment-calendar", label: "Платёжный календарь" },
    ],
  },
  {
    title: "Моделирование",
    items: [
      { href: "/budget", label: "Бюджет (план)" },
      { href: "/financial-model", label: "Финансовые сценарии" },
    ],
  },
  {
    title: "Отчёты",
    items: [
      { href: "/reports/cash-flow", label: "ДДС" },
      { href: "/reports/pnl", label: "ОПиУ" },
      { href: "/reports/balance", label: "Управленческий баланс" },
      { href: "/reports/margin", label: "Маржинальность и ТБУ" },
      { href: "/reports/debts", label: "Дебиторка и кредиторка" },
    ],
  },
  {
    title: "Интеграции",
    items: [
      { href: "/integrations/1c", label: "1С: файловый обмен" },
      { href: "/integrations/bitrix24", label: "Битрикс24: очередь" },
    ],
  },
  {
    title: "Администрирование",
    items: [
      { href: "/admin/users", label: "Пользователи" },
      { href: "/admin/roles", label: "Роли и права" },
      { href: "/admin/payment-approval-routes", label: "Маршруты согласования" },
      { href: "/admin/periods", label: "Периоды" },
      { href: "/admin/audit-log", label: "Журнал аудита" },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-brand-mark">ПТ</span>
        <span className="sidebar-brand-text">
          ПРОМТЕХНОСФЕРА
          <br />
          Финансовая платформа
        </span>
      </div>
      {NAV_GROUPS.map((group) => (
        <div className="sidebar-group" key={group.title}>
          <div className="sidebar-group-title">{group.title}</div>
          {group.items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-link${active ? " active" : ""}`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
      <div className="sidebar-footer">Версия 1.0 · Все 7 этапов ТЗ</div>
    </aside>
  );
}
