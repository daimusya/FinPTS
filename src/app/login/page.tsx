import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { insecureRemoteLogin, requestIsHttps } from "@/lib/request-security";
import { getSession } from "@/lib/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
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
        <LoginForm />
      </div>
    </div>
  );
}
