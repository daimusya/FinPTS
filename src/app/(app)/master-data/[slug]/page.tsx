import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession, hasPermission } from "@/lib/session";
import { DICTIONARY_REGISTRY, getDictionaryConfig } from "@/lib/dictionaries/registry";
import { archiveDictionaryItem, restoreDictionaryItem } from "../actions";
import { CounterpartyCreateByInn } from "@/components/counterparty-inn";
import { CurrencyRatesLoader } from "@/components/currency-rates-loader";
import { isForeignCurrencyEnabled } from "@/lib/foreign-currency";
import { getAccessScope } from "@/lib/access-scope";
import { dictionaryScopeWhere } from "@/lib/dictionaries/scope";
import { CounterpartyEnrich, OrganizationCreateByInn } from "@/components/registry-by-inn";
import { dictionaryTextColumns } from "@/lib/dictionaries/columns";
import { dictionarySearchWhere } from "@/lib/dictionaries/search";
import { pageWindow } from "@/lib/paging";
import { Pager } from "@/components/pager";
import { singleParams } from "@/lib/query-params";

const PAGE_SIZE = 100;

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (value instanceof Date) return value.toLocaleDateString("ru-RU");
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (typeof value === "object" && "toFixed" in (value as { toFixed?: () => string })) {
    return String(value);
  }
  return String(value);
}

const LABELS: Record<string, string> = {
  LEGAL_ENTITY: "Юридическое лицо",
  SOLE_PROPRIETOR: "ИП",
  active: "Активный",
  paused: "Приостановлен",
  closed: "Закрыт",
  completed: "Исполнен",
  terminated: "Расторгнут",
  INFLOW: "Поступление",
  OUTFLOW: "Выплата",
  TRANSFER: "Перевод",
  REVENUE: "Выручка",
  DIRECT_VARIABLE: "Прямые переменные",
  DIRECT_FIXED: "Прямые постоянные",
  INDIRECT: "Косвенные",
  OTHER_INCOME: "Прочие доходы",
  OTHER_EXPENSE: "Прочие расходы",
  TAX: "Налоги",
  ASSET: "Актив",
  LIABILITY: "Обязательство",
  EQUITY: "Капитал",
  CASH: "Наличный",
  BANK: "Безналичный",
  MIXED: "Смешанный",
  ndfl: "НДФЛ",
  pension: "Пенсионное страхование",
  medical: "Медицинское страхование",
  social: "Социальное страхование",
  injury: "Травматизм",
  insurance_base_limit: "Предельная база для страховых взносов",
  mrot: "МРОТ",
  holiday: "Нерабочий день",
  workday: "Рабочий день (перенос)",
};

