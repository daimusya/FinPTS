-- CreateIndex
CREATE INDEX "accrual_document_lines_documentId_idx" ON "accrual_document_lines"("documentId");

-- CreateIndex
CREATE INDEX "accrual_document_lines_pnlArticleId_idx" ON "accrual_document_lines"("pnlArticleId");

-- CreateIndex
CREATE INDEX "accrual_document_lines_departmentId_idx" ON "accrual_document_lines"("departmentId");

-- CreateIndex
CREATE INDEX "accrual_document_lines_projectId_idx" ON "accrual_document_lines"("projectId");

-- CreateIndex
CREATE INDEX "audit_log_createdAt_idx" ON "audit_log"("createdAt");

-- CreateIndex
CREATE INDEX "audit_log_userId_createdAt_idx" ON "audit_log"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_accrualDocumentId_idx" ON "audit_log"("accrualDocumentId");

-- CreateIndex
CREATE INDEX "bank_accounts_organizationId_idx" ON "bank_accounts"("organizationId");

-- CreateIndex
CREATE INDEX "bank_transactions_bankAccountId_operationDate_idx" ON "bank_transactions"("bankAccountId", "operationDate");

-- CreateIndex
CREATE INDEX "bank_transactions_cashAccountId_operationDate_idx" ON "bank_transactions"("cashAccountId", "operationDate");

-- CreateIndex
CREATE INDEX "bank_transactions_counterpartyId_idx" ON "bank_transactions"("counterpartyId");

-- CreateIndex
CREATE INDEX "bank_transactions_cashFlowArticleId_idx" ON "bank_transactions"("cashFlowArticleId");

-- CreateIndex
CREATE INDEX "bank_transactions_batchId_idx" ON "bank_transactions"("batchId");

-- CreateIndex
CREATE INDEX "bank_transactions_departmentId_idx" ON "bank_transactions"("departmentId");

-- CreateIndex
CREATE INDEX "bank_transactions_projectId_idx" ON "bank_transactions"("projectId");

-- CreateIndex
CREATE INDEX "budget_entries_kind_year_organizationId_idx" ON "budget_entries"("kind", "year", "organizationId");

-- CreateIndex
CREATE INDEX "cash_accounts_organizationId_idx" ON "cash_accounts"("organizationId");

-- CreateIndex
CREATE INDEX "contracts_counterpartyId_idx" ON "contracts"("counterpartyId");

-- CreateIndex
CREATE INDEX "contracts_organizationId_idx" ON "contracts"("organizationId");

-- CreateIndex
CREATE INDEX "counterparties_inn_idx" ON "counterparties"("inn");

-- CreateIndex
CREATE INDEX "counterparty_bank_details_counterpartyId_idx" ON "counterparty_bank_details"("counterpartyId");

-- CreateIndex
CREATE INDEX "counterparty_contacts_counterpartyId_idx" ON "counterparty_contacts"("counterpartyId");

-- CreateIndex
CREATE INDEX "employee_project_allocations_employeeId_idx" ON "employee_project_allocations"("employeeId");

-- CreateIndex
CREATE INDEX "employees_organizationId_idx" ON "employees"("organizationId");

-- CreateIndex
CREATE INDEX "employees_departmentId_idx" ON "employees"("departmentId");

-- CreateIndex
CREATE INDEX "employment_history_employeeId_idx" ON "employment_history"("employeeId");

-- CreateIndex
CREATE INDEX "integration_external_objects_batchId_idx" ON "integration_external_objects"("batchId");

-- CreateIndex
CREATE INDEX "integration_external_objects_accrualDocumentId_idx" ON "integration_external_objects"("accrualDocumentId");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "payment_allocations_bankTransactionId_idx" ON "payment_allocations"("bankTransactionId");

-- CreateIndex
CREATE INDEX "payment_allocations_accrualDocumentId_idx" ON "payment_allocations"("accrualDocumentId");

-- CreateIndex
CREATE INDEX "payment_request_approvals_paymentRequestId_idx" ON "payment_request_approvals"("paymentRequestId");

-- CreateIndex
CREATE INDEX "payment_requests_organizationId_idx" ON "payment_requests"("organizationId");

-- CreateIndex
CREATE INDEX "payment_requests_counterpartyId_idx" ON "payment_requests"("counterpartyId");

-- CreateIndex
CREATE INDEX "payment_requests_createdById_idx" ON "payment_requests"("createdById");

-- CreateIndex
CREATE INDEX "payroll_allocations_payrollLineId_idx" ON "payroll_allocations"("payrollLineId");

-- CreateIndex
CREATE INDEX "payroll_lines_payrollRunId_idx" ON "payroll_lines"("payrollRunId");

-- CreateIndex
CREATE INDEX "payroll_lines_employeeId_idx" ON "payroll_lines"("employeeId");

-- CreateIndex
CREATE INDEX "payroll_runs_organizationId_idx" ON "payroll_runs"("organizationId");

-- CreateIndex
CREATE INDEX "user_roles_roleId_idx" ON "user_roles"("roleId");
