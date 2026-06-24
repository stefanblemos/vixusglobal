import Anthropic from "@anthropic-ai/sdk";

// Constrói o "source" de um PDF para a Messages API. Inline base64 é simples, mas o corpo da
// requisição da Anthropic é limitado a ~32 MB — um PDF escaneado em alta resolução estoura isso
// (26 MB de arquivo viram ~35 MB em base64) e a API responde 413 request_too_large. Acima do
// limite, subimos o arquivo pela Files API e referenciamos por file_id (corpo minúsculo); a
// Anthropic busca o arquivo do lado dela. O limite de 100 páginas do PDF continua valendo.

export const FILES_API_BETA = "files-api-2025-04-14";

// base64 cresce ~4/3; mantemos folga sob 32 MB → arquivos acima de 20 MB vão pela Files API.
const INLINE_MAX_BYTES = 20 * 1024 * 1024;

type DocSource =
  | { type: "base64"; media_type: "application/pdf"; data: string }
  | { type: "file"; file_id: string };

export type PdfSource = { source: DocSource; fileId?: string; usesFilesApi: boolean };

export async function buildPdfSource(client: Anthropic, buf: Buffer): Promise<PdfSource> {
  if (buf.length <= INLINE_MAX_BYTES) {
    return {
      source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") },
      usesFilesApi: false,
    };
  }
  const uploaded = await client.beta.files.upload(
    { file: await Anthropic.toFile(new Uint8Array(buf), "document.pdf", { type: "application/pdf" }) },
    { headers: { "anthropic-beta": FILES_API_BETA } },
  );
  return { source: { type: "file", file_id: uploaded.id }, fileId: uploaded.id, usesFilesApi: true };
}

// Opções extras da requisição messages (cabeçalho beta quando se usa file_id).
export function pdfRequestOptions(pdf: PdfSource): { headers: Record<string, string> } | undefined {
  return pdf.usesFilesApi ? { headers: { "anthropic-beta": FILES_API_BETA } } : undefined;
}

// Remove o arquivo temporário da Files API depois da análise (best-effort).
export async function cleanupPdfSource(client: Anthropic, pdf: PdfSource): Promise<void> {
  if (!pdf.fileId) return;
  try {
    await client.beta.files.delete(pdf.fileId, { betas: [FILES_API_BETA] });
  } catch {
    // arquivo expira sozinho; ignore falha de limpeza
  }
}
