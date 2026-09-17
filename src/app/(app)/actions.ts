"use server";

import { redirect } from "next/navigation";
import { destroySession, requireSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";

export async function logoutAction() {
  const session = await requireSession().catch(() => null);
  if (session) {
    await logAudit({
      userId: session.userId,
      entityType: "session",
      entityId: session.userId,
      action: "logout",
    });
  }
  await destroySession();
  redirect("/login");
}
