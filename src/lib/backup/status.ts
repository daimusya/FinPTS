import { prisma } from "@/lib/db";

/** Ежедневная копия плюс запас на задержку планировщика. */
export const BACKUP_MAX_AGE_HOURS = 26;

export interface BackupFreshness {
  /** ok — свежая копия есть; stale — последняя успешная старше BACKUP_MAX_AGE_HOURS; never — ни одной. */
  state: "ok" | "stale" | "never";
  ageHours: number | null;
}

export function backupFreshness(lastSuccessAt: Date | null, now: Date): BackupFreshness {
  if (!lastSuccessAt) return { state: "never", ageHours: null };
  const ageHours = Math.max(0, (now.getTime() - lastSuccessAt.getTime()) / 3_600_000);
  return { state: ageHours > BACKUP_MAX_AGE_HOURS ? "stale" : "ok", ageHours: Math.round(ageHours * 10) / 10 };
}

export async function loadBackupFreshness(now = new Date()): Promise<BackupFreshness & { lastSuccessAt: Date | null }> {
  const last = await prisma.backupRun.findFirst({
    where: { status: "success" },
    orderBy: { finishedAt: "desc" },
    select: { finishedAt: true },
  });
  const lastSuccessAt = last?.finishedAt ?? null;
  return { ...backupFreshness(lastSuccessAt, now), lastSuccessAt };
}
