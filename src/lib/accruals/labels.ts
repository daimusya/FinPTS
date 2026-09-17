export const ACCRUAL_DOCUMENT_TYPE_LABELS: Record<string, string> = {
  INVOICE: "Счёт",
  ACT: "Акт",
  UPD: "УПД",
  WAYBILL: "Накладная",
  SALE: "Реализация",
  RECEIPT: "Поступление",
  RETURN: "Возврат",
  CORRECTION: "Корректировка",
  MANUAL: "Ручное начисление",
};

export const ACCRUAL_DIRECTION_LABELS: Record<string, string> = {
  INCOME: "Доход",
  EXPENSE: "Расход",
};

export const ACCRUAL_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Черновик",
  POSTED: "Проведён",
  CANCELLED: "Отменён",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  UNPAID: "Не оплачено",
  PARTIALLY_PAID: "Частично оплачено",
  PAID: "Оплачено",
  OVERPAID: "Переплата",
};

export const PAYMENT_STATUS_BADGE: Record<string, string> = {
  UNPAID: "badge-danger",
  PARTIALLY_PAID: "badge-warning",
  PAID: "badge-active",
  OVERPAID: "badge-orange",
};
