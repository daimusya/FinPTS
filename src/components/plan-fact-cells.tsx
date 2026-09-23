import { formatMoney, formatNumber } from "@/lib/money";
import { isFavorable, type PlanFactMetrics } from "@/lib/budget/plan-fact";

export const PLAN_FACT_HEADERS = ["План", "Отклонение", "Исполнение"] as const;

/** Три ячейки план-факта: план, отклонение (факт − план, цветом — хорошо или плохо) и % исполнения. */
export function PlanFactCells({
  metrics,
  nature,
  bold,
}: {
  metrics: PlanFactMetrics;
  nature: "income" | "expense";
  bold?: boolean;
}) {
  if (!metrics.plan) {
    return (
      <>
        <td className="text-muted">—</td>
        <td className="text-muted">—</td>
        <td className="text-muted">—</td>
      </>
    );
  }
  const favorable = isFavorable(metrics.deviation, nature);
  const deviationClass = favorable === null ? "" : favorable ? "text-good" : "text-bad";
  const weight = bold ? 700 : undefined;
  return (
    <>
      <td className="mono" style={{ fontWeight: weight }}>
        {formatMoney(metrics.plan)}
      </td>
      <td className={`mono ${deviationClass}`} style={{ fontWeight: weight }}>
        {metrics.deviation && metrics.deviation.greaterThan(0) ? "+" : ""}
        {formatMoney(metrics.deviation ?? 0)}
      </td>
      <td className="mono" style={{ fontWeight: weight }}>
        {metrics.executionPct ? `${formatNumber(metrics.executionPct)}%` : "—"}
      </td>
    </>
  );
}
