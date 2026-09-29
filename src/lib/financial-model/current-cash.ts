import { bankTransactionScopeWhere, type AccessScope } from "@/lib/access-scope";
import { cashBalanceRub } from "@/lib/currency-rates";

/** Текущий фактический остаток денег — стартовая точка прогноза сценария (валютные счета — по курсу ЦБ на сегодня). */
export async function getCurrentCashBalance(scope: AccessScope): Promise<number> {
  const { total } = await cashBalanceRub(bankTransactionScopeWhere(scope));
  return total.toNumber();
}
