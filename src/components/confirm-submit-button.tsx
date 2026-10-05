"use client";

import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/**
 * Кнопка отправки формы, которая сначала спрашивает подтверждение. До загрузки
 * скрипта она неактивна — иначе форма ушла бы без вопроса.
 */
export function ConfirmSubmitButton({ message, className, children }: { message: string; className?: string; children: React.ReactNode }) {
  const ready = useSyncExternalStore(noSubscription, () => true, () => false);
  return (
    <button
      type="submit"
      className={className}
      disabled={!ready}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
