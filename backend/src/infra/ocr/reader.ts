import { setTimeout as wait } from "node:timers/promises";
import { AppError } from "../../core/errors.ts";
import type {
  ExtractedInvoice,
  InvoiceReader,
} from "../../core/invoices/types.ts";
import { GroqInvoiceReader } from "./groq.ts";
import { GeminiInvoiceReader } from "./gemini.ts";
import { OcrFailure, type OcrFailureKind } from "./transport.ts";

type ProviderName = "groq" | "openai" | "gemini";
interface Provider {
  name: ProviderName;
  read(
    file: Buffer,
    mime: string,
    signal: AbortSignal,
  ): Promise<ExtractedInvoice>;
}
export interface OcrEvent {
  event: "invoice_ocr";
  provider: ProviderName;
  outcome: "success" | "failure";
  attempt: number;
  elapsedMs: number;
  category?: OcrFailureKind;
  httpStatus?: number;
}
interface ReaderOptions {
  report?: (event: OcrEvent) => void;
  providers?: Provider[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}
const explanations: Record<OcrFailureKind, string> = {
  not_configured: "chave não configurada no backend",
  configuration: "modelo indisponível ou configuração inválida",
  authentication: "chave inválida ou sem permissão",
  quota: "cota ou saldo esgotado",
  rate_limit: "limite de uso atingido",
  unavailable: "serviço temporariamente indisponível",
  timeout: "tempo de resposta excedido",
  network: "falha de conexão",
  bad_request:
    "solicitação recusada pelo provedor; confira o arquivo e a configuração",
  invalid_response: "resposta incompleta ou fora do formato esperado",
  document_limit:
    "documento excede o limite de páginas ou tamanho deste provedor",
  conversion: "não foi possível converter o PDF em imagens",
  refused: "leitura recusada pelo provedor",
};

export class ResilientInvoiceReader implements InvoiceReader {
  private options: ReaderOptions;
  constructor(options: ReaderOptions = {}) {
    this.options = options;
  }
  async read(file: Buffer, mime: string) {
    const {
      report = () => {},
      now = () => performance.now(),
      sleep = (ms: number) => wait(ms),
      random = Math.random,
    } = this.options;
    const providers = this.options.providers ?? [
      new GroqInvoiceReader(),
      new GeminiInvoiceReader(),
    ];
    // Reserve 16s of the BFF's 60s deadline for database/storage operations.
    const deadline = now() + 44000;
    const failures: { name: ProviderName; error: OcrFailure }[] = [];
    for (const provider of providers) {
      const providerDeadline = Math.min(deadline, now() + 22000);
      let failure: OcrFailure | undefined;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const remaining = providerDeadline - now();
        if (remaining <= 0) break;
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          Math.min(20000, remaining),
        );
        const started = now();
        try {
          const data = await provider.read(file, mime, controller.signal);
          report({
            event: "invoice_ocr",
            provider: provider.name,
            outcome: "success",
            attempt,
            elapsedMs: Math.round(now() - started),
          });
          return data;
        } catch (error) {
          failure =
            error instanceof OcrFailure
              ? error
              : new OcrFailure(
                  controller.signal.aborted ? "timeout" : "invalid_response",
                );
          report({
            event: "invoice_ocr",
            provider: provider.name,
            outcome: "failure",
            attempt,
            elapsedMs: Math.round(now() - started),
            category: failure.kind,
            httpStatus: failure.httpStatus,
          });
        } finally {
          clearTimeout(timeout);
        }
        if (!failure.retryable || attempt === 2) break;
        const delay = Math.max(
          750 + Math.floor(random() * 250),
          failure.retryAfterMs ?? 0,
        );
        // Respect Retry-After without starving the fallback or stalling the request.
        if (providerDeadline - now() - delay < 5000) break;
        await sleep(delay);
      }
      const error = failure ?? new OcrFailure("timeout");
      failures.push({ name: provider.name, error });
      if (!error.fallbackAllowed || now() >= deadline) break;
    }
    const rejected = failures.some(({ error }) => !error.fallbackAllowed);
    const detail = failures
      .map(
        ({ name, error }) =>
          `${{ groq: "Groq", openai: "OpenAI", gemini: "Gemini" }[name]}: ${explanations[error.kind]}`,
      )
      .join(". ");
    throw new AppError(
      rejected ? 422 : 503,
      `Não foi possível concluir a leitura automática. ${detail}. Nenhum novo arquivo foi salvo; notas existentes foram preservadas.`,
    );
  }
}
