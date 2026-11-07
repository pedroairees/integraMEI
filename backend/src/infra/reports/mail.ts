import nodemailer from "nodemailer";
import { AppError } from "../../core/errors.ts";
import type { ReportMailer } from "../../core/reports/types.ts";
export function smtpMailer(env: NodeJS.ProcessEnv = process.env): ReportMailer {
  const port = Number(env.SMTP_PORT || 587),
    from = env.REPORTS_FROM?.trim();
  const configured = !!(
    env.SMTP_HOST &&
    env.SMTP_USER &&
    env.SMTP_PASSWORD &&
    from &&
    /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from) &&
    [465, 587].includes(port)
  );
  return {
    configured,
    async send(to, files, id) {
      if (!configured)
        throw new AppError(
          503,
          "Envio de e-mail ainda não configurado. Configure SMTP no backend; o download continua disponível.",
        );
      const transport = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port,
        secure: port === 465,
        requireTLS: true,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 20000,
        tls: { minVersion: "TLSv1.2" },
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      try {
        const result = await transport.sendMail({
          from: { name: "IntegraMEI", address: from! },
          to,
          subject: "Relatório financeiro - IntegraMEI",
          text: "Segue o relatório solicitado pelo responsável pela empresa no IntegraMEI. Os arquivos seguem anexos. Esta mensagem não representa fechamento de período ou declaração fiscal.",
          messageId: `<report-${id}@${from!.split("@")[1]}>`,
          attachments: files.map((f) => ({
            filename: f.name,
            content: f.content,
            contentType: f.mime,
          })),
        });
        if (!result.accepted.length || result.rejected.length)
          throw new Error("SMTP rejected");
      } finally {
        transport.close();
      }
    },
  };
}
