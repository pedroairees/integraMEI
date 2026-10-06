"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { invoiceRequest, type SavedInvoice } from "./invoice-api";
import styles from "./Invoices.module.css";

export function InvoiceReview({
  invoice,
  onClose,
  onSaved,
}: {
  invoice: SavedInvoice;
  onClose: () => void;
  onSaved: (invoice: SavedInvoice) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const data = invoice.dados_extracao;
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await invoiceRequest<{ invoice: SavedInvoice }>(
        `/${invoice.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            version: invoice.versao_arquivo,
            data: {
              supplier: form.get("supplier"),
              cnpj: data.cnpj,
              recipientCnpj: data.recipientCnpj,
              operation: data.operation,
              number: form.get("number") || null,
              date: form.get("date"),
              total: Number(form.get("total")),
              items: String(form.get("items"))
                .split("\n")
                .map((item) => item.trim())
                .filter(Boolean),
            },
          }),
        },
      );
      onSaved(result.invoice);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar a revisão.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="review-title"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <form onSubmit={submit}>
        <h2 id="review-title">Revisar nota fiscal</h2>
        <p className={styles.filename}>{invoice.nome_arquivo}</p>
        <p>
          Confira os dados com o documento original. Campos não identificados
          precisam ser preenchidos.
        </p>
        <fieldset disabled={busy}>
          <label>
            Emitente / fornecedor
            <input
              name="supplier"
              defaultValue={data.supplier ?? ""}
              required
              maxLength={200}
              autoFocus
            />
          </label>
          <label>
            CNPJ do emitente
            <input
              name="cnpj"
              defaultValue={data.cnpj ?? ""}
              readOnly
              required
              inputMode="numeric"
              pattern="[0-9]{14}"
              minLength={14}
              maxLength={14}
              placeholder="14 dígitos, sem pontuação"
            />
          </label>
          <label>
            CNPJ do destinatário (identificado no arquivo)
            <input
              value={data.recipientCnpj ?? "Não identificado / pessoa física"}
              readOnly
            />
          </label>
          <label>
            Número da nota (opcional)
            <input
              name="number"
              defaultValue={data.number ?? ""}
              maxLength={80}
            />
          </label>
          <label>
            Data de emissão
            <input
              name="date"
              type="date"
              defaultValue={data.date ?? ""}
              required
            />
          </label>
          <label>
            Valor total (R$)
            <input
              name="total"
              type="number"
              min="0"
              max="999999999.99"
              step="0.01"
              defaultValue={data.total ?? ""}
              required
            />
          </label>
          <label>
            Itens (uma descrição por linha)
            <textarea
              name="items"
              defaultValue={data.items.join("\n")}
              rows={4}
              required
              maxLength={100000}
            />
          </label>
        </fieldset>
        <p className={styles.hint}>
          Os CNPJs usados para validar a categoria vêm da leitura do arquivo e
          não podem ser alterados manualmente. Após salvar a revisão, use
          “Lançar no financeiro” para incluir o valor no dashboard. O estoque não é alterado.
        </p>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" disabled={busy}>
            {busy ? "Salvando…" : "Salvar revisão"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
