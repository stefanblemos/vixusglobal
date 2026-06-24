import { auth } from "@/auth";
import { buildSequencePdf } from "@/lib/closing/sequence-pdf";

export async function GET(req: Request) {
  if (!(await auth())) return new Response("Unauthorized", { status: 401 });
  const yParam = new URL(req.url).searchParams.get("year");
  const year = yParam && /^\d{4}$/.test(yParam) ? Number(yParam) : new Date().getUTCFullYear() - 1;

  const generated = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  const pdf = await buildSequencePdf(year, generated);

  return new Response(new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="closing-sequence-${year}.pdf"`,
    },
  });
}
