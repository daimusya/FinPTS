import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import {
  ACCRUAL_DIRECTION_LABELS,
  ACCRUAL_DOCUMENT_TYPE_LABELS,
  ACCRUAL_STATUS_LABELS,
  PAYMENT_STATUS_BADGE,
  PAYMENT_STATUS_LABELS,
} from "@/lib/accruals/labels";
import type { Prisma } from "@prisma/client";

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
  const { direction, status, paymentStatus, pnlArticleId, from, to } = await searchParams;

  const where: Prisma.AccrualDocumentWhereInput = {};
  if (direction) where.direction = direction as never;
  if (status) where.status = status as never;
  if (paymentStatus) where.paymentStatus = paymentStatus as never;
  if (pnlArticleId) where.lines = { some: { pnlArticleId } };
  if (from || to) {
    where.date = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  const documents = await prisma.accrualDocument.findMany({
    where,
    orderBy: { date: "desc" },
    take: 200,
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

      <form className="filter-bar">
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
        <button type="submit" className="btn btn-secondary">
          Применить
        </button>
      </form>

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
                  <td className="mono">{formatMoney(total)}</td>
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
    </div>
  );
}
