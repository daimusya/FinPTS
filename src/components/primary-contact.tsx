import Link from "next/link";

export interface PrimaryContactValue {
  name: string;
  position: string | null;
  phone: string | null;
  email: string | null;
}

/**
 * Основной контакт контрагента одной строкой: имя, должность, телефон и
 * почта (ссылками — позвонить и написать). Нет контакта — ссылка «добавить».
 */
export function PrimaryContact({ contact, counterpartyId }: { contact: PrimaryContactValue | null; counterpartyId: string }) {
  if (!contact) {
    return (
      <span className="text-muted">
        основной контакт не указан — <Link href={`/master-data/counterparties/${counterpartyId}/edit#contacts`}>добавить</Link>
      </span>
    );
  }
  return (
    <span>
      {contact.name}
      {contact.position ? <span className="text-muted">, {contact.position}</span> : null}
      {contact.phone ? (
        <>
          {" · "}
          <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>{contact.phone}</a>
        </>
      ) : null}
      {contact.email ? (
        <>
          {" · "}
          <a href={`mailto:${contact.email}`}>{contact.email}</a>
        </>
      ) : null}
    </span>
  );
}
