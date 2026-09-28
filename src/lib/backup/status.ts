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

/** Состояние второй копии по последнему успешному запуску: off — не настроена. */
export type MirrorState = "ok" | "failed" | "off";

export function mirrorState(mirrorStatus: string | null | undefined): MirrorState {
  return mirrorStatus === "ok" ? "ok" : mirrorStatus === "failed" ? "failed" : "off";
}

export async function loadBackupFreshness(
  now = new Date(),
): Promise<BackupFreshness & { lastSuccessAt: Date | null; mirror: MirrorState; mirrorDetails: string | null }> {
  const last = await prisma.backupRun.findFirst({
    where: { status: "success" },
    orderBy: { finishedAt: "desc" },
    select: { finishedAt: true, mirrorStatus: true, mirrorDetails: true },
  });
  const lastSuccessAt = last?.finishedAt ?? null;
  return { ...backupFreshness(lastSuccessAt, now), lastSuccessAt, mirror: mirrorState(last?.mirrorStatus), mirrorDetails: last?.mirrorDetails ?? null };
}
