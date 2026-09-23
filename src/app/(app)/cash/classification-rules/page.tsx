import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { applyRulesToUnclassifiedAction } from "./actions";

const DIRECTION_LABELS: Record<string, string> = { INFLOW: "Поступление", OUTFLOW: "Списание" };

export default async function ClassificationRulesPage({
  searchParams,
}: {
  searchParams: Promise<{ applied?: string }>;
}) {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.CASH_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для просмотра правил классификации.</div>
      </div>
    );
  }
  const canManage = hasPermission(session, PERMISSIONS.CASH_MANAGE);
  const { applied } = await searchParams;

  const [rules, unclassifiedCount] = await Promise.all([
    prisma.bankClassificationRule.findMany({
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      include: { cashFlowArticle: true, department: true, costCenter: true, project: true, productService: true },
    }),
    prisma.bankTransaction.count({ where: { cashFlowArticleId: null } }),
  ]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Правила автоклассификации банковских операций</h1>
          <p>
            Правило срабатывает, если совпадают все заданные условия (назначение платежа / ИНН контрагента /
            сумма). Применяется при загрузке выписки и вручную — к уже загруженным операциям без статьи ДДС.
            Правила проверяются по возрастанию приоритета, побеждает первое совпавшее.
          </p>
        </div>
        {canManage ? (
          <Link href="/cash/classification-rules/new" className="btn btn-primary">
            Новое правило
          </Link>
        ) : null}
      </div>

      {applied !== undefined ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="form-success">Правила применены к {applied} операциям.</p>
        </div>
      ) : null}

      {canManage ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <p style={{ marginBottom: 10 }}>
            Операций без статьи ДДС: <strong>{unclassifiedCount}</strong>.
          </p>
          <form action={applyRulesToUnclassifiedAction}>
            <button type="submit" className="btn btn-secondary" disabled={unclassifiedCount === 0}>
              Применить правила к несопоставленным операциям
            </button>
          </form>
        </div>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Приоритет</th>
              <th>Название</th>
              <th>Условия</th>
              <th>Назначается</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => {
              const conditions: string[] = [];
              if (rule.direction) conditions.push(DIRECTION_LABELS[rule.direction]);
              if (rule.purposeContains) conditions.push(`назначение содержит «${rule.purposeContains}»`);
              if (rule.counterpartyInn) conditions.push(`ИНН = ${rule.counterpartyInn}`);
              if (rule.amountEquals) conditions.push(`сумма = ${formatMoney(rule.amountEquals)}`);

              const assigns: string[] = [];
              if (rule.cashFlowArticle) assigns.push(rule.cashFlowArticle.name);
              if (rule.department) assigns.push(rule.department.name);
              if (rule.costCenter) assigns.push(rule.costCenter.name);
              if (rule.project) assigns.push(rule.project.name);
              if (rule.productService) assigns.push(rule.productService.name);

              return (
                <tr key={rule.id}>
                  <td className="mono">{rule.priority}</td>
                  <td>{rule.name}</td>
                  <td>{conditions.join(", ")}</td>
                  <td>{assigns.join(" · ")}</td>
                  <td>
                    <span className={`badge ${rule.isArchived ? "badge-danger" : "badge-active"}`}>
                      {rule.isArchived ? "В архиве" : "Активно"}
                    </span>
                  </td>
                  <td>
                    {canManage ? (
                      <Link href={`/cash/classification-rules/${rule.id}/edit`} className="btn btn-ghost btn-sm">
                        Изменить
                      </Link>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {rules.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-state">
                  Правил пока нет.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
