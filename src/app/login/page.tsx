import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { insecureRemoteLogin, requestIsHttps } from "@/lib/request-security";
import { getSession } from "@/lib/session";
import { LoginForm } from "./login-form";
import { singleParams } from "@/lib/query-params";
import { IDLE_MINUTES } from "@/lib/idle-timeout";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string; idle?: string }> }) {
  const { expired, idle } = singleParams(await searchParams);
  const session = await getSession();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-brand-mark">ПТ</span>
          <div>
            <h1>ПРОМТЕХНОСФЕРА</h1>
            <p>Финансовая платформа управленческого учёта</p>
          </div>
        </div>
        {insecureRemoteLogin({ https: await requestIsHttps(), host: (await headers()).get("host") }) ? (
          <p className="form-error" style={{ marginBottom: 12, fontSize: 12 }}>
            Соединение не защищено (http): пароль и данные передаются по сети открытым текстом. Попросите администратора настроить
            HTTPS.
          </p>
        ) : null}
        {idle ? (
          <p className="text-muted" style={{ marginBottom: 12, fontSize: 13 }}>
            В системе не работали больше {IDLE_MINUTES} минут — для защиты данных сеанс завершён. Войдите снова.
          </p>
        ) : expired ? (
          <p className="text-muted" style={{ marginBottom: 12, fontSize: 13 }}>
            Сеанс завершён — войдите снова. Несохранённые изменения последнего действия не записаны.
          </p>
        ) : null}
        <LoginForm />
      </div>
    </div>
  );
}
