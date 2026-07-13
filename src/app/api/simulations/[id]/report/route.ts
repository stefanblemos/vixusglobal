import { auth } from "@/auth";
import { Packer } from "docx";
import { buildReportData } from "@/lib/pools/report-data";
import { buildReportDocx } from "@/lib/pools/report-docx";
import { getReportProse } from "@/lib/pools/report-ai";

// Investment Summary (DOCX) da simulação — formato canônico aprovado; números frescos
// do catálogo + cenários + sensibilidade; mercado do ATTOM (src/data/market-stats.json).
// A prosa da Claude pode levar ~15s no primeiro download (depois vem do cache).
export const maxDuration = 60;
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

  // prosa viva (market commentary + closing) — cache por hash; falhou → sai sem ela
  const prose = await getReportProse(id, data);
  const buf = await Packer.toBuffer(buildReportDocx(data, recipient, prose));
  const safeName = data.simName.replace(/[^\w\s-]/g, "").trim() || "simulation";
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="Investment Summary - ${safeName}.docx"`,
    },
  });
}
