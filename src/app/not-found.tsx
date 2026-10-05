import Link from "next/link";

/** Неизвестный адрес (вне разделов платформы). */
export default function NotFound() {
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-brand-mark">ПТ</span>
          <div>
            <h1>Страница не найдена</h1>
            <p>Такого адреса в платформе нет — возможно, ссылка устарела или в ней опечатка.</p>
          </div>
        </div>
        <p style={{ marginTop: 8 }}>
          <Link href="/dashboard" className="btn btn-primary">
            На главную
          </Link>
        </p>
      </div>
    </div>
  );
}
