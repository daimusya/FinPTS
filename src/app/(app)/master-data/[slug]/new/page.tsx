import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession, hasPermission } from "@/lib/session";
import { DICTIONARY_REGISTRY, getDictionaryConfig } from "@/lib/dictionaries/registry";
import { DictionaryFormFields, resolveFieldDefault, type ResolvedField } from "@/components/dictionary-form-fields";
import { createDictionaryItem } from "../../actions";

export default async function NewDictionaryItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const { error } = await searchParams;
  if (!DICTIONARY_REGISTRY[slug]) notFound();
  const config = getDictionaryConfig(slug);

  const session = await getSession();
  if (!session || !hasPermission(session, config.permissionManage)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для добавления записи в «{config.title}».</div>
      </div>
    );
  }

  const resolvedFields: ResolvedField[] = await Promise.all(
    config.fields.map(async (field) => ({
      name: field.name,
      label: field.label,
      type: field.type,
      required: field.required,
      options: field.options ?? (field.loadOptions ? await field.loadOptions() : undefined),
      defaultValue: resolveFieldDefault(field.type, field.defaultValue),
    })),
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Новая запись: {config.singularTitle}</h1>
        </div>
        <Link href={`/master-data/${slug}`} className="btn btn-secondary">
          Назад к списку
        </Link>
      </div>

      <div className="card" style={{ maxWidth: 720 }}>
        {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}
        <form action={createDictionaryItem.bind(null, slug)}>
          <DictionaryFormFields fields={resolvedFields} />
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Сохранить
            </button>
            <Link href={`/master-data/${slug}`} className="btn btn-secondary">
              Отмена
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
