/** Варианты «счёт или касса оплаты» организации для select (значение — bank:ID / cash:ID). */
export function PaymentAccountOptions({
  bankAccounts,
  cashAccounts,
}: {
  bankAccounts: Array<{ id: string; bankName: string; accountNumber: string }>;
  cashAccounts: Array<{ id: string; name: string }>;
}) {
  return (
    <>
      <option value="">— не назначен —</option>
      {bankAccounts.length > 0 ? (
        <optgroup label="Банковские счета">
          {bankAccounts.map((a) => (
            <option key={a.id} value={`bank:${a.id}`}>
              {a.bankName} · {a.accountNumber}
            </option>
          ))}
        </optgroup>
      ) : null}
      {cashAccounts.length > 0 ? (
        <optgroup label="Кассы">
          {cashAccounts.map((a) => (
            <option key={a.id} value={`cash:${a.id}`}>
              {a.name}
            </option>
          ))}
        </optgroup>
      ) : null}
    </>
  );
}
