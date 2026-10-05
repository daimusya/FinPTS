/**
 * Постраничный просмотр списков: номер страницы из адреса (?page=), границы
 * и «записи N–M из K». Чистая функция — проверяется тестами.
 */
export interface PageWindow {
  page: number;
  pages: number;
  skip: number;
  take: number;
  total: number;
  /** «Записи 201–400 из 1 250» или «Записей нет». */
  caption: string;
}

export function pageWindow(total: number, pageParam: string | undefined, size: number): PageWindow {
  const pages = Math.max(1, Math.ceil(total / size));
  const requested = Math.floor(Number(pageParam));
  const page = Number.isFinite(requested) && requested >= 1 ? Math.min(requested, pages) : 1;
  const skip = (page - 1) * size;
  const fmt = (n: number) => n.toLocaleString("ru-RU");
  const caption = total === 0 ? "Записей нет" : `Записи ${fmt(skip + 1)}–${fmt(Math.min(skip + size, total))} из ${fmt(total)}`;
  return { page, pages, skip, take: size, total, caption };
}

/** Адрес страницы с сохранением остальных параметров (фильтров). */
export function pageHref(basePath: string, params: Record<string, string | undefined>, page: number): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (key !== "page" && value) query.set(key, value);
  if (page > 1) query.set("page", String(page));
  const text = query.toString();
  return text ? `${basePath}?${text}` : basePath;
}
