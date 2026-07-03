import { auth } from "@/auth";
import { CANONICAL_COA } from "@/lib/coa/canonical";
import { toCsv, csvResponse } from "@/lib/export/csv";

// CSV no formato de import de plano de contas do QBO (Account Name, Type, Detail Type, Number,
// Description). Importar em cada empresa deixa todas com o MESMO plano.
export async function GET() {
  if (!(await auth())) return new Response("Unauthorized", { status: 401 });

  const rows: (string | number)[][] = [["Account Name", "Type", "Detail Type", "Number", "Description"]];
  for (const a of CANONICAL_COA) {
    rows.push([a.name, a.qboType, a.qboDetail, a.code, a.note ?? ""]);
  }
  return csvResponse(toCsv(rows), "vixus-plano-de-contas-QBO.csv");
}
