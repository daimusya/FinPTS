-- AlterTable
ALTER TABLE "payment_request_approvals" ADD COLUMN     "stepOrder" INTEGER;

-- AlterTable
ALTER TABLE "payment_requests" ADD COLUMN     "currentStep" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "routeId" TEXT;

-- CreateTable
CREATE TABLE "payment_approval_routes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "minAmount" DECIMAL(18,2),
    "maxAmount" DECIMAL(18,2),
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_approval_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_approval_route_steps" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "payment_approval_route_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_approval_routes_priority_idx" ON "payment_approval_routes"("priority");

-- CreateIndex
CREATE UNIQUE INDEX "payment_approval_route_steps_routeId_stepOrder_key" ON "payment_approval_route_steps"("routeId", "stepOrder");

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "payment_approval_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_approval_routes" ADD CONSTRAINT "payment_approval_routes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_approval_route_steps" ADD CONSTRAINT "payment_approval_route_steps_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "payment_approval_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_approval_route_steps" ADD CONSTRAINT "payment_approval_route_steps_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
