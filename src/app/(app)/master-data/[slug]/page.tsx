import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession, hasPermission } from "@/lib/session";
import { DICTIONARY_REGISTRY, getDictionaryConfig } from "@/lib/dictionaries/registry";
import { archiveDictionaryItem, restoreDictionaryItem } from "../actions";
import { CounterpartyCreateByInn } from "@/components/counterparty-inn";

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
  searchParams: Promise<{ imported?: string; innError?: string }>;
}) {
  const { slug } = await params;
  const { imported, innError } = await searchParams;
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

  const items = await config.delegate.findMany({
    orderBy: config.orderBy ?? { name: "asc" },
  });

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

      {imported ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="form-success">Загружено записей: {imported}.</p>
        </div>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {config.listColumns.map((col) => (
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
                {config.listColumns.map((col) => (
                  <td key={col}>{LABELS[String(item[col])] ?? formatCell(item[col])}</td>
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
                <td colSpan={config.listColumns.length + 2} className="empty-state">
                  Записей пока нет.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
