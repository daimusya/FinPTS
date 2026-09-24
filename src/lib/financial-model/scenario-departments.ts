import { prisma } from "@/lib/db";

/** Подразделения, которые редактор сценария предлагает по умолчанию (раздел 15 ТЗ — минимум эти два). */
export const DEFAULT_DEPARTMENT_NAMES = ["Отдел обучения", "Отдел охраны труда"];
const FALLBACK_DEPARTMENT_COUNT = 6;

/**
 * Какие подразделения показать в сценарии:
 * — если список сценария уже зафиксирован (members), — он;
 * — иначе — подразделения по умолчанию;
 * плюс в любом случае все подразделения, по которым в сценарии уже есть
 * значения, — иначе они влияли бы на прогноз, не будучи видны в редакторе.
 */
export function pickScenarioDepartmentIds(input: {
  memberIds: string[];
  defaultIds: string[];
  idsWithValues: string[];
}): string[] {
  const base = input.memberIds.length > 0 ? input.memberIds : input.defaultIds;
  return [...new Set([...base, ...input.idsWithValues])];
}

export interface ScenarioDepartment {
  id: string;
  name: string;
  isArchived: boolean;
}

async function defaultDepartmentIds(): Promise<string[]> {
  const named = await prisma.department.findMany({
    where: { isArchived: false, name: { in: DEFAULT_DEPARTMENT_NAMES } },
    orderBy: { name: "asc" },
    select: { id: true },
  });
  if (named.length > 0) return named.map((d) => d.id);
  const first = await prisma.department.findMany({
    where: { isArchived: false },
    orderBy: { name: "asc" },
    take: FALLBACK_DEPARTMENT_COUNT,
    select: { id: true },
  });
  return first.map((d) => d.id);
}

/** Текущий список подразделений сценария (id), как его видит редактор. */
export async function scenarioDepartmentIds(scenarioId: string): Promise<string[]> {
  const [members, withValues] = await Promise.all([
    prisma.financialScenarioDepartment.findMany({ where: { scenarioId }, orderBy: { createdAt: "asc" }, select: { departmentId: true } }),
    prisma.financialScenarioValue.findMany({
      where: { scenarioId, dimension: { not: "" } },
      distinct: ["dimension"],
      select: { dimension: true },
    }),
  ]);
  return pickScenarioDepartmentIds({
    memberIds: members.map((m) => m.departmentId),
    defaultIds: members.length > 0 ? [] : await defaultDepartmentIds(),
    idsWithValues: withValues.map((v) => v.dimension),
  });
}

export async function loadScenarioDepartments(scenarioId: string): Promise<ScenarioDepartment[]> {
  const ids = await scenarioDepartmentIds(scenarioId);
  const rows = await prisma.department.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, isArchived: true } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

/**
 * Фиксирует текущий видимый список как явный список сценария — перед
 * первым добавлением или удалением, чтобы подразделения по умолчанию не
 * пропали из редактора.
 */
export async function materializeScenarioDepartments(scenarioId: string): Promise<void> {
  // Departments that are visible only because they have values get pinned too.
  const ids = await scenarioDepartmentIds(scenarioId);
  await prisma.financialScenarioDepartment.createMany({
    data: ids.map((departmentId) => ({ scenarioId, departmentId })),
    skipDuplicates: true,
  });
}
