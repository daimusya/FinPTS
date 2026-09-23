import { prisma } from "@/lib/db";
import {
  addBankDetailAction,
  addContactAction,
  removeBankDetailAction,
  removeContactAction,
} from "@/app/(app)/master-data/counterparty-actions";

export async function CounterpartyDetails({ counterpartyId }: { counterpartyId: string }) {
  const [bankDetails, contacts] = await Promise.all([
    prisma.counterpartyBankDetail.findMany({ where: { counterpartyId }, orderBy: { bankName: "asc" } }),
    prisma.counterpartyContact.findMany({ where: { counterpartyId }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <div className="card" style={{ maxWidth: 720, marginTop: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Банковские реквизиты</h2>
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
              {bankDetails.map((d) => (
                <tr key={d.id}>
                  <td>{d.bankName}</td>
                  <td className="mono">{d.account}</td>
                  <td className="mono">{d.bik ?? "—"}</td>
                  <td className="mono">{d.corrAccount ?? "—"}</td>
                  <td>
                    <form action={removeBankDetailAction.bind(null, counterpartyId, d.id)}>
                      <button type="submit" className="btn btn-ghost btn-sm">
                        Удалить
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
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
            <input type="text" name="bankName" required />
          </label>
          <label className="field">
            <span>Расчётный счёт * (20 цифр)</span>
            <input type="text" name="account" inputMode="numeric" required />
          </label>
          <label className="field">
            <span>БИК (9 цифр)</span>
            <input type="text" name="bik" inputMode="numeric" />
          </label>
          <label className="field">
            <span>Корр. счёт (20 цифр)</span>
            <input type="text" name="corrAccount" inputMode="numeric" />
          </label>
          <button type="submit" className="btn btn-secondary">
            Добавить реквизиты
          </button>
        </form>
      </div>

      <div className="card" style={{ maxWidth: 720, marginTop: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Контакты</h2>
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
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.position ?? "—"}</td>
                  <td>{c.phone ?? "—"}</td>
                  <td>{c.email ?? "—"}</td>
                  <td>
                    <form action={removeContactAction.bind(null, counterpartyId, c.id)}>
                      <button type="submit" className="btn btn-ghost btn-sm">
                        Удалить
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
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
            <input type="text" name="name" required />
          </label>
          <label className="field">
            <span>Должность</span>
            <input type="text" name="position" />
          </label>
          <label className="field">
            <span>Телефон</span>
            <input type="tel" name="phone" />
          </label>
          <label className="field">
            <span>Email</span>
            <input type="email" name="email" />
          </label>
          <button type="submit" className="btn btn-secondary">
            Добавить контакт
          </button>
        </form>
      </div>
    </>
  );
}
