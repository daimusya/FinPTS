import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession, hasPermission } from "@/lib/session";
import { DICTIONARY_REGISTRY, getDictionaryConfig } from "@/lib/dictionaries/registry";
import { archiveDictionaryItem, restoreDictionaryItem } from "../actions";

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
};

export default async function DictionaryListPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
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
        {canManage ? (
          <Link href={`/master-data/${slug}/new`} className="btn btn-primary">
            Добавить
          </Link>
        ) : null}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {config.listColumns.map((col) => (
                <th key={col}>{config.fields.find((f) => f.name === col)?.label ?? col}</th>
              ))}
              <th>Статус</th>
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
