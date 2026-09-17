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
    ],
  },
  {
    title: "Начисления и деньги",
    items: [
      { href: "/accruals", label: "Документы начисления" },
      { href: "/cash/transactions", label: "Банк и касса" },
      { href: "/cash/import", label: "Загрузка выписки" },
      { href: "/payment-requests", label: "Заявки на оплату" },
      { href: "/payment-calendar", label: "Платёжный календарь" },
    ],
  },
  {
    title: "Отчёты",
    items: [{ href: "/reports/debts", label: "Дебиторка и кредиторка" }],
  },
  {
    title: "Администрирование",
    items: [
      { href: "/admin/users", label: "Пользователи" },
      { href: "/admin/roles", label: "Роли и права" },
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
      <div className="sidebar-footer">Версия 0.2 · Этап 2: Начисления и деньги</div>
    </aside>
  );
}
