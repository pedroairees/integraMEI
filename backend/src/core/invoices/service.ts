import { createHash, randomUUID } from "node:crypto";
import { AppError } from "../errors.ts";
import type {
  ExtractedInvoice,
  Invoice,
  InvoiceReader,
  InvoiceRepository,
} from "./types.ts";

export const MAX_FILE_SIZE = 5 * 1024 * 1024;
export const MAX_UPLOAD_BODY = 7 * 1024 * 1024;
export const emptyExtraction = (): ExtractedInvoice => ({
  supplier: null,
  cnpj: null,
  recipientCnpj: null,
  operation: null,
  number: null,
  date: null,
  total: null,
  items: [],
});

// Treat OCR as untrusted input, not financial truth. No supplied code/URLs are executed.
export function parseExtraction(
  input: unknown,
  required = false,
): ExtractedInvoice {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new AppError(
      422,
      "Não foi possível ler os dados da nota. Revise manualmente.",
    );
  const value = input as Record<string, unknown>;
  const text = (key: string, max: number) =>
    typeof value[key] === "string"
      ? value[key].trim().slice(0, max) || null
      : null;
  const cnpj = text("cnpj", 30)?.replace(/\D/g, "") ?? null;
  const recipientCnpj = text("recipientCnpj", 30)?.replace(/\D/g, "") ?? null;
  const date = text("date", 10);
  const parsed: ExtractedInvoice = {
    supplier: text("supplier", 200),
    cnpj: cnpj && /^\d{14}$/.test(cnpj) ? cnpj : null,
    recipientCnpj:
      recipientCnpj && /^\d{14}$/.test(recipientCnpj) ? recipientCnpj : null,
    operation:
      value.operation === "sale" ||
      value.operation === "service" ||
      value.operation === "other"
        ? value.operation
        : null,
    number: text("number", 80),
    date:
      date &&
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      !Number.isNaN(Date.parse(date)) &&
      new Date(date).toISOString().slice(0, 10) === date
        ? date
        : null,
    total:
      typeof value.total === "number" &&
      Number.isFinite(value.total) &&
      value.total >= 0 &&
      value.total <= 999999999.99
        ? Math.round(value.total * 100) / 100
        : null,
    items: Array.isArray(value.items)
      ? value.items
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim().slice(0, 500))
          .filter(Boolean)
          .slice(0, 200)
      : [],
  };
  if (
    required &&
    (!parsed.supplier ||
      !parsed.cnpj ||
      !parsed.date ||
      parsed.total === null ||
      !parsed.items.length)
  )
    throw new AppError(
      422,
      "Preencha emitente, CNPJ, data válida, valor total e pelo menos um item.",
    );
  return parsed;
}

export function validateUpload(input: {
  name: string;
  mime: string;
  content: string;
}) {
  if (
    !input.name.trim() ||
    input.name.length > 200 ||
    /[\x00-\x1f\\/]/.test(input.name)
  )
    throw new AppError(400, "Nome de arquivo inválido.");
  if (
    !input.content ||
    input.content.length > Math.ceil(MAX_FILE_SIZE / 3) * 4 ||
    input.content.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(input.content)
  )
    throw new AppError(413, "Envie um arquivo válido de até 5 MB.");
  const file = Buffer.from(input.content, "base64");
  if (!file.length || file.length > MAX_FILE_SIZE)
    throw new AppError(413, "Cada arquivo deve ter até 5 MB.");
  const valid =
    input.mime === "application/pdf"
      ? file.subarray(0, 5).toString() === "%PDF-" &&
        file.subarray(-1024).includes(Buffer.from("%%EOF"))
      : input.mime === "image/png"
        ? file
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : input.mime === "image/jpeg" &&
          file[0] === 255 &&
          file[1] === 216 &&
          file[2] === 255;
  if (!valid)
    throw new AppError(
      415,
      "O conteúdo não corresponde a um PDF, JPG ou PNG válido.",
    );
  return {
    file,
    extension:
      input.mime === "application/pdf"
        ? "pdf"
        : input.mime === "image/png"
          ? "png"
          : "jpg",
  };
}

