import { revalidatePath } from "next/cache";
import { ingestTaxReturn } from "@/lib/ir/ingest";

export const maxDuration = 300; // análise de PDFs grandes pode demorar

// Uploads em pedaços (chunked) — o dev server do Next trunca corpos em ~10 MiB, então
// arquivos grandes chegam fatiados (<10 MB cada) e são remontados aqui.
const uploads = new Map<string, { chunks: Buffer[]; total: number; fileName: string }>();

async function finalize(fileName: string, buf: Buffer): Promise<Response> {
  if (buf.length === 0) return Response.json({ error: "Empty upload." }, { status: 400 });
  const res = await ingestTaxReturn(fileName, buf);
  if (res.error) return Response.json({ error: res.error }, { status: 400 });
  revalidatePath("/tax");
  if (res.companyId) revalidatePath(`/companies/${res.companyId}`);
  return Response.json({ id: res.id });
}

export async function POST(req: Request): Promise<Response> {
  const fileName = decodeURIComponent(req.headers.get("x-filename") || "tax-return.pdf");
  const total = parseInt(req.headers.get("x-total-chunks") || "1", 10);
  const body = Buffer.from(await req.arrayBuffer());

  // Arquivo pequeno: corpo único.
  if (total <= 1) return finalize(fileName, body);

  // Arquivo grande: acumula os pedaços até completar.
  const uploadId = req.headers.get("x-upload-id") || "";
  if (!uploadId) return Response.json({ error: "Missing upload id." }, { status: 400 });
  const index = parseInt(req.headers.get("x-chunk-index") || "0", 10);

  let entry = uploads.get(uploadId);
  if (!entry) {
    entry = { chunks: new Array<Buffer>(total), total, fileName };
    uploads.set(uploadId, entry);
  }
  entry.chunks[index] = body;

  const received = entry.chunks.filter(Boolean).length;
  if (received < total) return Response.json({ ok: true, received, total });

  uploads.delete(uploadId);
  return finalize(entry.fileName, Buffer.concat(entry.chunks));
}
