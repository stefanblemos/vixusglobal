// Data-fix (17/07/2026, aprovado pelo Stefan): a fase OBRA dos baselines congelados do
// Cronograma vinha dos eventos de CAIXA da simulação — o motor represa draws/pagamentos
// até o closing do loan, então o "início de obra previsto" de todas as casas foi arrastado
// p/ os dias de desembolso (e as 2 Maragogi do PH-4, com obra pronta antes do loan,
// ficaram com início = fim). O cronograma físico correto está nas units (tBuildStart→tCO).
// Reescreve SOMENTE buildStart/buildEnd de cada casa do baseline, re-extraídos da MESMA
// simulação apresentada — o princípio do congelamento fica intacto. Idempotente: no-op
// quando os valores já batem.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const pools = await prisma.investmentPool.findMany({
    where: { scheduleBaseline: { not: null } },
    include: {
      houses: { include: { catalogModel: true, catalogLocation: true } },
      simulations: { orderBy: { updatedAt: "desc" }, take: 1, select: { result: true } },
    },
  });
  for (const pool of pools) {
    const baseline = pool.scheduleBaseline;
    const res = pool.simulations[0]?.result;
    if (!baseline?.houses?.length || !res?.units?.length || !pool.startDate) continue;

    const dt = (day) => {
      const x = new Date(pool.startDate);
      x.setUTCDate(x.getUTCDate() + day);
      return x.toISOString().slice(0, 10);
    };
    // units por label, instâncias na ordem do EMD (mesma regra do extrator)
    const unitsByLabel = new Map();
    for (const u of res.units) {
      const arr = unitsByLabel.get(u.label) ?? [];
      arr.push(u);
      unitsByLabel.set(u.label, arr);
    }
    for (const arr of unitsByLabel.values()) arr.sort((a, b) => (a.tEmd ?? 0) - (b.tEmd ?? 0));

    // casas do baseline por label, na ordem em que aparecem (ordem de criação — mesma da extração)
    const seen = new Map(); // label -> próximo índice de instância
    let changed = 0;
    for (const bh of baseline.houses) {
      const i = seen.get(bh.label) ?? 0;
      seen.set(bh.label, i + 1);
      const u = (unitsByLabel.get(bh.label) ?? [])[i];
      if (!u || u.tBuildStart == null || u.tCO == null) continue;
      const start = dt(u.tBuildStart);
      const end = dt(u.tCO);
      if (bh.buildStart !== start || bh.buildEnd !== end) {
        console.log(`${pool.code} · ${bh.label} #${i + 1}: obra ${bh.buildStart}→${bh.buildEnd} ⇒ ${start}→${end}`);
        bh.buildStart = start;
        bh.buildEnd = end;
        changed++;
      }
    }
    if (changed > 0) {
      await prisma.investmentPool.update({
        where: { id: pool.id },
        data: { scheduleBaseline: JSON.parse(JSON.stringify(baseline)) },
      });
      console.log(`${pool.code}: ${changed} casas corrigidas no baseline`);
    } else {
      console.log(`${pool.code}: baseline já correto — nada a fazer`);
    }
  }
}

main().finally(() => prisma.$disconnect());
