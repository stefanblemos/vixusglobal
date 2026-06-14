import { computeEffectiveOwners, type OwnershipEdge } from "../src/lib/ownership/effective";

let failures = 0;
function check(label: string, got: string, expected: string) {
  const ok = got === expected;
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FAIL"} | ${label}: ${got} (esperado ${expected})`);
}

const e = (
  ownerType: "party" | "company",
  ownerId: string,
  ownedType: "party" | "company",
  ownedId: string,
  percentage: number,
): OwnershipEdge => ({ ownerType, ownerId, ownedType, ownedId, percentage });

// Estrutura:
//   Patrick 50% + Vanessa 50% -> J Monteiro (party JM)
//   J Monteiro 40% + L2 60% -> Vixus
//   personX 100% -> L2
//   Vixus 100% -> SubA
const edges: OwnershipEdge[] = [
  e("party", "patrick", "party", "jm", 50),
  e("party", "vanessa", "party", "jm", 50),
  e("party", "jm", "company", "vixus", 40),
  e("company", "l2", "company", "vixus", 60),
  e("party", "personX", "company", "l2", 100),
  e("company", "vixus", "company", "subA", 100),
];

// UBOs de SubA: Patrick 20, Vanessa 20, personX 60 (soma 100)
const ubo = computeEffectiveOwners("company", "subA", edges, { ultimateOnly: true });
const pct = (k: string) => (ubo.owners.find((o) => o.key === k)?.percentage ?? 0).toFixed(1);
check("UBO Patrick", pct("party:patrick"), "20.0");
check("UBO Vanessa", pct("party:vanessa"), "20.0");
check("UBO personX", pct("party:personX"), "60.0");
check("Cobertura UBO = 100%", ubo.coverage.toFixed(1), "100.0");
check("Só UBOs (3 nós)", String(ubo.owners.length), "3");

// Todos os ancestrais (inclui holdings intermediárias)
const all = computeEffectiveOwners("company", "subA", edges, { ultimateOnly: false });
const pctAll = (k: string) => (all.owners.find((o) => o.key === k)?.percentage ?? 0).toFixed(1);
check("Vixus (intermediária) 100%", pctAll("company:vixus"), "100.0");
check("J Monteiro efetivo 40%", pctAll("party:jm"), "40.0");
check("L2 efetivo 60%", pctAll("company:l2"), "60.0");

// Ciclo: A 100% -> B, B 100% -> A (cross-holding) não deve travar
const cyc = computeEffectiveOwners("company", "A", [
  e("company", "B", "company", "A", 100),
  e("company", "A", "company", "B", 100),
]);
check("Ciclo detectado", String(cyc.hasCycle), "true");

console.log(failures === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${failures} FALHARAM`);
process.exit(failures === 0 ? 0 : 1);
