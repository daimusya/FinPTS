import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession, hasPermission } from "@/lib/session";
import { DICTIONARY_REGISTRY, getDictionaryConfig } from "@/lib/dictionaries/registry";
import { DictionaryFormFields, resolveFieldDefault, type ResolvedField } from "@/components/dictionary-form-fields";
import { updateDictionaryItem } from "../../../actions";
import { CounterpartyDetails } from "@/components/counterparty-details";
import { CounterpartyInnCard } from "@/components/counterparty-inn";

export default async function EditDictionaryItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { slug, id } = await params;
  const { error, notice } = await searchParams;
  if (!DICTIONARY_REGISTRY[slug]) notFound();
  const config = getDictionaryConfig(slug);

  const session = await getSession();
  if (!session || !hasPermission(session, config.permissionManage)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для изменения записи в «{config.title}».</div>
      </div>
    );
  }

  const record = await config.delegate.findUnique({ where: { id } });
  if (!record) notFound();

  const resolvedFields: ResolvedField[] = await Promise.all(
    config.fields.map(async (field) => ({
      name: field.name,
      label: field.label,
      type: field.type,
      required: field.required,
      options: field.options ?? (field.loadOptions ? await field.loadOptions(id) : undefined),
      defaultValue: resolveFieldDefault(field.type, record[field.name]),
    })),
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Изменить: {config.singularTitle}</h1>
        </div>
        <Link href={`/master-data/${slug}`} className="btn btn-secondary">
          Назад к списку
        </Link>
      </div>

      <div className="card" style={{ maxWidth: 720 }}>
        {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}
        {notice ? <p className="form-success" style={{ marginBottom: 14 }}>{notice}</p> : null}
        <form action={updateDictionaryItem.bind(null, slug, id)}>
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

      {slug === "counterparties" ? <CounterpartyInnCard counterpartyId={id} /> : null}
      {slug === "counterparties" ? <CounterpartyDetails counterpartyId={id} /> : null}
    </div>
  );
}
