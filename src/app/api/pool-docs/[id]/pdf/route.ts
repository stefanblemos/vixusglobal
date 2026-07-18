import { prisma } from "@/lib/db";

// Download de documento do data room (PoolDocument) — mesmo padrão dos loan-docs
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await prisma.poolDocument.findUnique({ where: { id } });
  if (!doc?.pdf) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(doc.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${doc.fileName.replace(/[^\w.\- ]/g, "")}"`,
    },
  });
}
