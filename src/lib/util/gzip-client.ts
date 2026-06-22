// Comprime texto (CSV/Excel→CSV) em gzip+base64 no navegador, para enviar a Server
// Actions sem estourar o limite de corpo da Vercel (~4,5 MB). CSV comprime ~8-10×.
// Usa CompressionStream (Chrome/Firefox/Safari modernos).
export async function gzipB64(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const buf = new Uint8Array(await new Response(cs.readable).arrayBuffer());

  // base64 em blocos (evita estourar a pilha do String.fromCharCode em arquivos grandes).
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
