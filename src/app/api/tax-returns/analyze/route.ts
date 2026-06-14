import { revalidatePath } from "next/cache";
import { ingestTaxReturn } from "@/lib/ir/ingest";

export const maxDuration = 300; // análise de PDFs grandes pode demorar

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "Choose a PDF file first." }, { status: 400 });
  }
  if (file.type && file.type !== "application/pdf") {
    return Response.json({ error: "Only PDF files are supported." }, { status: 400 });
  }

  const res = await ingestTaxReturn(file.name, Buffer.from(await file.arrayBuffer()));
  if (res.error) return Response.json({ error: res.error }, { status: 400 });

  revalidatePath("/tax");
  if (res.companyId) revalidatePath(`/companies/${res.companyId}`);
  return Response.json({ id: res.id });
}
