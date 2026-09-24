import { prisma } from "@/lib/db";
import { createCounterpartyByInnAction, refreshCounterpartyByInnAction } from "@/app/(app)/integrations/inn/actions";
import { getDadataApiKey } from "@/lib/integrations/inn-service";
import Link from "next/link";

const SOURCE_LABELS: Record<string, string> = { DADATA: "ЕГРЮЛ/ЕГРИП через DaData", "1C": "импорт из 1С" };

/** Карточка контрагента: откуда реквизиты и кнопка обновления по ИНН. */
export async function CounterpartyInnCard({ counterpartyId }: { counterpartyId: string }) {
  const [counterparty, serviceReady] = await Promise.all([
    prisma.counterparty.findUniqueOrThrow({ where: { id: counterpartyId } }),
    getDadataApiKey().then(Boolean),
  ]);
  return (
    <div className="card" style={{ maxWidth: 720, marginTop: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Реквизиты по ИНН</h2>
      <p className="text-muted" style={{ marginBottom: 10 }}>
        {counterparty.dataSource
          ? `Источник реквизитов: ${SOURCE_LABELS[counterparty.dataSource] ?? counterparty.dataSource}${
              counterparty.dataUpdatedAt ? `, обновлены ${counterparty.dataUpdatedAt.toLocaleString("ru-RU")}` : ""
            }.`
          : "Реквизиты введены вручную."}
      </p>
      {!counterparty.inn ? (
        <p className="text-muted">Укажите ИНН в форме выше, чтобы обновлять реквизиты из ЕГРЮЛ/ЕГРИП.</p>
      ) : serviceReady ? (
        <form action={refreshCounterpartyByInnAction.bind(null, counterpartyId)}>
          <button type="submit" className="btn btn-secondary">
            Обновить по ИНН {counterparty.inn}
          </button>
          <span className="text-muted" style={{ marginLeft: 10 }}>
            Наименование, КПП, ОГРН, юр. адрес, руководитель и статус будут заменены данными реестра.
          </span>
        </form>
      ) : (
        <p className="text-muted">
          Поиск по ИНН не настроен — ключ DaData задаётся в разделе{" "}
          <Link href="/integrations/inn">«Интеграции → Реквизиты по ИНН»</Link>.
        </p>
      )}
    </div>
  );
}

/** Список контрагентов: создание по ИНН. */
export function CounterpartyCreateByInn({ error }: { error?: string }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <form action={createCounterpartyByInnAction} className="filter-bar" style={{ marginBottom: 0 }}>
        <label className="field">
          <span>Добавить контрагента по ИНН</span>
          <input type="text" name="inn" inputMode="numeric" required placeholder="10 или 12 цифр" style={{ width: 180 }} />
        </label>
        <button type="submit" className="btn btn-secondary">
          Заполнить из ЕГРЮЛ/ЕГРИП
        </button>
      </form>
      {error ? (
        <p className="form-error" style={{ marginTop: 10 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
