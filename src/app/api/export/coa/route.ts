import { auth } from "@/auth";
import { ACCOUNT_SPECS } from "@/lib/coa/canonical";
import { toCsv, csvResponse } from "@/lib/export/csv";

// CSV das contas ESPECÍFICAS a criar/padronizar (formato de import de plano de contas do QBO:
// Account Name, Type, Detail Type, Description). Só estas — o resto fica no nativo do QBO.
export async function GET() {
  if (!(await auth())) return new Response("Unauthorized", { status: 401 });

  const rows: (string | number)[][] = [["Account Name", "Type", "Detail Type", "Description"]];
  for (const a of ACCOUNT_SPECS) {
    rows.push([a.name, a.qboType, a.qboDetail, `${a.action.toUpperCase()} — ${a.note ?? ""}`]);
  }
  return csvResponse(toCsv(rows), "vixus-contas-especificas-QBO.csv");
}
