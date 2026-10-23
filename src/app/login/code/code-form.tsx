"use client";

import { useActionState } from "react";
import { verifyLoginCodeAction, type CodeState } from "./actions";

const initialState: CodeState = {};

export function CodeForm() {
  const [state, formAction, pending] = useActionState(verifyLoginCodeAction, initialState);

  return (
    <form action={formAction} className="login-form">
      <label className="field">
        <span>Код из приложения</span>
        <input
          type="text"
          name="code"
          id="login-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          required
          maxLength={12}
          placeholder="6 цифр"
        />
      </label>
      {state.error ? <p className="form-error">{state.error}</p> : null}
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Проверка..." : "Войти"}
      </button>
    </form>
  );
}
