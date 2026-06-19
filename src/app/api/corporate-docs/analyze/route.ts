import { revalidatePath } from "next/cache";
import { ingestCorporateDoc } from "@/lib/corporate/ingest";
import { auth } from "@/auth";

export const maxDuration = 300;

// Upload chunked (mesmo padrão do IR — dev server trunca corpos em ~10 MiB).
const uploads = new Map<
  string,
  { chunks: Buffer[]; total: number; fileName: string; docType: string; docName: string; companyId: string }
>();

async function finalize(
  fileName: string,
  buf: Buffer,
  docType: string,
  docName: string,
  companyId: string,
): Promise<Response> {
  if (buf.length === 0) return Response.json({ error: "Empty upload." }, { status: 400 });
  const res = await ingestCorporateDoc(fileName, buf, docType, companyId || undefined, docName || undefined);
  if (res.error) return Response.json({ error: res.error }, { status: 400 });
  if (res.companyId) revalidatePath(`/companies/${res.companyId}`);
  return Response.json({ id: res.id });
}

export async function POST(req: Request): Promise<Response> {
  if (!(await auth())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const fileName = decodeURIComponent(req.headers.get("x-filename") || "document.pdf");
  const docType = req.headers.get("x-doc-type") || "";
  const docName = decodeURIComponent(req.headers.get("x-doc-name") || "");
  const companyId = req.headers.get("x-company-id") || "";
  const total = parseInt(req.headers.get("x-total-chunks") || "1", 10);
  const body = Buffer.from(await req.arrayBuffer());

  if (total <= 1) return finalize(fileName, body, docType, docName, companyId);

  const uploadId = req.headers.get("x-upload-id") || "";
  if (!uploadId) return Response.json({ error: "Missing upload id." }, { status: 400 });
  const index = parseInt(req.headers.get("x-chunk-index") || "0", 10);

  let entry = uploads.get(uploadId);
  if (!entry) {
    entry = { chunks: new Array<Buffer>(total), total, fileName, docType, docName, companyId };
    uploads.set(uploadId, entry);
  }
  entry.chunks[index] = body;

  const received = entry.chunks.filter(Boolean).length;
  if (received < total) return Response.json({ ok: true, received, total });

  uploads.delete(uploadId);
  return finalize(entry.fileName, Buffer.concat(entry.chunks), entry.docType, entry.docName, entry.companyId);
}
