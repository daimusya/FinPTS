"use client";

/** Сбой самой разметки платформы: своя страница без общих стилей. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="ru">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f4f5f7", color: "#1d2129", margin: 0 }}>
        <title>Ошибка — ПРОМТЕХНОСФЕРА</title>
        <div style={{ maxWidth: 520, margin: "12vh auto", background: "#fff", borderRadius: 12, padding: 28, boxShadow: "0 4px 24px rgba(0,0,0,.08)" }}>
          <h1 style={{ fontSize: 20, margin: "0 0 10px" }}>Платформа временно недоступна</h1>
          <p style={{ margin: "0 0 10px", lineHeight: 1.5 }}>Не удалось открыть страницу. Попробуйте ещё раз через минуту.</p>
          {error.digest ? (
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "#5c6370" }}>
              Если ошибка повторяется, сообщите администратору код: <code>{error.digest}</code>
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => retry()}
            style={{ background: "#ff6a13", color: "#fff", border: 0, borderRadius: 8, padding: "10px 18px", fontSize: 14, cursor: "pointer" }}
          >
            Попробовать ещё раз
          </button>
        </div>
      </body>
    </html>
  );
}
