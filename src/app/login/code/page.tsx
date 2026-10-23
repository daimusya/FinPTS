import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { readPendingLogin } from "@/lib/mfa/pending-login";
import { CodeForm } from "./code-form";
import { cancelLoginCodeAction } from "./actions";

/** Второй шаг входа: пароль уже проверен, нужен код из приложения на телефоне. */
export default async function LoginCodePage() {
  if (await getSession()) redirect("/dashboard");
  const user = await readPendingLogin();
  if (!user) redirect("/login?expired=1");

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-brand-mark">ПТ</span>
          <div>
            <h1>Вход с кодом</h1>
            <p>{user.email}</p>
          </div>
        </div>
        <p className="text-muted" style={{ marginBottom: 12, fontSize: 13 }}>
          Откройте приложение-генератор кодов на телефоне (Яндекс Ключ, Google Authenticator и т. п.) и введите 6 цифр для
          «ПРОМТЕХНОСФЕРА». Нет телефона под рукой — введите один из резервных кодов.
        </p>
        <CodeForm />
        <form action={cancelLoginCodeAction} style={{ marginTop: 14 }}>
          <button type="submit" className="btn btn-ghost btn-sm">
            ← Войти под другой учётной записью
          </button>
        </form>
      </div>
    </div>
  );
}
