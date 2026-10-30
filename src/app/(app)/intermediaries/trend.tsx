import Link from "next/link";

interface TrendPoint {
  month: string;
  label: string;
  commission: number;
  inflow: number;
}

const money = (n: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n);
const short = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(".", ",")} млн` : n >= 1000 ? `${Math.round(n / 1000)} тыс` : money(n));

/** Столбики комиссии за 12 месяцев; выбранный месяц выделен, остальные — ссылки на свой месяц. */
export function CommissionTrend({ points, selected }: { points: TrendPoint[]; selected: string }) {
  const max = Math.max(...points.map((p) => p.commission), 1);
  if (points.every((p) => p.commission === 0)) {
    return <p className="text-muted">Комиссий за последние 12 месяцев нет — загрузите выписки.</p>;
  }
  return (
    <div className="trend" role="list" aria-label="Комиссия посредников по месяцам">
      {points.map((p) => {
        const height = p.commission > 0 ? Math.max(3, (p.commission / max) * 100) : 0;
        const tip = `${p.label}: комиссия ${money(p.commission)} ₽ с поступлений ${money(p.inflow)} ₽`;
        return (
          <Link
            key={p.month}
            href={`/intermediaries?month=${p.month}`}
            role="listitem"
            className={`trend__col${p.month === selected ? " trend__col--selected" : ""}`}
            title={tip}
            aria-label={tip}
          >
            <span className="trend__value">{p.commission > 0 ? short(p.commission) : ""}</span>
            <span className="trend__track">
              <span className="trend__bar" style={{ height: `${height}%` }} />
            </span>
            <span className="trend__label">{p.label.slice(0, 3)}</span>
          </Link>
        );
      })}
    </div>
  );
}
