import { prisma } from "@/lib/db";
import { auth } from "@/auth";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await auth())) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const tr = await prisma.taxReturn.findUnique({
    where: { id },
    select: { pdf: true, fileName: true },
  });
  if (!tr?.pdf) return new Response("Not found", { status: 404 });

  const name = (tr.fileName || "tax-return.pdf").replace(/"/g, "");
  return new Response(new Blob([new Uint8Array(tr.pdf)], { type: "application/pdf" }), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
    },
  });
}
