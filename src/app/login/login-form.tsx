"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="login-form">
      <label className="field">
        <span>Email</span>
        <input type="email" name="email" required autoComplete="username" />
      </label>
      <label className="field">
        <span>Пароль</span>
        <input type="password" name="password" required autoComplete="current-password" />
      </label>
      {state.error ? <p className="form-error">{state.error}</p> : null}
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Вход..." : "Войти"}
      </button>
    </form>
  );
}
