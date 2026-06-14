import { revalidatePath } from "next/cache";
import { ingestTaxReturn } from "@/lib/ir/ingest";

export const maxDuration = 300; // análise de PDFs grandes pode demorar

// Recebe o PDF como corpo cru (sem multipart — evita o parser que falha em arquivos grandes).
// O nome do arquivo vem no header x-filename.
export async function POST(req: Request) {
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) return Response.json({ error: "Empty upload." }, { status: 400 });

  const fileName = decodeURIComponent(req.headers.get("x-filename") || "tax-return.pdf");

  const res = await ingestTaxReturn(fileName, buf);
  if (res.error) return Response.json({ error: res.error }, { status: 400 });

  revalidatePath("/tax");
  if (res.companyId) revalidatePath(`/companies/${res.companyId}`);
  return Response.json({ id: res.id });
}
