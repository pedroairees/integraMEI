"use client";

import type { InvoiceData } from "./invoice-api";
import styles from "./Invoices.module.css";

export type EditableInvoiceLine = {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
};
export function editableLines(data: InvoiceData): EditableInvoiceLine[] {
  return data.items.map((description, index) => {
    const line = data.lineItems?.[index];
    // A mismatched OCR row must be reviewed, never assigned to another product.
    const match = line?.description === description ? line : undefined;
    return {
      description,
      quantity: String(match?.quantity ?? ""),
      unit: match?.unit ?? "",
      unitPrice: String(match?.unitPrice ?? ""),
    };
  });
}
export function InvoiceItems({
  lines,
  onChange,
}: {
  lines: EditableInvoiceLine[];
  onChange: (lines: EditableInvoiceLine[]) => void;
}) {
  function edit(
    index: number,
    field: keyof EditableInvoiceLine,
    value: string,
  ) {
    onChange(
      lines.map((line, i) =>
        i === index ? { ...line, [field]: value } : line,
      ),
    );
  }
  return (
    <section className={styles.itemsEditor} aria-label="Itens para cadastro automático">
      <h3>Itens da nota de custo</h3>
      <p className={styles.hint}>
        Confira cada item com o original. Os insumos e seus preços só serão
        cadastrados ao confirmar o lançamento profissional no financeiro. Se a
        IA não leu algum campo, preencha-o. Use o mesmo nome e unidade do
        catálogo para reutilizar um insumo; preserve marca e apresentação.
      </p>
      {lines.map((line, index) => (
        <div className={styles.invoiceLine} key={index}>
          <label>
            Nome do insumo {index + 1}
            <input
              value={line.description}
              onChange={(e) => edit(index, "description", e.target.value)}
              required
              maxLength={120}
            />
          </label>
          <div className={styles.lineNumbers}>
            <label>
              Quantidade {index + 1}
              <input
                type="number"
                min="0.001"
                max="999999999"
                step="0.001"
                value={line.quantity}
                onChange={(e) => edit(index, "quantity", e.target.value)}
              />
            </label>
            <label>
              Unidade {index + 1}
              <input
                placeholder="kg, un, l…"
                maxLength={12}
                pattern="[a-zA-Z0-9²³]{1,12}"
                value={line.unit}
                onChange={(e) => edit(index, "unit", e.target.value)}
              />
            </label>
            <label>
              Preço unitário {index + 1} (R$)
              <input
                type="number"
                min="0"
                max="999999999"
                step="0.0001"
                value={line.unitPrice}
                onChange={(e) => edit(index, "unitPrice", e.target.value)}
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => onChange(lines.filter((_, i) => i !== index))}
            disabled={lines.length === 1}
          >
            Remover item {index + 1}
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={lines.length >= 200}
        onClick={() =>
          onChange([
            ...lines,
            { description: "", quantity: "", unit: "", unitPrice: "" },
          ])
        }
      >
        Adicionar item
      </button>
    </section>
  );
}
