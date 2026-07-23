/**
 * Templates dos e-mails transacionais (#69). HTML simples e robusto (tabelas + inline
 * styles — clientes de e-mail ignoram CSS externo). Sempre acompanham a versão texto.
 */

const NAVY = "#1f3a5f";

function shell(title: string, body: string, footer: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;border:1px solid #e2e8f0;">
        <tr><td style="padding:26px 30px 8px;">
          <div style="font-size:19px;font-weight:700;letter-spacing:.5px;color:${NAVY};">VIXUS<span style="color:#8DC63F;">.</span></div>
          <div style="font-size:12px;color:#94a3b8;margin-top:2px;">Portal do investidor</div>
        </td></tr>
        <tr><td style="padding:10px 30px 4px;">
          <h1 style="margin:0 0 10px;font-size:19px;line-height:1.35;color:#0f172a;font-weight:700;">${title}</h1>
          ${body}
        </td></tr>
        <tr><td style="padding:18px 30px 26px;border-top:1px solid #f1f5f9;">
          <p style="margin:12px 0 0;font-size:11.5px;line-height:1.6;color:#94a3b8;">${footer}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 6px;"><tr>
    <td style="background:${NAVY};border-radius:10px;">
      <a href="${href}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${label}</a>
    </td></tr></table>`;
}

// Convite/renovação de acesso ao portal — o link é o magic-link (uso único, curto).
export function portalInviteEmail(args: {
  entityName: string;
  link: string;
  expiresMin: number;
  returning: boolean; // já tinha acesso antes (reenvio) × primeiro convite
}): { subject: string; html: string; text: string } {
  const subject = args.returning
    ? "Seu novo link de acesso ao portal Vixus"
    : "Seu acesso ao portal do investidor Vixus";
  const intro = args.returning
    ? `Aqui está um novo link para acessar o portal da <b>${args.entityName}</b>.`
    : `Você foi habilitado a acompanhar os investimentos da <b>${args.entityName}</b> no portal da Vixus.`;

  const html = shell(
    args.returning ? "Novo link de acesso" : "Bem-vindo ao portal do investidor",
    `<p style="margin:0;font-size:14.5px;line-height:1.65;color:#334155;">${intro}</p>
     <p style="margin:10px 0 0;font-size:14.5px;line-height:1.65;color:#334155;">
       No portal você acompanha sua posição, o valor atual, as distribuições, o extrato e seus documentos fiscais.
       <b>Não é preciso criar senha</b> — é só clicar no botão abaixo.
     </p>
     ${button(args.link, "Entrar no portal")}
     <p style="margin:8px 0 0;font-size:12px;line-height:1.6;color:#64748b;">
       Se o botão não funcionar, copie e cole este endereço no navegador:<br>
       <span style="color:${NAVY};word-break:break-all;">${args.link}</span>
     </p>`,
    `Este link é pessoal, vale por ${args.expiresMin} minutos e pode ser usado uma única vez. Se expirar, peça um novo. Se você não esperava este e-mail, pode ignorá-lo.`,
  );

  const text = [
    args.returning ? "Novo link de acesso ao portal Vixus" : "Bem-vindo ao portal do investidor Vixus",
    "",
    args.returning
      ? `Aqui está um novo link para acessar o portal da ${args.entityName}.`
      : `Você foi habilitado a acompanhar os investimentos da ${args.entityName} no portal da Vixus.`,
    "",
    "Acesse (sem senha):",
    args.link,
    "",
    `O link é pessoal, vale por ${args.expiresMin} minutos e pode ser usado uma única vez.`,
  ].join("\n");

  return { subject, html, text };
}

// Distribuição registrada (#69). NUNCA traz instrução de wire — leva ao portal. Quando a
// conta ainda não foi confirmada, a cópia vira um lembrete para confirmar e poder receber.
export function distributionEmail(args: {
  entityName: string;
  poolName: string;
  kind: "RETURN_OF_CAPITAL" | "PROFIT";
  portalUrl: string;
  needsAccount: boolean; // conta não confirmada (pendente/sem conta)
}): { subject: string; html: string; text: string } {
  const kindLabel = args.kind === "PROFIT" ? "lucro" : "retorno de capital";
  const subject = args.needsAccount
    ? `Confirme seus dados para receber — ${args.poolName}`
    : `Há uma distribuição na sua posição — ${args.poolName}`;

  const lead = `Registramos uma distribuição de <b>${kindLabel}</b> referente à <b>${args.poolName}</b>. O valor da sua posição já está no seu extrato no portal.`;
  const cta = args.needsAccount
    ? `Para <b>receber o pagamento</b>, confirme seus dados de recebimento no portal (leva 1 minuto). Por segurança, <b>nunca</b> enviamos ou alteramos instruções bancárias por e-mail.`
    : `Você pode acompanhar o pagamento pelo portal. Por segurança, <b>nunca</b> enviamos ou alteramos instruções bancárias por e-mail.`;

  const html = shell(
    args.needsAccount ? "Confirme seus dados de recebimento" : "Uma distribuição foi registrada",
    `<p style="margin:0;font-size:14.5px;line-height:1.65;color:#334155;">Olá, ${args.entityName}.</p>
     <p style="margin:10px 0 0;font-size:14.5px;line-height:1.65;color:#334155;">${lead}</p>
     <p style="margin:10px 0 0;font-size:14.5px;line-height:1.65;color:#334155;">${cta}</p>
     ${button(args.portalUrl, args.needsAccount ? "Confirmar no portal" : "Abrir o portal")}`,
    `Instruções de pagamento existem apenas dentro do portal, após login. Se você não reconhece este e-mail, ignore-o.`,
  );

  const text = [
    args.needsAccount ? "Confirme seus dados de recebimento — Vixus" : "Uma distribuição foi registrada — Vixus",
    "",
    `Olá, ${args.entityName}.`,
    `Registramos uma distribuição de ${kindLabel} referente à ${args.poolName}.`,
    "",
    args.needsAccount
      ? "Para receber o pagamento, confirme seus dados de recebimento no portal:"
      : "Acompanhe pelo portal:",
    args.portalUrl,
    "",
    "Por segurança, nunca enviamos ou alteramos instruções bancárias por e-mail.",
  ].join("\n");

  return { subject, html, text };
}

// Report mensal publicado (#69).
export function reportPublishedEmail(args: {
  entityName: string;
  poolName: string;
  period: string; // "julho de 2026" etc. (já formatado)
  portalUrl: string;
}): { subject: string; html: string; text: string } {
  const subject = `Novo relatório — ${args.poolName} (${args.period})`;
  const html = shell(
    "Seu relatório mensal está disponível",
    `<p style="margin:0;font-size:14.5px;line-height:1.65;color:#334155;">Olá, ${args.entityName}.</p>
     <p style="margin:10px 0 0;font-size:14.5px;line-height:1.65;color:#334155;">
       O relatório de <b>${args.period}</b> da <b>${args.poolName}</b> já está disponível no portal, com a sua
       posição, o andamento do projeto e os documentos.
     </p>
     ${button(args.portalUrl, "Ver relatório")}`,
    `Somente leitura. Você vê apenas a sua posição — nunca outros sócios ou números internos da gestão.`,
  );
  const text = [
    "Seu relatório mensal está disponível — Vixus",
    "",
    `Olá, ${args.entityName}.`,
    `O relatório de ${args.period} da ${args.poolName} já está no portal.`,
    "",
    args.portalUrl,
  ].join("\n");
  return { subject, html, text };
}
