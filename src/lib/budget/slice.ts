/** Срез плана в редакторе: организация (или компания в целом) и не больше одного разреза. */
export interface BudgetSlice {
  organizationId: string | null;
  departmentId: string | null;
  costCenterId: string | null;
  projectId: string | null;
}

const PREFIX = { dep: "departmentId", cc: "costCenterId", prj: "projectId" } as const;

/** Разрез из адреса и форм: «» — без разреза, «dep:ID», «cc:ID», «prj:ID». */
export function parseDimKey(raw: unknown): Omit<BudgetSlice, "organizationId"> | null {
  const s = String(raw ?? "");
  const empty = { departmentId: null, costCenterId: null, projectId: null };
  if (s === "") return empty;
  const match = /^(dep|cc|prj):([A-Za-z0-9_-]{1,64})$/.exec(s);
  if (!match) return null;
  return { ...empty, [PREFIX[match[1] as keyof typeof PREFIX]]: match[2] };
}

export function dimKey(slice: Omit<BudgetSlice, "organizationId">): string {
  if (slice.departmentId) return `dep:${slice.departmentId}`;
  if (slice.costCenterId) return `cc:${slice.costCenterId}`;
  if (slice.projectId) return `prj:${slice.projectId}`;
  return "";
}

/**
 * Предупреждение о двойном счёте: в отчёте без фильтров план складывается из
 * всех уровней, поэтому план сразу «по компании и по организациям» или «без
 * разреза и по подразделениям», или по двум видам разрезов учтётся дважды.
 */
export function planLevelWarning(levels: BudgetSlice[]): string | null {
  const layers = new Set(
    levels.map((l) => (l.departmentId ? "подразделениям" : l.costCenterId ? "ЦФО" : l.projectId ? "проектам" : "base")),
  );
  const base = levels.filter((l) => !l.departmentId && !l.costCenterId && !l.projectId);
  const parts: string[] = [];
  if (base.some((l) => l.organizationId === null) && base.some((l) => l.organizationId !== null)) parts.push("по компании в целом и по организациям");
  const dims = [...layers].filter((l) => l !== "base");
  if (layers.has("base") && dims.length > 0) parts.push(`без разреза и по ${dims.join(", ")}`);
  else if (dims.length > 1) parts.push(`по ${dims.join(" и по ")}`);
  if (parts.length === 0) return null;
  return `План на этот год задан сразу ${parts.join("; ")}. В отчёте без фильтра все уровни складываются — план учтётся дважды. Оставьте один уровень или смотрите отчёт с фильтром по нужному разрезу.`;
}

/** Ограничение видимости пользователя (как AccessScope): null — не ограничено. */
export interface SliceScope {
  organizationIds: string[] | null;
  departmentIds: string[] | null;
  projectIds: string[] | null;
}

/**
 * Можно ли пользователю видеть и править этот срез плана; null — можно.
 * Ограничение по организациям — только их планы (план компании в целом закрыт);
 * по подразделениям или проектам — только срезы своих подразделений и
 * проектов: план организации без разреза и срезы ЦФО включают чужие данные.
 */
export function budgetSliceProblem(scope: SliceScope, slice: BudgetSlice): string | null {
  if (scope.organizationIds && (!slice.organizationId || !scope.organizationIds.includes(slice.organizationId))) {
    return "Нет доступа к плану этой организации";
  }
  if (!scope.departmentIds && !scope.projectIds) return null;
  if (slice.departmentId && scope.departmentIds?.includes(slice.departmentId)) return null;
  if (slice.projectId && scope.projectIds?.includes(slice.projectId)) return null;
  return scope.departmentIds && scope.projectIds
    ? "Доступны только планы ваших подразделений и проектов"
    : scope.departmentIds
      ? "Доступны только планы ваших подразделений"
      : "Доступны только планы ваших проектов";
}

/** Первый доступный срез для пользователя с ограничением по подразделениям/проектам (страница открывается на нём). */
export function defaultSliceDims(scope: SliceScope): Omit<BudgetSlice, "organizationId"> {
  const empty = { departmentId: null, costCenterId: null, projectId: null };
  if (scope.departmentIds?.length) return { ...empty, departmentId: scope.departmentIds[0] };
  if (scope.projectIds?.length) return { ...empty, projectId: scope.projectIds[0] };
  return empty;
}
