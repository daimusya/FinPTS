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
