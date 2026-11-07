import { money, type PricingData } from "./pricing-api";
import styles from "./Screens.module.css";
import css from "./Pricing.module.css";
export type IngredientDraft = { supplyId: string; quantity: string };
export function PricingComposition({
  items,
  supplies,
  onChange,
}: {
  items: IngredientDraft[];
  supplies: PricingData["supplies"];
  onChange: (items: IngredientDraft[]) => void;
}) {
  const edit = (index: number, patch: Partial<IngredientDraft>) =>
    onChange(
      items.map((item, n) => (n === index ? { ...item, ...patch } : item)),
    );
  return (
    <section className={css.composition} aria-label="Composição do produto">
      <h2>Insumos por unidade produzida</h2>
      <p>
        Use a unidade cadastrada: por exemplo, 500 g de um insumo em kg = 0,500
        kg. O custo usa a compra mais recente, não a média.
      </p>
      {items.map((item, index) => {
        const supply = supplies.find((s) => s.id === item.supplyId);
        return (
          <div key={index} className={css.ingredient}>
            <label>
              Insumo {index + 1}
              <select
                className={styles.input}
                required
                value={item.supplyId}
                onChange={(e) => edit(index, { supplyId: e.target.value })}
              >
                <option value="">Selecione</option>
                {supplies
                  .filter((s) => s.active || s.id === item.supplyId)
                  .map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name} ({s.unit})
                      {s.price === null ? " — sem preço" : ""}
                      {!s.active ? " — inativo" : ""}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Quantidade {index + 1}
              {supply ? ` (${supply.unit})` : ""}
              <input
                className={styles.input}
                inputMode="decimal"
                pattern="[0-9]+([,.][0-9]{1,3})?"
                maxLength={13}
                required
                value={item.quantity}
                onChange={(e) => edit(index, { quantity: e.target.value })}
              />
            </label>
            <button
              type="button"
              className={css.outline}
              aria-label={`Remover insumo ${index + 1}`}
              onClick={() => onChange(items.filter((_, n) => n !== index))}
            >
              Remover
            </button>
            {supply && (
              <small>
                {supply.price === null
                  ? "Registre uma compra em Insumos para usar este item."
                  : `${money(supply.price)} / ${supply.unit} • compra em ${supply.date?.split("-").reverse().join("/")}`}
              </small>
            )}
          </div>
        );
      })}
      <button
        className={css.outline}
        type="button"
        disabled={items.length >= 50}
        onClick={() => onChange([...items, { supplyId: "", quantity: "1" }])}
      >
        Adicionar insumo
      </button>
    </section>
  );
}
