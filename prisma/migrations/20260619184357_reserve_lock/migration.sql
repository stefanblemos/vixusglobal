-- CreateTable
CREATE TABLE "ReserveLock" (
    "year" INTEGER NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "ReserveLock_pkey" PRIMARY KEY ("year")
);
