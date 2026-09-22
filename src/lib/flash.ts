import { cookies } from "next/headers";

/**
 * Одноразовое серверное сообщение между Server Action и следующей
 * загрузкой страницы — httpOnly-куки вместо query-параметра, чтобы
 * чувствительные значения (например, временный пароль) не попадали в URL,
 * логи доступа и заголовок Referer. Значение читается один раз и сразу
 * удаляется.
 */
export async function setFlash(name: string, value: string): Promise<void> {
  const store = await cookies();
  store.set(`flash_${name}`, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60,
  });
}

/**
 * Читает флеш-значение из Server Component (страницы рендера). Next.js не
 * разрешает удалять cookie во время рендера — значение само истечёт через
 * 60 секунд (maxAge в setFlash), поэтому явного удаления здесь нет.
 */
export async function readFlash(name: string): Promise<string | null> {
  const store = await cookies();
  return store.get(`flash_${name}`)?.value ?? null;
}
