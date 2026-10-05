"use client";

import { useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";

const noSubscription = () => () => {};

/**
 * Кнопка отправки формы, которая сначала спрашивает подтверждение. До загрузки
 * скрипта она неактивна — иначе форма ушла бы без вопроса; пока действие
 * выполняется — тоже, чтобы не отправить его дважды.
 */
export function ConfirmSubmitButton({ message, className, children }: { message: string; className?: string; children: React.ReactNode }) {
  const ready = useSyncExternalStore(noSubscription, () => true, () => false);
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={!ready || pending}
      aria-busy={pending || undefined}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {pending ? "Подождите…" : children}
    </button>
  );
}
