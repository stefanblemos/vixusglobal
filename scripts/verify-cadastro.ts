import { companyCreateSchema } from "../src/lib/validation/company";
import { partyCreateSchema } from "../src/lib/validation/party";

let failures = 0;
function check(label: string, cond: boolean) {
  if (!cond) failures++;
  console.log(`${cond ? "OK  " : "FAIL"} | ${label}`);
}

// Empresa US + LLC → válida
const ok = companyCreateSchema.safeParse({
  legalName: "J Monteiro Investment LLC",
  tradeName: "",
  jurisdiction: "US",
  state: "FL",
  entityType: "LLC",
  taxId: "",
  fiscalYearEnd: "12-31",
  baseCurrency: "USD",
  relationship: "MANAGED_ONLY",
  notes: "",
});
check("US + LLC é válida", ok.success);
check("campos vazios viram null", ok.success && ok.data.tradeName === null);

// Empresa US + LDA (tipo português) → inválida
const bad = companyCreateSchema.safeParse({
  legalName: "Errada SA",
  jurisdiction: "US",
  entityType: "LDA",
  relationship: "GROUP_MEMBER",
});
check(
  "US + LDA é rejeitada (tipologia incompatível)",
  !bad.success && bad.error.issues.some((i) => i.path.includes("entityType")),
);

// Razão social vazia → inválida
const noName = companyCreateSchema.safeParse({
  legalName: "",
  jurisdiction: "BR",
  entityType: "LTDA",
  relationship: "GROUP_MEMBER",
});
check("razão social vazia é rejeitada", !noName.success);

// Moeda inválida → rejeitada
const badCur = companyCreateSchema.safeParse({
  legalName: "X",
  jurisdiction: "BR",
  entityType: "LTDA",
  relationship: "GROUP_MEMBER",
  baseCurrency: "Reais",
});
check("moeda fora do ISO-3 é rejeitada", !badCur.success);

// Party pessoa física → válida
const p = partyCreateSchema.safeParse({
  kind: "PERSON",
  name: "Patrick Geaquinto",
  taxJurisdiction: "US",
  taxId: "",
  notes: "",
});
check("Party pessoa física é válida", p.success);

console.log(failures === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${failures} FALHARAM`);
process.exit(failures === 0 ? 0 : 1);
