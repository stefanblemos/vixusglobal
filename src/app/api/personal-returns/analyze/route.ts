import { revalidatePath } from "next/cache";
import { ingestPersonalReturn } from "@/lib/personal/ingest";

export const maxDuration = 300;

// Upload chunked (mesmo padrão do IR/corporate — dev server trunca corpos em ~10 MiB).
const uploads = new Map<
  string,
  { chunks: Buffer[]; total: number; fileName: string; partyId: string }
>();

async function finalize(fileName: string, buf: Buffer, partyId: string): Promise<Response> {
  if (buf.length === 0) return Response.json({ error: "Empty upload." }, { status: 400 });
  const res = await ingestPersonalReturn(fileName, buf, partyId || undefined);
  if (res.error) return Response.json({ error: res.error }, { status: 400 });
  revalidatePath("/tax/personal");
  return Response.json({ id: res.id });
}

export async function POST(req: Request): Promise<Response> {
  const fileName = decodeURIComponent(req.headers.get("x-filename") || "document.pdf");
  const partyId = req.headers.get("x-party-id") || "";
  const total = parseInt(req.headers.get("x-total-chunks") || "1", 10);
  const body = Buffer.from(await req.arrayBuffer());

  if (total <= 1) return finalize(fileName, body, partyId);

  const uploadId = req.headers.get("x-upload-id") || "";
  if (!uploadId) return Response.json({ error: "Missing upload id." }, { status: 400 });
  const index = parseInt(req.headers.get("x-chunk-index") || "0", 10);

  let entry = uploads.get(uploadId);
  if (!entry) {
    entry = { chunks: new Array<Buffer>(total), total, fileName, partyId };
    uploads.set(uploadId, entry);
  }
  entry.chunks[index] = body;

  const received = entry.chunks.filter(Boolean).length;
  if (received < total) return Response.json({ ok: true, received, total });

  uploads.delete(uploadId);
  return finalize(entry.fileName, Buffer.concat(entry.chunks), entry.partyId);
}
