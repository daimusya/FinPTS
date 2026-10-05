import Link from "next/link";

/** Запись не найдена: удалена, адрес неверный или она вне вашего доступа (организации, подразделения). */
export default function NotFound() {
  return (
    <div className="page">
      <div className="card" style={{ maxWidth: 620 }}>
        <h1 style={{ fontSize: 18, marginBottom: 8 }}>Не найдено</h1>
        <p>Запись не найдена или недоступна вам: её могли удалить, в ссылке может быть ошибка, или она относится к организации либо подразделению, к которым у вас нет доступа.</p>
        <p className="text-muted" style={{ fontSize: 13 }}>Если запись нужна для работы — попросите администратора открыть доступ.</p>
        <p style={{ marginTop: 12 }}>
          <Link href="/dashboard" className="btn btn-secondary">
            На главную
          </Link>
        </p>
      </div>
    </div>
  );
}
