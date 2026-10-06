/**
 * Проверки кадровых событий: увольнение, перевод, новый оклад. Чистые
 * функции — проверяются тестами; закрытые периоды проверяются в действиях.
 */
interface EmployeeState {
  status: string;
  hireDate: Date;
  terminationDate: Date | null;
}

const ru = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join(".");

export function terminationProblem(employee: EmployeeState, date: Date): string | null {
  if (employee.status === "TERMINATED") {
    return `Сотрудник уже уволен${employee.terminationDate ? ` ${ru(employee.terminationDate)}` : ""}`;
  }
  if (date < employee.hireDate) return `Дата увольнения раньше даты приёма (${ru(employee.hireDate)})`;
  return null;
}

export function transferProblem(employee: EmployeeState, date: Date): string | null {
  if (employee.status === "TERMINATED") return "Уволенного сотрудника перевести нельзя";
  if (date < employee.hireDate) return `Дата перевода раньше даты приёма (${ru(employee.hireDate)})`;
  return null;
}

export function salaryChangeProblem(employee: EmployeeState, from: Date): string | null {
  if (from < employee.hireDate) return `Новый оклад не может действовать раньше приёма (${ru(employee.hireDate)})`;
  if (employee.terminationDate && from > employee.terminationDate) return `Новый оклад не может действовать после увольнения (${ru(employee.terminationDate)})`;
  return null;
}

/** Новая доля занятости в проекте; null — можно сохранять. */
export function allocationProblem(input: {
  employee: { status: string; organizationId: string };
  project: { id: string; organizationId: string; isArchived: boolean } | null;
  sharePctRaw: string;
  active: Array<{ projectId: string; sharePct: number }>;
}): string | null {
  if (input.employee.status === "TERMINATED") return "Уволенного сотрудника нельзя распределить по проектам";
  if (!input.project || input.project.isArchived) return "Выберите проект";
  if (input.project.organizationId !== input.employee.organizationId) return "Проект другой организации — выберите проект организации сотрудника";
  const text = input.sharePctRaw.trim().replace(",", ".");
  const share = Number(text);
  if (!/^\d+(\.\d{1,2})?$/.test(text) || share <= 0 || share > 100) return "Доля занятости — число больше 0 и не больше 100";
  if (input.active.some((a) => a.projectId === input.project!.id)) return "Сотрудник уже распределён на этот проект — сначала завершите прежнюю долю";
  const busy = input.active.reduce((sum, a) => sum + a.sharePct, 0);
  if (busy + share > 100 + 1e-9) return `Вместе с действующими долями получится ${Math.round((busy + share) * 100) / 100}% — больше 100%`;
  return null;
}
