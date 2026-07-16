import { prisma } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await prisma.poolLoanDocument.findUnique({ where: { id } });
  if (!doc?.pdf) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(doc.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${doc.fileName.replace(/[^\w.\- ]/g, "")}"`,
    },
  });
}