export class InvoiceService {
  repository: InvoiceRepository;
  reader: InvoiceReader;
  constructor(repository: InvoiceRepository, reader: InvoiceReader) {
    this.repository = repository;
    this.reader = reader;
  }

  async validateKind(data: ExtractedInvoice, kind: "revenue" | "cost") {
    const own = (await this.repository.companyCnpj()).replace(/\D/g, "");
    const usable = (cnpj: string | null) =>
      !!cnpj && /^\d{14}$/.test(cnpj) && !/^(\d)\1{13}$/.test(cnpj);
    if (!usable(own))
      throw new AppError(
        422,
        "Cadastre o CNPJ da sua empresa antes de enviar notas.",
      );
    // Party roles are evidence, not the filename, selected tab or a label invented by OCR.
    if (
      !usable(data.cnpj) ||
      !["sale", "service"].includes(data.operation ?? "")
    )
      throw new AppError(
        422,
        "Não foi possível validar a categoria: confira o CNPJ do emitente e se o documento representa uma venda ou prestação de serviço. Devoluções, transferências e documentos ambíguos não são aceitos neste fluxo.",
      );
    const issued = data.cnpj === own;
    const received = data.recipientCnpj === own;
    const detected =
      issued && !received ? "revenue" : !issued && received ? "cost" : null;
    if (!detected)
      throw new AppError(
        422,
        "Não foi possível vincular a nota ao CNPJ da sua empresa como emitente ou destinatária. Confira o documento; ele não foi aceito nesta categoria.",
      );
    if (kind !== detected)
      throw new AppError(
        422,
        `Esta nota é de ${detected === "cost" ? "custo" : "faturamento"} para sua empresa. Envie na aba ${detected === "cost" ? "Custos" : "Faturamento"}.`,
      );
  }

  async upload(input: {
    name: string;
    mime: string;
    content: string;
    kind: "revenue" | "cost";
  }) {
    const { file, extension } = validateUpload(input);
    const hash = createHash("sha256").update(file).digest("hex");
    const duplicate = await this.repository.duplicate(hash);
    if (duplicate?.exclusao_solicitada_em)
      throw new AppError(
        409,
        "Conclua a exclusão pendente antes de enviar este arquivo novamente.",
      );
    if (duplicate) {
      await this.validateKind(duplicate.dados_extracao, input.kind);
      if (duplicate.natureza !== input.kind)
        throw new AppError(
          409,
          "Este arquivo já foi salvo em outra categoria. Exclua o registro incorreto com justificativa antes de reenviar.",
        );
      return { invoice: duplicate, duplicate: true };
    }
    // Fail closed: do not persist an unclassified or wrong-category document.
    const extraction = parseExtraction(
      await this.reader.read(file, input.mime),
    );
    await this.validateKind(extraction, input.kind);
    const id = randomUUID();
    const invoice: Invoice = {
      id,
      natureza: input.kind,
      nome_arquivo: input.name.trim(),
      mime_arquivo: input.mime,
      tamanho_arquivo: file.length,
      caminho_arquivo: this.repository.filePath(id, extension),
      hash_arquivo: hash,
      criado_em: new Date().toISOString(),
      status: "pending_review",
      revisado_em: null,
      versao_arquivo: randomUUID(),
      dados_extracao: extraction,
    };
    await this.repository.upload(invoice.caminho_arquivo, file, input.mime);
    try {
      return {
        invoice: await this.repository.insert(invoice),
        duplicate: false,
      };
    } catch (error) {
      // The database reply may have been lost after committing. Never delete a referenced file.
      let persisted: Invoice | null;
      try {
        persisted = await this.repository.duplicate(hash);
      } catch {
        throw new AppError(
          503,
          "Não foi possível confirmar o envio. Atualize a lista antes de tentar novamente.",
        );
      }
      if (persisted?.id === id) return { invoice: persisted, duplicate: false };
      await this.repository.removeFile(invoice.caminho_arquivo);
      if (persisted) {
        await this.validateKind(persisted.dados_extracao, input.kind);
        if (persisted.natureza !== input.kind)
          throw new AppError(
            409,
            "Arquivo já registrado em outra categoria. Atualize a lista.",
          );
        return { invoice: persisted, duplicate: true };
      }
      throw error;
    }
  }

