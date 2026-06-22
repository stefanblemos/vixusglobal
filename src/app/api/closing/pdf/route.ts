import { auth } from "@/auth";
import { buildClosingPdf } from "@/lib/closing/closing-pdf";

// PDF da matriz de fechamento (closing) para enviar ao contador.
export async function GET(req: Request) {
  if (!(await auth())) return new Response("Unauthorized", { status: 401 });

  const yParam = new URL(req.url).searchParams.get("year");
  const year = yParam && /^\d{4}$/.test(yParam) ? Number(yParam) : new Date().getUTCFullYear() - 1;

  const generated = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const pdf = await buildClosingPdf(year, generated);

  return new Response(new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="closing-${year}.pdf"`,
    },
  });
}
