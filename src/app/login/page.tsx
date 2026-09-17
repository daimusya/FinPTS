import { redirect } from "next/navigation";
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
        <LoginForm />
      </div>
    </div>
  );
}
