import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildJoinderDocx, buildSubscriptionDocx, type SubscriptionDocInput } from "@/lib/subscription/package-docx";
import { MANAGER_NAME, POOL_COUNTY, type WizardData } from "@/lib/subscription/types";

// Preview do pacote preenchido no wizard (público via token). Gera o DOCX ao vivo a
// partir do draft — depois de assinar, os documentos definitivos ficam no data room.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; kind: string }> }) {
  const { token, kind } = await params;
  const sub = await prisma.poolSubscription.findUnique({
    where: { token },
    include: { pool: { select: { name: true, code: true, unitPrice: true } } },
  });
  if (!sub) return new NextResponse("Not found", { status: 404 });

  const input: SubscriptionDocInput = {
    poolName: sub.pool.name,
    poolCode: sub.pool.code,
    managerName: MANAGER_NAME,
    county: POOL_COUNTY,
    unitPrice: Number(sub.unitPrice),
    data: (sub.data ?? {}) as WizardData,
    signName: sub.signName,
    signedAt: sub.signedAt,
    signIp: sub.signIp,
    signHash: sub.signHash,
  };
  const buf = kind === "joinder" ? await buildJoinderDocx(input) : await buildSubscriptionDocx(input);
  const name = kind === "joinder" ? "Amendment-and-Joinder.docx" : "Subscription-Agreement.docx";
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `inline; filename="${name}"`,
    },
  });
}
