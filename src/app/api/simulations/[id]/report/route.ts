import { auth } from "@/auth";
import { Packer } from "docx";
import { buildReportData } from "@/lib/pools/report-data";
import { buildReportDocx } from "@/lib/pools/report-docx";

// Investment Summary (DOCX) da simulação — formato canônico aprovado; números frescos
// do catálogo + cenários + sensibilidade; mercado do ATTOM (src/data/market-stats.json).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await auth())) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const url = new URL(req.url);
  const recipient = url.searchParams.get("for") ?? undefined;

  const data = await buildReportData(id);
  if ("error" in data) return new Response(data.error, { status: 400 });
  // O report só sai se o fechamento bater ao centavo — é a promessa do documento (A.4)
  if (Math.abs(data.closing.diff) > 0.01)
    return new Response(
      `Fechamento não bate ao centavo (diff ${data.closing.diff}) — report bloqueado.`,
      { status: 500 },
    );

  const buf = await Packer.toBuffer(buildReportDocx(data, recipient));
  const safeName = data.simName.replace(/[^\w\s-]/g, "").trim() || "simulation";
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="Investment Summary - ${safeName}.docx"`,
    },
  });
}
