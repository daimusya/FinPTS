"use client";

import { useFormStatus } from "react-dom";

/**
 * Кнопка отправки формы: пока действие выполняется, она неактивна и пишет
 * «Подождите…» — повторное нажатие при медленной сети не создаёт вторую
 * заявку, документ или сотрудника (уникальных ключей у них нет).
 */
export function SubmitButton({
  className,
  children,
  disabled,
  name,
  value,
  formAction,
  "aria-label": ariaLabel,
}: {
  className?: string;
  children: React.ReactNode;
  disabled?: boolean;
  name?: string;
  value?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
  "aria-label"?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      aria-label={ariaLabel}
      name={name}
      value={value}
      formAction={formAction}
    >
      {pending ? "Подождите…" : children}
    </button>
  );
}
