"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setObligationStatus } from "@/lib/actions/obligations";

type Status = "PENDING" | "FILED" | "NA";

const NEXT: Record<Status, Status> = { PENDING: "FILED", FILED: "NA", NA: "PENDING" };

export function ObligationStatusCell({
  companyId,
  oblKey,
  periodKey,
  status,
  overdue,
}: {
  companyId: string;
  oblKey: string;
  periodKey: string;
  status: Status;
  overdue: boolean;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  const cycle = () =>
    start(async () => {
      await setObligationStatus({ companyId, key: oblKey, periodKey, status: NEXT[status] });
      router.refresh();
    });

  const cls =
    status === "FILED"
      ? "bg-green-50 text-green-700 hover:bg-green-100"
      : status === "NA"
        ? "bg-slate-100 text-slate-500 hover:bg-slate-200"
        : overdue
          ? "bg-rose-50 text-rose-700 hover:bg-rose-100"
          : "bg-amber-50 text-amber-700 hover:bg-amber-100";
  const label =
    status === "FILED" ? "Filed ✓" : status === "NA" ? "N/A" : overdue ? "Overdue" : "Pending";

  return (
    <button
      onClick={cycle}
      disabled={pending}
      title="Click to change (Pending → Filed → N/A)"
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition disabled:opacity-50 ${cls}`}
    >
      {pending ? "…" : label}
    </button>
  );
}
