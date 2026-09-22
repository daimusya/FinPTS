import Link from "next/link";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { createScenarioAction } from "../actions";

export default async function NewScenarioPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  const { error } = await searchParams;
  if (!session || !hasPermission(session, PERMISSIONS.FINANCIAL_MODEL_MANAGE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав.</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Новый сценарий</h1>
        <Link href="/financial-model" className="btn btn-secondary">
          Назад к списку
        </Link>
      </div>

      <div className="card" style={{ maxWidth: 480 }}>
        {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}
        <form action={createScenarioAction}>
          <div className="form-grid">
            <label className="field">
              <span>Название *</span>
              <input type="text" name="name" required />
            </label>
            <label className="field">
              <span>Тип</span>
              <select name="type" defaultValue="base">
                <option value="base">Базовый</option>
                <option value="optimistic">Оптимистичный</option>
                <option value="pessimistic">Пессимистичный</option>
                <option value="custom">Пользовательский</option>
              </select>
            </label>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Создать
            </button>
            <Link href="/financial-model" className="btn btn-secondary">
              Отмена
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
