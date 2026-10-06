"use client";

import { FileText, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { InvoiceReview } from "./InvoiceReview";
import { InvoiceDelete } from "./InvoiceDelete";
import { InvoicePost } from "./InvoicePost";
import { fileBase64, invoiceRequest, type SavedInvoice } from "./invoice-api";
import styles from "./Screens.module.css";
import ui from "./Invoices.module.css";

export function InvoicesView() {
  const [kind, setKind] = useState<"revenue" | "cost">("revenue");
  const [period, setPeriod] = useState("current");
  const [invoices, setInvoices] = useState<SavedInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [more, setMore] = useState(false);
  const [review, setReview] = useState<SavedInvoice | null>(null);
  const [deleting, setDeleting] = useState<SavedInvoice | null>(null);
  const [posting, setPosting] = useState<SavedInvoice | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    invoiceRequest<{ invoices: SavedInvoice[] }>(
      `?kind=${kind}&period=${period}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (current === generation.current) {
          setInvoices(result.invoices);
          setListError("");
          setMore(result.invoices.length === 50);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted && current === generation.current)
          setListError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted && current === generation.current)
          setLoading(false);
      });
    return () => controller.abort();
  }, [kind, period, refresh]);

  function reload() {
    setLoading(true);
    setListError("");
    setError("");
    setRefresh((value) => value + 1);
  }
  async function read(invoice: SavedInvoice) {
    setBusy(true);
    setError("");
    setMessage("Lendo o documento. O arquivo já está salvo na sua conta…");
    try {
      const result = await invoiceRequest<{ invoice: SavedInvoice }>(
        `/${invoice.id}/read`,
        { method: "POST" },
      );
      setReview(result.invoice);
      setMessage(
        "Leitura concluída. Confira os campos antes de salvar a revisão.",
      );
      reload();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Leitura indisponível. O arquivo continua salvo.",
      );
      setMessage("");
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    if (
      !["application/pdf", "image/png", "image/jpeg"].includes(file.type) ||
      file.size === 0 ||
      file.size > 5 * 1024 * 1024
    ) {
      setError("Selecione um PDF, JPG ou PNG de até 5 MB, não vazio.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("Lendo e validando a categoria antes de salvar o arquivo…");
    try {
      const result = await invoiceRequest<{
        invoice: SavedInvoice;
        duplicate: boolean;
      }>("", {
        method: "POST",
        body: JSON.stringify({
          name: file.name,
          mime: file.type,
          kind,
          content: await fileBase64(file),
        }),
      });
      setKind(result.invoice.natureza);
      setPeriod("all");
      reload();
      if (result.duplicate)
        setMessage(
          "Esse arquivo já está registrado na sua conta. Nenhuma cópia foi criada.",
        );
      else {
        setReview(result.invoice);
        setMessage(
          "Categoria validada e arquivo salvo. Confira os dados extraídos.",
        );
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível enviar a nota.",
      );
      setMessage("");
    } finally {
      setBusy(false);
    }
  }
  async function loadMore() {
    const current = generation.current;
    setBusy(true);
    setError("");
    try {
      const result = await invoiceRequest<{ invoices: SavedInvoice[] }>(
        `?kind=${kind}&period=${period}&offset=${invoices.length}`,
      );
      if (current === generation.current) {
        setInvoices((items) => [...items, ...result.invoices]);
        setMore(result.invoices.length === 50);
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível carregar mais notas.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.notes} aria-label="Anexo e consulta de notas">
      <div
        className={styles.noteTabs}
        role="group"
        aria-label="Tipo de nota fiscal"
      >
        {(["revenue", "cost"] as const).map((value) => (
          <button
            key={value}
            type="button"
            disabled={busy}
            aria-pressed={kind === value}
            className={`${styles.noteTab} ${value === "revenue" ? styles.revenueTab : styles.costTab}`}
            onClick={() => {
              if (kind !== value) {
                setLoading(true);
                setInvoices([]);
                setError("");
                setListError("");
                setKind(value);
              }
            }}
          >
            {value === "revenue" ? "Faturamento" : "Custos"}
          </button>
        ))}
      </div>
      <ol className={styles.steps} aria-label="Etapas do envio">
        {["Capturar", "Registrar", "Revisar"].map((step, index) => (
          <li
            key={step}
            aria-current={
              (review ? 2 : busy ? 1 : 0) === index ? "step" : undefined
            }
          >
            <span>{index + 1}</span>
            {step}
          </li>
        ))}
      </ol>
      <p className={styles.uploadIntro}>
        Anexe a Nota Fiscal no espaço abaixo. Formatos aceitos: JPG, PNG e PDF
        (até 5 MB).
      </p>
      <div className={styles.uploadLabel}>Envio de arquivos</div>
      <label className={styles.upload} aria-disabled={busy}>
        <Upload size={20} aria-hidden="true" />
        <span>{busy ? "Processando…" : "Selecione um arquivo"}</span>
        <input
          type="file"
          disabled={busy}
          accept="image/jpeg,image/png,application/pdf"
          aria-label="Selecionar notas fiscais"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
      </label>
      <p className={ui.hint}>
        Arquivos privados, vinculados à sua conta. A leitura usa Groq como
        principal e Gemini como reserva em caso de falha técnica. Antes de
        salvar, confere o CNPJ: sua empresa como emitente em Faturamento ou como
        destinatária em Custos. Documentos ambíguos ou na aba incorreta não são
        aceitos.
      </p>
      {message && (
        <p role="status" className={styles.message}>
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className={ui.error}>
          {error}
        </p>
      )}
      <div className={styles.notesHeading}>
        <h2>
          Últimas notas enviadas (
          <span className={kind === "revenue" ? styles.income : styles.expense}>
            {kind === "revenue" ? "ENTRADAS" : "SAÍDAS"}
          </span>
          )
        </h2>
        <select
          aria-label="Período das notas"
          disabled={busy}
          value={period}
          onChange={(event) => {
            setLoading(true);
            setInvoices([]);
            setError("");
            setListError("");
            setPeriod(event.target.value);
          }}
        >
          <option value="current">Mês Atual</option>
          <option value="previous">Mês Anterior</option>
          <option value="all">Todos os meses</option>
        </select>
      </div>
      <div className={ui.toolbar}>
        <small>Filtro pela data de envio.</small>
        <button type="button" onClick={reload} disabled={busy || loading}>
          Atualizar lista
        </button>
      </div>
      {listError && (
        <p role="alert" className={ui.error}>
          {listError}
        </p>
      )}
      {loading ? (
        <p role="status">Carregando suas notas…</p>
      ) : invoices.length === 0 ? (
        <p className={styles.message}>
          {listError
            ? "A lista não pôde ser carregada. Tente atualizar."
            : "Nenhuma nota enviada neste período. Envie seu primeiro arquivo acima."}
        </p>
      ) : (
        <div
          className={styles.invoiceGrid}
          aria-label="Notas salvas na sua conta"
          tabIndex={0}
        >
          {invoices.map((invoice) => (
            <article
              key={invoice.id}
              className={`${styles.card} ${ui.invoice}`}
            >
              <FileText size={42} aria-hidden="true" />
              <div>
                <h3 className={ui.filename}>{invoice.nome_arquivo}</h3>
                <dl>
                  <dt>Emitente / fornecedor</dt>
                  <dd>
                    {invoice.dados_extracao.supplier ?? "Aguardando revisão"}
                  </dd>
                  <dt>Data de emissão</dt>
                  <dd>
                    {invoice.dados_extracao.date
                      ?.split("-")
                      .reverse()
                      .join("/") ?? "Não identificada"}
                  </dd>
                  <dt>Valor</dt>
                  <dd>
                    {invoice.dados_extracao.total === null
                      ? "Não identificado"
                      : new Intl.NumberFormat("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        }).format(invoice.dados_extracao.total)}
                  </dd>
                </dl>
                <p className={ui.badge}>
                  {invoice.exclusao_solicitada_em
                    ? "Exclusão pendente — tente novamente"
                    : invoice.lancado_financeiro_em
                      ? "Lançada no financeiro"
                    : invoice.revisado_em
                      ? "Dados revisados"
                      : "Pendente de revisão"}
                </p>
                <div className={ui.actions}>
                  {!invoice.exclusao_solicitada_em && (
                    <a
                      href={`/api/backend/invoices/${invoice.id}/file`}
                      download
                    >
                      Baixar original
                    </a>
                  )}
                  <button
                    type="button"
                    disabled={busy || !!invoice.exclusao_solicitada_em || !!invoice.lancado_financeiro_em || invoice.status === "confirmed"}
                    onClick={() => setReview(invoice)}
                  >
                    Revisar dados
                  </button>
                  {!invoice.revisado_em && !invoice.exclusao_solicitada_em && !invoice.lancado_financeiro_em && invoice.status !== "confirmed" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void read(invoice)}
                    >
                      Ler arquivo
                    </button>
                  )}
                  <button
                    type="button"
                    className={ui.deleteButton}
                    disabled={busy || !!invoice.lancado_financeiro_em || invoice.status === "confirmed"}
                    onClick={() => setDeleting(invoice)}
                  >
                    <Trash2 size={15} aria-hidden="true" />{" "}
                    {invoice.exclusao_solicitada_em
                      ? "Concluir exclusão"
                      : "Excluir nota"}
                  </button>
                  {invoice.revisado_em && !invoice.lancado_financeiro_em && !invoice.exclusao_solicitada_em && invoice.status !== "confirmed" && (
                    <button type="button" disabled={busy} onClick={() => setPosting(invoice)}>Lançar no financeiro</button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {more && !loading && (
        <button
          className={ui.more}
          type="button"
          disabled={busy}
          onClick={() => void loadMore()}
        >
          Carregar mais notas
        </button>
      )}
      {review && (
        <InvoiceReview
          key={`${review.id}-${review.versao_arquivo}`}
          invoice={review}
          onClose={() => setReview(null)}
          onSaved={() => {
            setReview(null);
            setMessage(
              "Revisão salva. Use Lançar no financeiro para atualizar os indicadores do dashboard.",
            );
            reload();
          }}
        />
      )}
      {deleting && (
        <InvoiceDelete
          invoice={deleting}
          onClose={() => {
            setDeleting(null);
            reload();
          }}
          onDeleted={() => {
            setInvoices((items) =>
              items.filter((item) => item.id !== deleting.id),
            );
            setDeleting(null);
            setMessage(
              "Nota e arquivo original excluídos permanentemente. Justificativa registrada no histórico.",
            );
            reload();
          }}
        />
      )}
      {posting && <InvoicePost invoice={posting} onClose={() => setPosting(null)} onPosted={() => {
        setPosting(null); reload(); setMessage("Lançamento confirmado. O dashboard foi atualizado no mês da emissão da nota.");
      }} />}
    </section>
  );
}