export default async function DictionaryListPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ imported?: string; importResult?: string; innError?: string; ratesError?: string; q?: string; page?: string }>;
}) {
  const { slug } = await params;
  const { imported, importResult, innError, ratesError, q, page } = singleParams(await searchParams);
  if (!DICTIONARY_REGISTRY[slug]) notFound();
  const config = getDictionaryConfig(slug);

  const session = await getSession();
  if (!session || !hasPermission(session, config.permissionView)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для просмотра раздела «{config.title}».</div>
      </div>
    );
  }
  const canManage = hasPermission(session, config.permissionManage);

  // Search by name, INN, number… and pages: active records first, then archived ones.
  const textColumns = dictionaryTextColumns(config);
  const where = { AND: [dictionaryScopeWhere(config, await getAccessScope(session)), dictionarySearchWhere(textColumns, q)] };
  const window = pageWindow(await config.delegate.count({ where }), page, config.listLimit ?? PAGE_SIZE);
  const items = await config.delegate.findMany({
    where,
    orderBy: [{ isArchived: "asc" }, config.orderBy ?? { name: "asc" }, { id: "asc" }],
    skip: window.skip,
    take: window.take,
  });

  const foreignCurrency = await isForeignCurrencyEnabled();
  const listColumns = config.listColumns.filter((col) => config.fields.find((f) => f.name === col)?.feature !== "foreignCurrency" || foreignCurrency);
  const active = items.filter((item) => !item.isArchived);
  const archived = items.filter((item) => item.isArchived);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{config.title}</h1>
          <p>Справочник хранится в базе данных. Архивирование не удаляет записи физически.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a href={`/api/master-data/export?slug=${slug}`} className="btn btn-secondary">
            Экспорт в Excel
          </a>
          {canManage ? (
            <Link href={`/master-data/${slug}/import`} className="btn btn-secondary">
              Импорт из Excel
            </Link>
          ) : null}
          {canManage ? (
            <Link href={`/master-data/${slug}/new`} className="btn btn-primary">
              Добавить
            </Link>
          ) : null}
        </div>
      </div>

      {slug === "counterparties" && canManage ? <CounterpartyCreateByInn error={innError} /> : null}
      {slug === "counterparties" && canManage ? <CounterpartyEnrich /> : null}
      {slug === "organizations" && canManage ? <OrganizationCreateByInn error={innError} /> : null}
      {slug === "currency-rates" && canManage ? <CurrencyRatesLoader error={ratesError} /> : null}
      <form className="filter-bar" style={{ alignItems: "flex-end" }}>
        {textColumns.length > 0 ? (
          <label className="field" style={{ minWidth: 280 }}>
            <span>Поиск</span>
            <input
              type="search"
              name="q"
              id="dictionary-search"
              defaultValue={q ?? ""}
              placeholder={textColumns
                .slice(0, 3)
                .map((c) => config.fields.find((f) => f.name === c)?.label.split(" (")[0].toLowerCase())
                .join(", ")}
            />
          </label>
        ) : null}
        {textColumns.length > 0 ? (
          <button type="submit" className="btn btn-secondary">
            Найти
          </button>
        ) : null}
        {q ? (
          <Link href={`/master-data/${slug}`} className="btn btn-ghost">
            Сбросить
          </Link>
        ) : null}
        <span className="text-muted" style={{ fontSize: 12 }}>
          {window.caption}
        </span>
      </form>

      {importResult || imported ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="form-success">{importResult ?? `Загружено записей: ${imported}.`}</p>
        </div>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {listColumns.map((col) => (
                <th key={col}>{config.fields.find((f) => f.name === col)?.label ?? col}</th>
              ))}
              {/* «Статус» clashes with a dictionary's own status column (projects, contracts). */}
              <th>Запись</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[...active, ...archived].map((item) => (
              <tr key={String(item.id)}>
                {listColumns.map((col) => (
                  <td key={col}>
                    {config.fields.find((f) => f.name === col)?.options?.find((o) => o.value === String(item[col]))?.label ??
                      LABELS[String(item[col])] ??
                      formatCell(item[col])}
                  </td>
                ))}
                <td>
                  <span className={`badge ${item.isArchived ? "badge-archived" : "badge-active"}`}>
                    {item.isArchived ? "В архиве" : "Активен"}
                  </span>
                </td>
                <td>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    {canManage ? (
                      <Link href={`/master-data/${slug}/${item.id}/edit`} className="btn btn-ghost btn-sm">
                        Изменить
                      </Link>
                    ) : null}
                    {canManage ? (
                      <form
                        action={
                          item.isArchived
                            ? restoreDictionaryItem.bind(null, slug, String(item.id))
                            : archiveDictionaryItem.bind(null, slug, String(item.id))
                        }
                      >
                        <button type="submit" className="btn btn-ghost btn-sm">
                          {item.isArchived ? "Восстановить" : "В архив"}
                        </button>
                      </form>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={listColumns.length + 2} className="empty-state">
                  {q ? `По запросу «${q}» ничего не найдено.` : "Записей пока нет."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <Pager window={window} basePath={`/master-data/${slug}`} params={{ q }} />
    </div>
  );
}
