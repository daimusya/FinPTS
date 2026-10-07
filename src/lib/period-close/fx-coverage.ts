/**
 * Покрытие месяца курсами ЦБ: на каждый день месяца должен быть курс не
 * старше maxGapDays дней (ЦБ не публикует курсы в выходные и праздники —
 * самый длинный перерыв в январе). Справочник курсов в отчётах берёт
 * последний курс на дату или раньше, поэтому остановившаяся загрузка курсов
 * незаметно даёт пересчёт по устаревшему курсу. Чистая функция — проверяется
 * тестами.
 */
const DAY = 86_400_000;

const toKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const toMs = (key: string) => Date.parse(`${key}T00:00:00.000Z`);

/** Первый день периода без свежего курса или null. rateKeys — даты курсов «ГГГГ-ММ-ДД». */
export function firstUncoveredDay(rateKeys: string[], fromKey: string, toKeyIncl: string, maxGapDays = 10): string | null {
  const dates = [...new Set(rateKeys)].sort();
  let i = -1;
  for (let day = toMs(fromKey); day <= toMs(toKeyIncl); day += DAY) {
    while (i + 1 < dates.length && toMs(dates[i + 1]) <= day) i += 1;
    if (i < 0 || day - toMs(dates[i]) > maxGapDays * DAY) return toKey(day);
  }
  return null;
}

/** Текст проблемы по валютам («USD: нет свежего курса с 05.10.2026») или null. */
export function fxCoverageProblem(byCurrency: Map<string, string[]>, fromKey: string, toKeyIncl: string): string | null {
  const show = (key: string) => key.split("-").reverse().join(".");
  const problems = [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, keys]) => {
      const day = firstUncoveredDay(keys, fromKey, toKeyIncl);
      return day ? `${currency}: нет свежего курса ЦБ с ${show(day)}` : null;
    })
    .filter((p): p is string => p !== null);
  return problems.length > 0 ? problems.join("; ") : null;
}
