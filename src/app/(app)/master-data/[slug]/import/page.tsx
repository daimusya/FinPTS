import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession, hasPermission } from "@/lib/session";
import { DICTIONARY_REGISTRY, getDictionaryConfig } from "@/lib/dictionaries/registry";
import { importDictionaryAction } from "../../import-actions";

function parseErrors(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

export default async function ImportDictionaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ errors?: string }>;
}) {
  const { slug } = await params;
  if (!DICTIONARY_REGISTRY[slug]) notFound();
  const config = getDictionaryConfig(slug);
  const errors = parseErrors((await searchParams).errors);

  const session = await getSession();
  if (!session || !hasPermission(session, config.permissionManage)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для загрузки в «{config.title}».</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Импорт из Excel: {config.title}</h1>
          <p>
            Колонки файла сопоставляются с полями по названию: {config.fields.map((f) => `«${f.label}»`).join(", ")}.
            Проще всего скачать экспорт — он же готовый шаблон — и дописать строки. Для полей-списков указывайте
            название так, как оно показано в системе. Импорт только добавляет новые записи.
          </p>
        </div>
        <Link href={`/master-data/${slug}`} className="btn btn-secondary">
          Назад к списку
        </Link>
      </div>

      {errors.length > 0 ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="form-error" style={{ marginBottom: 8 }}>
            Файл не загружен — ни одна запись не создана. Исправьте ошибки и загрузите файл снова:
          </p>
          <ul style={{ paddingLeft: 18 }}>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="card" style={{ maxWidth: 720 }}>
        <form action={importDictionaryAction.bind(null, slug)}>
          <label className="field">
            <span>Файл (XLSX, XLS, CSV) *</span>
            <input type="file" name="file" accept=".xlsx,.xls,.csv" required />
          </label>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Загрузить
            </button>
            <a href={`/api/master-data/export?slug=${slug}`} className="btn btn-secondary">
              Скачать шаблон (текущие записи)
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}
