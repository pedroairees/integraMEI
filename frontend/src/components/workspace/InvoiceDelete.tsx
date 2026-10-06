"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { invoiceRequest, type SavedInvoice } from "./invoice-api";
import styles from "./Invoices.module.css";

export function InvoiceDelete({
  invoice,
  onClose,
  onDeleted,
}: {
  invoice: SavedInvoice;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState(invoice.exclusao_justificativa ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requested, setRequested] = useState(!!invoice.exclusao_justificativa);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reason.trim().length < 10) {
      setError("Informe uma justificativa com pelo menos 10 caracteres.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await invoiceRequest(`/${invoice.id}`, {
        method: "DELETE",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      onDeleted();
    } catch (error) {
      // The request may have committed before Storage failed. Preserve the first reason.
      setRequested(true);
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível concluir a exclusão. Tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="delete-title"
      aria-describedby="delete-warning"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <form onSubmit={submit}>
        <h2 id="delete-title">Excluir nota fiscal</h2>
        <p className={styles.filename}>{invoice.nome_arquivo}</p>
        <p id="delete-warning">
          O arquivo e a nota serão apagados permanentemente. Esta ação não pode
          ser desfeita. A justificativa, a autoria e as datas permanecerão no
          histórico de exclusões.
        </p>
        <fieldset disabled={busy}>
          <label>
            Justificativa da exclusão
            <textarea
              autoFocus
              required
              minLength={10}
              maxLength={1000}
              rows={4}
              value={reason}
              readOnly={requested}
              onChange={(event) => setReason(event.target.value)}
              aria-describedby="delete-reason-hint"
            />
          </label>
        </fieldset>
        <p id="delete-reason-hint" className={styles.hint}>
          {requested
            ? "A primeira justificativa é mantida ao concluir uma exclusão pendente."
            : "De 10 a 1.000 caracteres. Exemplo: arquivo duplicado ou enviado na categoria incorreta."}
        </p>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            className={styles.deleteButton}
            disabled={busy || reason.trim().length < 10}
          >
            {busy ? "Excluindo…" : "Confirmar exclusão"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
