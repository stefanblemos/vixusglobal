import { prisma } from "@/lib/db";
import { auth } from "@/auth";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await auth())) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const doc = await prisma.corporateDoc.findUnique({
    where: { id },
    select: { pdf: true, fileName: true },
  });
  if (!doc?.pdf) return new Response("Not found", { status: 404 });

  const name = (doc.fileName || "document.pdf").replace(/"/g, "");
  return new Response(new Blob([new Uint8Array(doc.pdf)], { type: "application/pdf" }), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
    },
  });
}
