import Link from "next/link";

/** Предупреждение в отчёте: для валютных сумм нет курса ЦБ на нужную дату. */
export function MissingRatesWarning({ text }: { text: string }) {
  return (
    <div className="card" role="status" style={{ marginBottom: 16, borderColor: "var(--color-warning)" }}>
      <strong>Нет курса валюты: {text}.</strong>{" "}
      <span className="text-muted">
        Суммы пересчитаны по ближайшему известному курсу (или как есть, если курсов этой валюты нет совсем). Загрузите курсы ЦБ в
        справочнике <Link href="/master-data/currency-rates#cbr">«Курсы валют»</Link>.
      </span>
    </div>
  );
}