  async read(id: string) {
    const invoice = await this.repository.get(id);
    if (
      invoice.exclusao_solicitada_em ||
      invoice.lancado_financeiro_em ||
      invoice.revisado_em ||
      invoice.status !== "pending_review"
    )
      throw new AppError(
        409,
        "Esta nota já foi revisada. A leitura não pode substituir seus dados.",
      );
    const data = parseExtraction(
      await this.reader.read(
        await this.repository.download(invoice),
        invoice.mime_arquivo,
      ),
    );
    await this.validateKind(data, invoice.natureza);
    return this.repository.save(invoice, data, false);
  }

  async review(id: string, version: string, data: unknown) {
    const invoice = await this.repository.get(id);
    if (
      invoice.status !== "pending_review" ||
      invoice.lancado_financeiro_em ||
      invoice.exclusao_solicitada_em ||
      invoice.versao_arquivo !== version
    )
      throw new AppError(
        409,
        "A nota mudou. Atualize a lista antes de revisar.",
      );
    // Registration/review only: financial confirmation, suppliers and inventory retain their existing workflow.
    await this.validateKind(invoice.dados_extracao, invoice.natureza);
    const parsed = parseExtraction(data, true);
    if (
      parsed.cnpj !== invoice.dados_extracao.cnpj ||
      parsed.recipientCnpj !== invoice.dados_extracao.recipientCnpj ||
      parsed.operation !== invoice.dados_extracao.operation
    )
      throw new AppError(
        422,
        "Os participantes e a operação devem corresponder à leitura do arquivo. Use Ler arquivo novamente se a identificação estiver incorreta.",
      );
    return this.repository.save(invoice, parsed, true);
  }

  async post(id: string, version: string, scope: "professional" | "personal") {
    const invoice = await this.repository.get(id);
    // A lost reply or double click must not create another financial entry.
    if (invoice.lancado_financeiro_em) return invoice;
    if (!invoice.revisado_em || invoice.exclusao_solicitada_em ||
        invoice.status !== "pending_review" || invoice.versao_arquivo !== version)
      throw new AppError(409, "Revise a nota e atualize a lista antes de lançar no financeiro.");
    if (!["professional", "personal"].includes(scope))
      throw new AppError(400, "Selecione a finalidade da despesa.");
    const data = parseExtraction(invoice.dados_extracao, true);
    await this.validateKind(data, invoice.natureza);
    return this.repository.post(invoice, scope);
  }

  async delete(id: string, reason: string) {
    const trimmed = typeof reason === "string" ? reason.trim() : "";
    if (trimmed.length < 10 || trimmed.length > 1000)
      throw new AppError(
        400,
        "Informe uma justificativa de 10 a 1.000 caracteres para excluir a nota.",
      );
    let invoice: Invoice;
    try {
      invoice = await this.repository.get(id);
    } catch (error) {
      if (error instanceof AppError && error.status === 404) return;
      throw error;
    }
    if (invoice.status !== "pending_review" || invoice.lancado_financeiro_em)
      throw new AppError(
        409,
        "Notas já lançadas no financeiro não podem ser excluídas por esta tela.",
      );
    // Durable marker freezes edits/OCR. A retry can finish after either external call fails.
    const pending = await this.repository.beginDeletion(invoice, trimmed);
    await this.repository.removeFile(pending.caminho_arquivo);
    await this.repository.finishDeletion(pending);
  }
}
