import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { textToPdf } from "@/lib/ir/report-pdf";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await auth())) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as { year?: number; text?: string };
  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim()) return new Response("Missing text", { status: 400 });

  const company = await prisma.company.findUnique({ where: { id }, select: { legalName: true } });
  const title = `Accountant report — ${company?.legalName ?? "company"}${body.year ? ` (${body.year})` : ""}`;
  const pdf = await textToPdf(title, text);

  return new Response(new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="accountant-report-${body.year ?? ""}.pdf"`,
    },
  });
}
