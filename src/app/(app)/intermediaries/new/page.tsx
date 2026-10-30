import Link from "next/link";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { IntermediaryForm, IntermediaryListUpload } from "../forms";

export default async function NewIntermediaryPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.CASH_MANAGE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для изменения списка посредников.</div>
      </div>
    );
  }
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Новый посредник</h1>
          <p>После сохранения добавьте его организации — или загрузите весь список из Word.</p>
        </div>
        <Link href="/intermediaries" className="btn btn-ghost">
          К дашборду
        </Link>
      </div>
      <div className="card">
        <IntermediaryForm />
      </div>
      <div className="card">
        <h2 className="section-title">Или весь список из Word</h2>
        <IntermediaryListUpload />
      </div>
    </div>
  );
}
