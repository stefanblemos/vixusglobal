/**
 * Envio de e-mail transacional (#69) — Resend via HTTP (sem SDK/dependência nova).
 *
 * Configuração (variáveis de ambiente na Vercel):
 *   RESEND_API_KEY  — chave da conta Resend (re_...)
 *   MAIL_FROM       — remetente com domínio VERIFICADO, ex.: "Vixus <no-reply@vixusglobal.com>"
 *   MAIL_REPLY_TO   — (opcional) e-mail que recebe as respostas, ex.: stefan@4youhomes.com
 *
 * Enquanto não estiver configurado, sendMail devolve { sent:false, reason:"not-configured" }
 * SEM quebrar nada — quem chama continua exibindo o link para envio manual.
 */

export type MailResult = { sent: boolean; reason?: string; id?: string };

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

export async function sendMail(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<MailResult> {
  if (!mailConfigured()) return { sent: false, reason: "not-configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM,
        to: [args.to],
        subject: args.subject,
        html: args.html,
        text: args.text,
        ...(process.env.MAIL_REPLY_TO ? { reply_to: process.env.MAIL_REPLY_TO } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { sent: false, reason: `Resend ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = (await res.json()) as { id?: string };
    return { sent: true, id: data?.id };
  } catch (e) {
    return { sent: false, reason: (e as Error).message };
  }
}
