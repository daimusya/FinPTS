/**
 * Принцип «четырёх глаз» при согласовании заявки на оплату: автор не
 * согласует свою заявку, а согласовавший шаг маршрута не согласует в том же
 * круге следующий — иначе многошаговый маршрут сводится к одному человеку.
 * Полный администратор — исключение (единственный пользователь системы
 * должен иметь возможность решать; его решения видны в истории). Чистая
 * функция — проверяется тестами.
 */
export interface PriorDecision {
  approverId: string;
  decision: string;
  stepOrder: number | null;
  round: number;
}

export function approvalSeparationProblem(input: {
  isAdmin: boolean;
  userId: string;
  authorId: string;
  round: number;
  currentStep: number | null;
  decisions: PriorDecision[];
}): string | null {
  if (input.isAdmin) return null;
  if (input.userId === input.authorId) return "Свою заявку согласовать нельзя — её согласует другой сотрудник";
  const earlier = input.decisions.find(
    (d) => d.approverId === input.userId && d.decision === "approved" && d.round === input.round && d.stepOrder !== input.currentStep,
  );
  if (earlier) return `Вы уже согласовали шаг ${earlier.stepOrder ?? 1} этой заявки — следующий шаг согласует другой сотрудник`;
  return null;
}
