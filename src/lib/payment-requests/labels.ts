export const PAYMENT_REQUEST_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Черновик",
  PENDING_APPROVAL: "На согласовании",
  APPROVED: "Согласована",
  REJECTED: "Отклонена",
  PAID: "Оплачена",
  CANCELLED: "Отменена",
  RETURNED: "На доработке",
};

export const PAYMENT_REQUEST_STATUS_BADGE: Record<string, string> = {
  DRAFT: "badge-archived",
  PENDING_APPROVAL: "badge-warning",
  APPROVED: "badge-active",
  REJECTED: "badge-danger",
  PAID: "badge-orange",
  CANCELLED: "badge-archived",
  RETURNED: "badge-warning",
};
