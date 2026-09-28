import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  addBankDetailAction,
  addContactAction,
  removeBankDetailAction,
  removeContactAction,
  setPrimaryBankDetailAction,
  updateBankDetailAction,
  updateContactAction,
} from "@/app/(app)/master-data/counterparty-actions";

export interface CounterpartyDetailsState {
  /** Строка, открытая для правки (из адреса ?editBank= / ?editContact=). */
  editBankId?: string;
  editContactId?: string;
  bankError?: string;
  bankNotice?: string;
  contactError?: string;
  contactNotice?: string;
}

/**
 * Банковские реквизиты и контакты контрагента: список, правка строки на
 * месте (без JavaScript — режим правки задаётся адресом), удаление,
 * добавление; у реквизитов — отметка «основной счёт».
 */
export async function CounterpartyDetails({ counterpartyId, state = {} }: { counterpartyId: string; state?: CounterpartyDetailsState }) {
  const [bankDetails, contacts] = await Promise.all([
    prisma.counterpartyBankDetail.findMany({ where: { counterpartyId }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }),
    prisma.counterpartyContact.findMany({ where: { counterpartyId }, orderBy: { name: "asc" } }),
  ]);
  const base = `/master-data/counterparties/${counterpartyId}/edit`;

  return (
    <>
      <div className="card" id="bank-details" style={{ maxWidth: 820, marginTop: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Банковские реквизиты</h2>
        {state.bankError ? <p className="form-error" style={{ marginBottom: 10 }}>{state.bankError}</p> : null}
        {state.bankNotice ? <p className="form-success" style={{ marginBottom: 10 }}>{state.bankNotice}</p> : null}
        <div className="table-wrap" style={{ marginBottom: 14 }}>
          <table>
            <thead>
              <tr>
                <th>Банк</th>
                <th>Расчётный счёт</th>
                <th>БИК</th>
                <th>Корр. счёт</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bankDetails.map((d) =>
                state.editBankId === d.id ? (
                  <tr key={d.id} className="row-editing">
                    <td colSpan={5}>
                      <form action={updateBankDetailAction.bind(null, counterpartyId, d.id)} className="form-grid" style={{ alignItems: "flex-end" }}>
                        <label className="field">
                          <span>Банк *</span>
                          <input type="text" name="bankName" id={`bank-name-${d.id}`} defaultValue={d.bankName} required />
                        </label>
                        <label className="field">
                          <span>Расчётный счёт * (20 цифр)</span>
                          <input type="text" name="account" id={`bank-account-${d.id}`} inputMode="numeric" defaultValue={d.account} required />
                        </label>
                        <label className="field">
                          <span>БИК (9 цифр)</span>
                          <input type="text" name="bik" id={`bank-bik-${d.id}`} inputMode="numeric" defaultValue={d.bik ?? ""} />
                        </label>
                        <label className="field">
                          <span>Корр. счёт (20 цифр)</span>
                          <input type="text" name="corrAccount" id={`bank-corr-${d.id}`} inputMode="numeric" defaultValue={d.corrAccount ?? ""} />
                        </label>
                        <div className="form-actions">
                          <button type="submit" className="btn btn-primary btn-sm">
                            Сохранить
                          </button>
                          <Link href={`${base}#bank-details`} className="btn btn-ghost btn-sm">
                            Отмена
                          </Link>
                        </div>
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr key={d.id}>
                    <td>
                      {d.bankName}
                      {d.isPrimary ? (
                        <span className="badge badge-active" style={{ marginLeft: 8 }}>
                          основной
                        </span>
                      ) : null}
                    </td>
                    <td className="mono">{d.account}</td>
                    <td className="mono">{d.bik ?? "—"}</td>
                    <td className="mono">{d.corrAccount ?? "—"}</td>
                    <td>
                      <div className="row-actions">
                        {!d.isPrimary ? (
                          <form action={setPrimaryBankDetailAction.bind(null, counterpartyId, d.id)}>
                            <button type="submit" className="btn btn-ghost btn-sm">
                              Сделать основным
                            </button>
                          </form>
                        ) : null}
                        <Link href={`${base}?editBank=${d.id}#bank-details`} className="btn btn-ghost btn-sm">
                          Изменить
                        </Link>
                        <form action={removeBankDetailAction.bind(null, counterpartyId, d.id)}>
                          <button type="submit" className="btn btn-ghost btn-sm">
                            Удалить
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ),
              )}
              {bankDetails.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-state">
                    Реквизитов пока нет.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <form action={addBankDetailAction.bind(null, counterpartyId)} className="form-grid" style={{ alignItems: "flex-end" }}>
          <label className="field">
            <span>Банк *</span>
            <input type="text" name="bankName" id="new-bank-name" required />
          </label>
          <label className="field">
            <span>Расчётный счёт * (20 цифр)</span>
            <input type="text" name="account" id="new-bank-account" inputMode="numeric" required />
          </label>
          <label className="field">
            <span>БИК (9 цифр)</span>
            <input type="text" name="bik" id="new-bank-bik" inputMode="numeric" />
          </label>
          <label className="field">
            <span>Корр. счёт (20 цифр)</span>
            <input type="text" name="corrAccount" id="new-bank-corr" inputMode="numeric" />
          </label>
          {bankDetails.length > 0 ? (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input type="checkbox" name="isPrimary" id="new-bank-primary" />
              Сделать основным
            </label>
          ) : null}
          <button type="submit" className="btn btn-secondary">
            Добавить реквизиты
          </button>
        </form>
        <p className="text-muted" style={{ marginTop: 8, fontSize: 12 }}>
          Основной счёт — тот, на который платим по умолчанию; он показывается в заявках на оплату этому контрагенту. Первый
          добавленный счёт становится основным сам; при удалении основного основным становится следующий по порядку.
        </p>
      </div>

      <div className="card" id="contacts" style={{ maxWidth: 820, marginTop: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Контакты</h2>
        {state.contactError ? <p className="form-error" style={{ marginBottom: 10 }}>{state.contactError}</p> : null}
        {state.contactNotice ? <p className="form-success" style={{ marginBottom: 10 }}>{state.contactNotice}</p> : null}
        <div className="table-wrap" style={{ marginBottom: 14 }}>
          <table>
            <thead>
              <tr>
                <th>Имя</th>
                <th>Должность</th>
                <th>Телефон</th>
                <th>Email</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) =>
                state.editContactId === c.id ? (
                  <tr key={c.id} className="row-editing">
                    <td colSpan={5}>
                      <form action={updateContactAction.bind(null, counterpartyId, c.id)} className="form-grid" style={{ alignItems: "flex-end" }}>
                        <label className="field">
                          <span>Имя *</span>
                          <input type="text" name="name" id={`contact-name-${c.id}`} defaultValue={c.name} required />
                        </label>
                        <label className="field">
                          <span>Должность</span>
                          <input type="text" name="position" id={`contact-position-${c.id}`} defaultValue={c.position ?? ""} />
                        </label>
                        <label className="field">
                          <span>Телефон</span>
                          <input type="tel" name="phone" id={`contact-phone-${c.id}`} defaultValue={c.phone ?? ""} />
                        </label>
                        <label className="field">
                          <span>Email</span>
                          <input type="email" name="email" id={`contact-email-${c.id}`} defaultValue={c.email ?? ""} />
                        </label>
                        <div className="form-actions">
                          <button type="submit" className="btn btn-primary btn-sm">
                            Сохранить
                          </button>
                          <Link href={`${base}#contacts`} className="btn btn-ghost btn-sm">
                            Отмена
                          </Link>
                        </div>
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{c.position ?? "—"}</td>
                    <td>{c.phone ?? "—"}</td>
                    <td>{c.email ?? "—"}</td>
                    <td>
                      <div className="row-actions">
                        <Link href={`${base}?editContact=${c.id}#contacts`} className="btn btn-ghost btn-sm">
                          Изменить
                        </Link>
                        <form action={removeContactAction.bind(null, counterpartyId, c.id)}>
                          <button type="submit" className="btn btn-ghost btn-sm">
                            Удалить
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ),
              )}
              {contacts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-state">
                    Контактов пока нет.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <form action={addContactAction.bind(null, counterpartyId)} className="form-grid" style={{ alignItems: "flex-end" }}>
          <label className="field">
            <span>Имя *</span>
            <input type="text" name="name" id="new-contact-name" required />
          </label>
          <label className="field">
            <span>Должность</span>
            <input type="text" name="position" id="new-contact-position" />
          </label>
          <label className="field">
            <span>Телефон</span>
            <input type="tel" name="phone" id="new-contact-phone" />
          </label>
          <label className="field">
            <span>Email</span>
            <input type="email" name="email" id="new-contact-email" />
          </label>
          <button type="submit" className="btn btn-secondary">
            Добавить контакт
          </button>
        </form>
      </div>
    </>
  );
}
