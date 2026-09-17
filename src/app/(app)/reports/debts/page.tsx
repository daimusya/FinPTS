import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney, sumMoney } from "@/lib/money";
import { ACCRUAL_DOCUMENT_TYPE_LABELS } from "@/lib/accruals/labels";
import Decimal from "decimal.js";

interface DebtRow {
  counterpartyId: string;
  counterpartyName: string;
  total: Decimal;
  overdue: Decimal;
  documents: Array<{ id: string; number: string; documentType: string; dueDate: Date | null; remaining: Decimal; overdue: boolean }>;
}

export default async function DebtsReportPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.REPORTS_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для просмотра отчёта.</div>
      </div>
    );
  }

  const documents = await prisma.accrualDocument.findMany({
    where: { status: "POSTED", paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] } },
    include: { counterparty: true, lines: true, allocations: { where: { cancelledAt: null } } },
    orderBy: { dueDate: "asc" },
  });

  const now = new Date();
  const receivables = new Map<string, DebtRow>();
  const payables = new Map<string, DebtRow>();

  for (const doc of documents) {
    const total = sumMoney(doc.lines.map((l) => l.amount));
    const allocated = sumMoney(doc.allocations.map((a) => a.amount));
    const remaining = total.minus(allocated);
    if (remaining.lessThanOrEqualTo(0)) continue;

    const isOverdue = Boolean(doc.dueDate && doc.dueDate < now);
    const bucket = doc.direction === "INCOME" ? receivables : payables;
    const key = doc.counterpartyId;
    const row =
      bucket.get(key) ??
      ({
        counterpartyId: key,
        counterpartyName: doc.counterparty.shortName || doc.counterparty.fullName,
        total: new Decimal(0),
        overdue: new Decimal(0),
        documents: [],
      } as DebtRow);

    row.total = row.total.plus(remaining);
    if (isOverdue) row.overdue = row.overdue.plus(remaining);
    row.documents.push({
      id: doc.id,
      number: doc.number,
      documentType: doc.documentType,
      dueDate: doc.dueDate,
      remaining,
      overdue: isOverdue,
    });
    bucket.set(key, row);
  }

  const receivableRows = Array.from(receivables.values()).sort((a, b) => b.total.comparedTo(a.total));
  const payableRows = Array.from(payables.values()).sort((a, b) => b.total.comparedTo(a.total));
  const totalReceivable = sumMoney(receivableRows.map((r) => r.total));
  const totalPayable = sumMoney(payableRows.map((r) => r.total));
  const overdueReceivable = sumMoney(receivableRows.map((r) => r.overdue));
  const overduePayable = sumMoney(payableRows.map((r) => r.overdue));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Дебиторская и кредиторская задолженность</h1>
          <p>Считается из проведённых непогашенных документов начисления: сумма минус сопоставленные оплаты.</p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Дебиторская задолженность</div>
          <div className="stat-value">{formatMoney(totalReceivable)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">в т.ч. просрочено</div>
          <div className="stat-value" style={{ color: "var(--color-danger)" }}>
            {formatMoney(overdueReceivable)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Кредиторская задолженность</div>
          <div className="stat-value">{formatMoney(totalPayable)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">в т.ч. просрочено</div>
          <div className="stat-value" style={{ color: "var(--color-danger)" }}>
            {formatMoney(overduePayable)}
          </div>
        </div>
      </div>

      <DebtTable title="Дебиторская задолженность (нам должны)" rows={receivableRows} />
      <DebtTable title="Кредиторская задолженность (мы должны)" rows={payableRows} />
    </div>
  );
}

function DebtTable({ title, rows }: { title: string; rows: DebtRow[] }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{title}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Контрагент</th>
              <th>Документы</th>
              <th>Сумма</th>
              <th>Просрочено</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.counterpartyId}>
                <td>{row.counterpartyName}</td>
                <td>
                  <div className="tag-list">
                    {row.documents.map((d) => (
                      <Link
                        key={d.id}
                        href={`/accruals/${d.id}`}
                        className={`badge ${d.overdue ? "badge-danger" : "badge-orange"}`}
                        title={`${ACCRUAL_DOCUMENT_TYPE_LABELS[d.documentType]} · остаток ${formatMoney(d.remaining)}`}
                      >
                        № {d.number}
                      </Link>
                    ))}
                  </div>
                </td>
                <td className="mono">{formatMoney(row.total)}</td>
                <td className="mono" style={{ color: row.overdue.greaterThan(0) ? "var(--color-danger)" : undefined }}>
                  {row.overdue.greaterThan(0) ? formatMoney(row.overdue) : "—"}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty-state">
                  Задолженности нет.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
