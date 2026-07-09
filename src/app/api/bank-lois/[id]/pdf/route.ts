import { prisma } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loi = await prisma.bankLoi.findUnique({ where: { id } });
  if (!loi?.pdf) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(loi.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${loi.fileName.replace(/[^\w.\- ]/g, "")}"`,
    },
  });
}
