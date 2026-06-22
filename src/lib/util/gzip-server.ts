import { gunzipSync } from "node:zlib";

// Descomprime um texto gzip+base64 enviado pelo cliente (ver gzip-client.ts).
// Arquivos grandes (ex.: GL de 8 MB) estouram o limite de corpo de Server Action
// da Vercel (~4,5 MB); o cliente comprime antes de enviar e a action descomprime aqui.
export function gunzipB64(b64: string): string {
  return gunzipSync(Buffer.from(b64, "base64")).toString("utf8");
}
