import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession, hasPermission } from "@/lib/session";
import { DICTIONARY_REGISTRY, getDictionaryConfig } from "@/lib/dictionaries/registry";
import { importKeyFields } from "@/lib/dictionaries/import-plan";
import { ARCHIVE_COLUMN_LABEL, ID_COLUMN_LABEL } from "@/lib/dictionaries/spreadsheet";
import { BANK_SHEET, CONTACT_SHEET } from "@/lib/counterparties/details-sheets";
import { importDictionaryAction, type ImportPreview } from "../../import-actions";
import { singleParams } from "@/lib/query-params";
import { SubmitButton } from "@/components/submit-button";

function parseJson<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export default async function ImportDictionaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ errors?: string; preview?: string }>;
}) {
  const { slug } = await params;
  if (!DICTIONARY_REGISTRY[slug]) notFound();
  const config = getDictionaryConfig(slug);
  const query = singleParams(await searchParams);
  const errors = (parseJson<unknown[]>(query.errors) ?? []).map(String);
  const preview = parseJson<ImportPreview>(query.preview);

  const session = await getSession();
  if (!session || !hasPermission(session, config.permissionManage)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для загрузки в «{config.title}».</div>
      </div>
    );
  }

  const keyLabels = importKeyFields(config.fields).map((name) => `«${config.fields.find((f) => f.name === name)?.label ?? name}»`);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Импорт из Excel: {config.title}</h1>
          <p>
            Колонки файла сопоставляются с полями по названию: {config.fields.map((f) => `«${f.label}»`).join(", ")}. Проще всего
            скачать выгрузку — она же готовый шаблон — и изменить или дописать строки. Для полей-списков указывайте название так,
            как оно показано в системе.
          </p>
        </div>
        <Link href={`/master-data/${slug}`} className="btn btn-secondary">
          Назад к списку
        </Link>
      </div>

      {errors.length > 0 ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="form-error" style={{ marginBottom: 8 }}>
            Файл не загружен — ничего не изменено. Исправьте ошибки и загрузите файл снова:
          </p>
          <ul style={{ paddingLeft: 18 }}>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {preview ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
            Проверка файла «{preview.fileName}» — ничего не сохранено
          </h2>
          <p className="form-success" style={{ marginBottom: 8 }}>
            Ошибок нет. Будет создано: {preview.created}, обновлено: {preview.updated}, без изменений: {preview.unchanged}
            {preview.skipped ? `, пропущено существующих: ${preview.skipped}` : ""}
            {preview.archiveMissing ? `, в архив (нет в файле): ${preview.archived}` : ""}
            {preview.details
              ? `. Реквизиты: новых ${preview.details.bankCreated}, изменится ${preview.details.bankUpdated}; контакты: новых ${preview.details.contactCreated}, изменится ${preview.details.contactUpdated}`
              : ""}
            .
          </p>
          {preview.lines.length > 0 ? (
            <ul style={{ paddingLeft: 18, fontSize: 13 }}>
              {preview.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          <p className="text-muted" style={{ marginTop: 8, fontSize: 12 }}>
            Чтобы применить, выберите тот же файл ниже и нажмите «Загрузить».
          </p>
        </div>
      ) : null}

      <div className="card" style={{ maxWidth: 760 }}>
        <form action={importDictionaryAction.bind(null, slug)}>
          <label className="field">
            <span>Файл (XLSX, XLS, CSV) *</span>
            <input type="file" name="file" id="import-file" accept=".xlsx,.xls,.csv" required />
          </label>
          <fieldset className="import-mode">
            <legend>Что делать с записями, которые уже есть</legend>
            <label>
              <input type="radio" name="mode" value="upsert" id="mode-upsert" defaultChecked={preview?.mode !== "create-only"} />
              Обновлять изменившиеся поля, новые — добавлять
            </label>
            <label>
              <input type="radio" name="mode" value="create-only" id="mode-create" defaultChecked={preview?.mode === "create-only"} />
              Не трогать, только добавлять новые
            </label>
          </fieldset>
          <label className="import-archive">
            <input type="checkbox" name="archiveMissing" id="archive-missing" defaultChecked={preview?.archiveMissing ?? false} />
            <span>
              Отправить в архив записи, которых нет в файле
              <span className="text-muted" style={{ display: "block", fontSize: 12 }}>
                Файл становится полным списком справочника: действующие записи, которых в нём нет, уйдут в архив (удаления в
                справочниках нет — запись из архива можно вернуть). Только в режиме обновления. Сначала нажмите «Проверить без
                сохранения» — список записей, которые уйдут в архив, будет в проверке.
              </span>
            </span>
          </label>
          <div className="form-actions">
            <SubmitButton name="intent" value="check" className="btn btn-secondary">
              Проверить без сохранения
            </SubmitButton>
            <SubmitButton name="intent" value="apply" className="btn btn-primary">
              Загрузить
            </SubmitButton>
            <a href={`/api/master-data/export?slug=${slug}`} className="btn btn-ghost">
              Скачать шаблон (текущие записи)
            </a>
          </div>
        </form>
      </div>

      <div className="card" style={{ maxWidth: 760, marginTop: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Как строки сопоставляются с записями</h2>
        <ul style={{ paddingLeft: 18, fontSize: 13, display: "grid", gap: 4 }}>
          <li>
            Строка с заполненной колонкой «{ID_COLUMN_LABEL}» (она есть в выгрузке) обновляет именно эту запись — так можно
            переименовать запись или поменять любой её реквизит.
          </li>
          {keyLabels.length > 0 ? (
            <li>
              Строка без ID ищет существующую запись по полям {keyLabels.join(" → ")}: одна найденная — обновляется, не нашлось —
              создаётся новая, нашлось несколько — ошибка с просьбой указать ID. Запись с другим ИНН по названию не подхватывается.
            </li>
          ) : (
            <li>Строка без ID всегда создаёт новую запись: чтобы изменить существующую, оставьте её ID из выгрузки.</li>
          )}
          <li>Обновляются только изменившиеся поля из колонок, которые есть в файле; пустая ячейка очищает необязательное поле.</li>
          <li>Колонка «{ARCHIVE_COLUMN_LABEL}»: «В архиве» отправляет запись в архив, «Активна» — возвращает.</li>
          <li>
            Флажок «Отправить в архив записи, которых нет в файле» убирает записи, удалённые из файла. Если ни одна строка файла не
            совпала с записями справочника, загрузка остановится — так случайный файл не отправит в архив весь справочник.
          </li>
          <li>
            Повторная загрузка того же файла ничего не меняет, а две строки про одну запись — ошибка: дублей не будет. Всё или
            ничего: при любой ошибке не меняется ни одна запись.
          </li>
          {slug === "counterparties" ? (
            <li>
              Листы «{BANK_SHEET}» и «{CONTACT_SHEET}» (есть в выгрузке) загружаются вместе с контрагентами: контрагент строки — по
              «ID контрагента», ИНН или наименованию, в том числе новый из этого же файла. Счёт сопоставляется по номеру и БИК,
              контакт — по имени; «да» в колонке «Основной» делает счёт (или контакт) основным. Строки, которых нет в файле, не удаляются.
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
