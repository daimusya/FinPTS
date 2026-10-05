import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { DICTIONARY_REGISTRY } from "@/lib/dictionaries/registry";
import { ACTION_LABELS, ENTITY_LABELS, auditChanges, entityLink } from "@/lib/audit-view";
import { singleParams } from "@/lib/query-params";

const PAGE_SIZE = 100;
const when = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "medium", timeZone: "Europe/Moscow" });

type Filters = { entityType?: string; userId?: string; action?: string; from?: string; to?: string; entityId?: string; page?: string };

/** Начало дня по Москве для даты из поля «с/по» (ГГГГ-ММ-ДД). */
function moscowDay(raw: string | undefined, shiftDays = 0): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00+03:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + shiftDays);
  return date;
}

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const session = await getSession();
  const filters = singleParams(await searchParams);
  if (!session || !hasPermission(session, PERMISSIONS.AUDIT_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для просмотра журнала аудита.</div>
      </div>
    );
  }

  const dictionaries = Object.values(DICTIONARY_REGISTRY);
  const dictionarySlugs = Object.fromEntries(dictionaries.map((c) => [c.entityAuditType, c.slug]));
  const entityLabel = (type: string) => ENTITY_LABELS[type] ?? dictionaries.find((c) => c.entityAuditType === type)?.singularTitle ?? type;
  const actionLabel = (action: string) => ACTION_LABELS[action] ?? action;

  const from = moscowDay(filters.from);
  const to = moscowDay(filters.to, 1);
  const where: Prisma.AuditLogWhereInput = {
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.userId ? { userId: filters.userId === "system" ? null : filters.userId } : {}),
    ...(filters.entityId?.trim() ? { entityId: filters.entityId.trim() } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
  };

  const total = await prisma.auditLog.count({ where });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(filters.page) || 1), pages);
  const [entries, entityTypes, actions, users] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { user: true } }),
    prisma.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true } }),
    prisma.auditLog.findMany({ distinct: ["action"], select: { action: true } }),
    prisma.user.findMany({ orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
  ]);
  const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, "ru");
  const entityOptions = entityTypes.map((e) => ({ value: e.entityType, label: entityLabel(e.entityType) })).sort(byLabel);
  const actionOptions = actions.map((a) => ({ value: a.action, label: actionLabel(a.action) })).sort(byLabel);

  const pageHref = (n: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (key !== "page" && value) params.set(key, value);
    if (n > 1) params.set("page", String(n));
    const query = params.toString();
    return `/admin/audit-log${query ? `?${query}` : ""}`;
  };
  const filtered = Object.entries(filters).some(([key, value]) => key !== "page" && value);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Журнал аудита</h1>
          <p>Кто, когда и что изменил в финансовых и административных данных. Секреты (пароли, ключи, коды) в журнал не попадают.</p>
        </div>
      </div>

      <form className="filter-bar">
        <label className="field" style={{ minWidth: 200 }}>
          <span>Запись</span>
          <select name="entityType" id="audit-entity-type" defaultValue={filters.entityType ?? ""}>
            <option value="">Все</option>
            {entityOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ minWidth: 180 }}>
          <span>Действие</span>
          <select name="action" id="audit-action" defaultValue={filters.action ?? ""}>
            <option value="">Все</option>
            {actionOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ minWidth: 180 }}>
          <span>Пользователь</span>
          <select name="userId" id="audit-user" defaultValue={filters.userId ?? ""}>
            <option value="">Все</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
            <option value="system">система</option>
          </select>
        </label>
        <label className="field">
          <span>С</span>
          <input type="date" name="from" id="audit-from" defaultValue={filters.from ?? ""} />
        </label>
        <label className="field">
          <span>По</span>
          <input type="date" name="to" id="audit-to" defaultValue={filters.to ?? ""} />
        </label>
        <label className="field" style={{ minWidth: 200 }}>
          <span>ID записи</span>
          <input type="text" name="entityId" id="audit-entity-id" defaultValue={filters.entityId ?? ""} />
        </label>
        <button type="submit" className="btn btn-secondary">
          Применить
        </button>
        {filtered ? (
          <Link href="/admin/audit-log" className="btn btn-ghost">
            Сбросить
          </Link>
        ) : null}
      </form>

      <p className="text-muted" style={{ fontSize: 12, margin: "8px 0" }}>
        {total === 0 ? "Записей нет" : `Записи ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} из ${total}`}
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Дата</th>
              <th>Пользователь</th>
              <th>Запись</th>
              <th>Действие</th>
              <th>Изменения</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const changes = auditChanges(entry.beforeJson, entry.afterJson);
              const link = entityLink(entry.entityType, entry.entityId, dictionarySlugs);
              return (
                <tr key={entry.id}>
                  <td className="mono" style={{ whiteSpace: "nowrap" }}>
                    {when.format(entry.createdAt)}
                  </td>
                  <td>{entry.user?.fullName ?? "система"}</td>
                  <td>
                    {entityLabel(entry.entityType)}
                    <div className="text-muted mono" style={{ fontSize: 11 }}>
                      {link ? <Link href={link}>{entry.entityId}</Link> : entry.entityId}
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-orange">{actionLabel(entry.action)}</span>
                  </td>
                  <td style={{ minWidth: 260 }}>
                    {changes.length > 0 ? (
                      <details>
                        <summary style={{ cursor: "pointer", fontSize: 12 }}>
                          {changes.slice(0, 3).map((c) => c.field).join(", ")}
                          {changes.length > 3 ? ` и ещё ${changes.length - 3}` : ""}
                        </summary>
                        <table style={{ marginTop: 6, fontSize: 12 }}>
                          <tbody>
                            {changes.map((c) => (
                              <tr key={c.field}>
                                <td className="mono">{c.field}</td>
                                <td className="text-muted" style={{ wordBreak: "break-word" }}>
                                  {c.before}
                                </td>
                                <td style={{ wordBreak: "break-word" }}>{c.after}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </details>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-state">
                  {filtered ? "По этим условиям записей нет." : "Записей пока нет."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {pages > 1 ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="btn btn-secondary btn-sm">
              ← Новее
            </Link>
          ) : null}
          <span className="text-muted" style={{ fontSize: 12 }}>
            Страница {page} из {pages}
          </span>
          {page < pages ? (
            <Link href={pageHref(page + 1)} className="btn btn-secondary btn-sm">
              Старее →
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
