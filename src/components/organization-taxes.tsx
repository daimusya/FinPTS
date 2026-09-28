import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatNumber } from "@/lib/money";
import {
  addTaxRateAction,
  fillStandardTaxRatesAction,
  removeTaxRateAction,
  updateTaxRateAction,
} from "@/app/(app)/master-data/organization-tax-actions";
import {
  isTaxKind,
  isTaxSystem,
  missingStandardRates,
  rateAt,
  TAX_KIND_LABELS,
  TAX_KINDS,
  TAX_SYSTEM_OPTIONS,
  validUntil,
} from "@/lib/organizations/taxes";

export interface OrganizationTaxesState {
  editTaxRateId?: string;
  taxError?: string;
  taxNotice?: string;
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const ru = (d: Date) => d.toLocaleDateString("ru-RU", { timeZone: "UTC" });

/**
 * Налоги организации: ставки по датам начала действия (история сохраняется,
 * новая запись заменяет прежнюю со своей даты), правка строки на месте,
 * удаление, добавление и заполнение стандартными ставками выбранной системы.
 */
export async function OrganizationTaxes({ organizationId, state = {} }: { organizationId: string; state?: OrganizationTaxesState }) {
  const [organization, rates] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { taxSystem: true } }),
    prisma.organizationTaxRate.findMany({ where: { organizationId }, orderBy: [{ taxKind: "asc" }, { validFrom: "desc" }] }),
  ]);
  const system = organization && isTaxSystem(organization.taxSystem) ? organization.taxSystem : "osn";
  const systemLabel = TAX_SYSTEM_OPTIONS.find((o) => o.value === system)?.label ?? system;
  const missing = missingStandardRates(system, rates);
  const today = new Date();
  const yearStart = `${today.getFullYear()}-01-01`;
  const base = `/master-data/organizations/${organizationId}/edit`;
  const current = TAX_KINDS.map((kind) => ({ kind, rate: rateAt(rates, kind, today) })).filter((c) => c.rate !== null);

  const kindSelect = (id: string, value?: string) => (
    <select name="taxKind" id={id} required defaultValue={value ?? ""}>
      <option value="">— выбрать —</option>
      {TAX_KINDS.map((k) => (
        <option key={k} value={k}>
          {TAX_KIND_LABELS[k]}
        </option>
      ))}
    </select>
  );

  return (
    <div className="card" id="taxes" style={{ maxWidth: 820, marginTop: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Налоги и ставки</h2>
      <p className="text-muted" style={{ marginBottom: 10 }}>
        Система налогообложения — {systemLabel} (меняется в форме выше). Ставка действует с указанной даты до даты
        следующей ставки того же налога: чтобы поменять ставку с нового года, добавьте запись с новой датой — прежние
        периоды посчитаются по старой ставке. Ставки используются в финансовых сценариях (налог «как у организации»);
        «Страховые взносы — единый тариф» и «Взносы на травматизм» заменяют общие ставки из справочника «Налоговые и
        страховые правила» в расчёте зарплаты этой организации.
      </p>
      {current.length > 0 ? (
        <p style={{ marginBottom: 10 }}>
          Сейчас действуют: {current.map((c) => `${TAX_KIND_LABELS[c.kind]} — ${formatNumber(c.rate!)}%`).join("; ")}.
        </p>
      ) : null}
      {state.taxError ? <p className="form-error" style={{ marginBottom: 10 }}>{state.taxError}</p> : null}
      {state.taxNotice ? <p className="form-success" style={{ marginBottom: 10 }}>{state.taxNotice}</p> : null}
      <div className="table-wrap" style={{ marginBottom: 14 }}>
        <table>
          <thead>
            <tr>
              <th>Налог</th>
              <th>Ставка</th>
              <th>Действует</th>
              <th>Комментарий</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rates.map((r) =>
              state.editTaxRateId === r.id ? (
                <tr key={r.id} className="row-editing">
                  <td colSpan={5}>
                    <form action={updateTaxRateAction.bind(null, organizationId, r.id)} className="form-grid" style={{ alignItems: "flex-end" }}>
                      <label className="field">
                        <span>Налог *</span>
                        {kindSelect(`tax-kind-${r.id}`, r.taxKind)}
                      </label>
                      <label className="field">
                        <span>Ставка, % *</span>
                        <input type="text" inputMode="decimal" name="ratePct" id={`tax-rate-${r.id}`} defaultValue={r.ratePct.toString()} required style={{ width: 100 }} />
                      </label>
                      <label className="field">
                        <span>Действует с *</span>
                        <input type="date" name="validFrom" id={`tax-from-${r.id}`} defaultValue={day(r.validFrom)} required />
                      </label>
                      <label className="field">
                        <span>Комментарий</span>
                        <input type="text" name="comment" id={`tax-comment-${r.id}`} defaultValue={r.comment ?? ""} />
                      </label>
                      <div className="form-actions">
                        <button type="submit" className="btn btn-primary btn-sm">
                          Сохранить
                        </button>
                        <Link href={`${base}#taxes`} className="btn btn-ghost btn-sm">
                          Отмена
                        </Link>
                      </div>
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={r.id}>
                  <td>{isTaxKind(r.taxKind) ? TAX_KIND_LABELS[r.taxKind] : r.taxKind}</td>
                  <td className="mono">{formatNumber(r.ratePct)}%</td>
                  <td>
                    {(() => {
                      const until = validUntil(rates, r);
                      return until ? `${ru(r.validFrom)} – ${ru(until)}` : `с ${ru(r.validFrom)}`;
                    })()}
                  </td>
                  <td>{r.comment ?? ""}</td>
                  <td>
                    <div className="row-actions">
                      <Link href={`${base}?editTaxRate=${r.id}#taxes`} className="btn btn-ghost btn-sm">
                        Изменить
                      </Link>
                      <form action={removeTaxRateAction.bind(null, organizationId, r.id)}>
                        <button type="submit" className="btn btn-ghost btn-sm">
                          Удалить
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ),
            )}
            {rates.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-state">
                  Ставок нет. Добавьте их ниже или заполните стандартными для системы налогообложения.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <form action={addTaxRateAction.bind(null, organizationId)} className="form-grid" style={{ alignItems: "flex-end", marginBottom: 12 }}>
        <label className="field">
          <span>Налог *</span>
          {kindSelect("tax-kind-new")}
        </label>
        <label className="field">
          <span>Ставка, % *</span>
          <input type="text" inputMode="decimal" name="ratePct" id="tax-rate-new" required style={{ width: 100 }} />
        </label>
        <label className="field">
          <span>Действует с *</span>
          <input type="date" name="validFrom" id="tax-from-new" required defaultValue={yearStart} />
        </label>
        <label className="field">
          <span>Комментарий</span>
          <input type="text" name="comment" id="tax-comment-new" placeholder="например, льгота по региону" />
        </label>
        <button type="submit" className="btn btn-secondary">
          Добавить ставку
        </button>
      </form>
      {missing.length > 0 ? (
        <form action={fillStandardTaxRatesAction.bind(null, organizationId)} className="form-grid" style={{ alignItems: "flex-end" }}>
          <label className="field">
            <span>Стандартные ставки с даты</span>
            <input type="date" name="validFrom" id="tax-standard-from" required defaultValue={yearStart} />
          </label>
          <button type="submit" className="btn btn-ghost">
            Заполнить стандартными: {missing.map((m) => `${TAX_KIND_LABELS[m.kind]} ${m.ratePct}%`).join(", ")}
          </button>
        </form>
      ) : null}
    </div>
  );
}
