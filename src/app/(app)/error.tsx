"use client";

import Link from "next/link";

/**
 * Сбой при открытии страницы или выполнении действия. Подробности ошибок
 * сервера браузеру не передаются — показываем код, по которому администратор
 * найдёт запись в журнале сервера.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="page">
      <div className="card" style={{ maxWidth: 620 }}>
        <h1 style={{ fontSize: 18, marginBottom: 8 }}>Не удалось выполнить</h1>
        <p>Действие не выполнено или страница не открылась. Частые причины: не хватает прав на это действие, запись изменили или удалили в другой вкладке, сервер или база данных временно недоступны.</p>
        <p className="text-muted" style={{ fontSize: 13 }}>
          Попробуйте ещё раз. Если ошибка повторяется, сообщите администратору
          {error.digest ? (
            <>
              {" "}
              код ошибки: <span className="mono">{error.digest}</span>
            </>
          ) : null}
          .
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" onClick={() => retry()}>
            Попробовать ещё раз
          </button>
          <Link href="/dashboard" className="btn btn-secondary">
            На главную
          </Link>
        </div>
      </div>
    </div>
  );
}
