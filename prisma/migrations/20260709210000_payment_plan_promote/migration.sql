-- CreateEnum
CREATE TYPE "SimPaymentPlan" AS ENUM ('STANDARD', 'LIGHT_START');

-- AlterEnum
ALTER TYPE "BuilderCompMode" ADD VALUE 'PROMOTE';

-- AlterTable
ALTER TABLE "PoolSimulation" ADD COLUMN     "paymentPlan" "SimPaymentPlan" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "perfTiming" TEXT NOT NULL DEFAULT 'PROJECT_COMPLETION',
ADD COLUMN     "promoteTiers" JSONB;

