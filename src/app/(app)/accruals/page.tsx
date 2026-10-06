import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { documentTotal, isForeign } from "@/lib/accruals/currency";
import { formatMoneyIn } from "@/lib/currency";
import {
  ACCRUAL_DIRECTION_LABELS,
  ACCRUAL_DOCUMENT_TYPE_LABELS,
  ACCRUAL_STATUS_LABELS,
  PAYMENT_STATUS_BADGE,
  PAYMENT_STATUS_LABELS,
} from "@/lib/accruals/labels";
import type { Prisma } from "@prisma/client";
import { accrualScopeWhere, getAccessScope } from "@/lib/access-scope";
import { pageWindow } from "@/lib/paging";
import { Pager } from "@/components/pager";
import { textSearchWhere } from "@/lib/text-search";
import { parseDateParam } from "@/lib/date-param";
import { singleParams } from "@/lib/query-params";
import { enumParam } from "@/lib/query-params";
import { AccrualDirection, AccrualDocumentStatus, PaymentStatus } from "@prisma/client";
import { SubmitButton } from "@/components/submit-button";

const PAGE_SIZE = 200;

export default async function AccrualsPage({
  searchParams,
}: {
  searchParams: Promise<{
    direction?: string;
    status?: string;
    paymentStatus?: string;
    pnlArticleId?: string;
    from?: string;
    to?: string;
    page?: string;
    q?: string;
    error?: string;
  }>;
}) {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.ACCRUALS_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для просмотра начислений.</div>
      </div>
    );
  }
  const canManage = hasPermission(session, PERMISSIONS.ACCRUALS_MANAGE);
  const filters = singleParams(await searchParams);
  const { direction, status, paymentStatus, pnlArticleId, from, to, q, error } = filters;

  const scope = await getAccessScope(session);

  const where: Prisma.AccrualDocumentWhereInput = { ...accrualScopeWhere(scope) };
  // Values outside the lists (an edited link) are ignored rather than failing the query.
  const directionValue = enumParam(direction, AccrualDirection);
  const statusValue = enumParam(status, AccrualDocumentStatus);
  const paymentStatusValue = enumParam(paymentStatus, PaymentStatus);
  if (directionValue) where.direction = directionValue;
  if (statusValue) where.status = statusValue;
  if (paymentStatusValue) where.paymentStatus = paymentStatusValue;
  if (pnlArticleId) where.lines = { some: { pnlArticleId } };
  if (q?.trim()) where.AND = [textSearchWhere(["number", "comment", "counterparty.fullName", "counterparty.shortName", "counterparty.inn"], q)];
  // A malformed date in the address (an old or edited link) is ignored instead of failing the page.
  const fromDate = parseDateParam(from);
  const toDate = parseDateParam(to);
  if (fromDate || toDate) {
    where.date = {
      ...(fromDate ? { gte: fromDate } : {}),
      ...(toDate ? { lte: toDate } : {}),
    };
  }

  // Pages instead of a silent cut at 200: older documents stay reachable from the list.
  const window = pageWindow(await prisma.accrualDocument.count({ where }), filters.page, PAGE_SIZE);
  const documents = await prisma.accrualDocument.findMany({
    where,
    orderBy: [{ date: "desc" }, { id: "desc" }],
    skip: window.skip,
    take: window.take,
    include: { organization: true, counterparty: true, lines: true },
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Документы начисления</h1>
          <p>Начисление отражается в ОПиУ по дате документа, независимо от факта оплаты.</p>
          {pnlArticleId || from || to ? (
            <p className="text-muted">
              Фильтр из отчёта применён. <Link href="/accruals">Сбросить</Link>
            </p>
          ) : null}
        </div>
        {canManage ? (
          <Link href="/accruals/new" className="btn btn-primary">
            Новый документ
          </Link>
        ) : null}
      </div>

      {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}

      <form className="filter-bar">
        <label className="field" style={{ minWidth: 240 }}>
          <span>Поиск</span>
          <input type="search" name="q" id="accruals-search" defaultValue={q ?? ""} placeholder="номер, контрагент, ИНН" />
        </label>
        <label className="field">
          <span>Направление</span>
          <select name="direction" defaultValue={direction ?? ""}>
            <option value="">Все</option>
            <option value="INCOME">Доход</option>
            <option value="EXPENSE">Расход</option>
          </select>
        </label>
        <label className="field">
          <span>Статус проведения</span>
          <select name="status" defaultValue={status ?? ""}>
            <option value="">Все</option>
            <option value="DRAFT">Черновик</option>
            <option value="POSTED">Проведён</option>
            <option value="CANCELLED">Отменён</option>
          </select>
        </label>
        <label className="field">
          <span>Оплата</span>
          <select name="paymentStatus" defaultValue={paymentStatus ?? ""}>
            <option value="">Все</option>
            <option value="UNPAID">Не оплачено</option>
            <option value="PARTIALLY_PAID">Частично оплачено</option>
            <option value="PAID">Оплачено</option>
            <option value="OVERPAID">Переплата</option>
          </select>
        </label>
        <SubmitButton className="btn btn-secondary">
          Применить
        </SubmitButton>
      </form>

      <p className="text-muted" style={{ fontSize: 12, margin: "8px 0" }}>
        {window.caption}
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Дата</th>
              <th>№</th>
              <th>Тип</th>
              <th>Организация</th>
              <th>Контрагент</th>
              <th>Направление</th>
              <th>Сумма</th>
              <th>Проведение</th>
              <th>Оплата</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => {
              const total = doc.lines.reduce((acc, l) => acc + Number(l.amount), 0);
              const foreign = isForeign(doc.currency);
              return (
                <tr key={doc.id}>
                  <td className="mono">{doc.date.toLocaleDateString("ru-RU")}</td>
                  <td>
                    <Link href={`/accruals/${doc.id}`}>{doc.number}</Link>
                  </td>
                  <td>{ACCRUAL_DOCUMENT_TYPE_LABELS[doc.documentType]}</td>
                  <td>{doc.organization.shortName || doc.organization.name}</td>
                  <td>{doc.counterparty.shortName || doc.counterparty.fullName}</td>
                  <td>{ACCRUAL_DIRECTION_LABELS[doc.direction]}</td>
                  <td className="mono">
                    {foreign ? formatMoneyIn(documentTotal(doc.lines, true), doc.currency) : formatMoney(total)}
                    {foreign ? (
                      <div className="text-muted" style={{ fontSize: 11 }}>
                        {formatMoney(total)}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <span className="badge badge-orange">{ACCRUAL_STATUS_LABELS[doc.status]}</span>
                  </td>
                  <td>
                    <span className={`badge ${PAYMENT_STATUS_BADGE[doc.paymentStatus]}`}>
                      {PAYMENT_STATUS_LABELS[doc.paymentStatus]}
                    </span>
                  </td>
                </tr>
              );
            })}
            {documents.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty-state">
                  Документов пока нет.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <Pager window={window} basePath="/accruals" params={filters} />
    </div>
  );
}
