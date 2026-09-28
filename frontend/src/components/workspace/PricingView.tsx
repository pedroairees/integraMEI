"use client";

import { useState } from "react";
import styles from "./Screens.module.css";

export function PricingView() {
  const [message, setMessage] = useState("");
  return (
    <form
      className={styles.pricing}
      onSubmit={(event) => {
        event.preventDefault();
        setMessage(
          "Prévia de interface: o cálculo do preço e a análise de mercado serão conectados na etapa de lógica. Nenhum valor foi calculado ou salvo.",
        );
      }}
    >
      <div className={styles.productRow}>
        <label htmlFor="pricing-product">Produto</label>
        <input
          id="pricing-product"
          className={`${styles.input} ${styles.productInput}`}
          placeholder="Digite"
          maxLength={160}
          required
        />
      </div>
      <div className={styles.priceInputs}>
        <div className={`${styles.card} ${styles.priceInput}`}>
          <label htmlFor="unit-cost">Custo Total Unitário (R$)</label>
          <div className={styles.priceValue}>
            <span>R$</span>
            <input
              id="unit-cost"
              inputMode="decimal"
              placeholder="00,00"
              aria-label="Custo Total Unitário (R$)"
              pattern="[0-9]+([,.][0-9]{1,2})?"
              maxLength={12}
              required
            />
          </div>
        </div>
        <div className={`${styles.card} ${styles.priceInput}`}>
          <label htmlFor="profit-margin">Margem de Lucro Desejada (%)</label>
          <div className={styles.priceValue}>
            <input
              id="profit-margin"
              className={styles.marginInput}
              inputMode="decimal"
              placeholder="00"
              pattern="[0-9]+([,.][0-9]{1,2})?"
              maxLength={6}
              required
            />
            <span>%</span>
          </div>
        </div>
      </div>
      <button type="submit" className={styles.primary}>
        Sugerir Preço
      </button>
      <section
        className={`${styles.card} ${styles.suggested}`}
        aria-label="Prévia do preço sugerido"
      >
        <h2>Preço Sugerido</h2>
        <p>R$ 00,00</p>
      </section>
      <section className={`${styles.card} ${styles.market}`}>
        <h2>Análise de Mercado</h2>
        <dl>
          <div>
            <dt>Preço médio praticado</dt>
            <dd>R$ 00,00 - R$ 00,00</dd>
          </div>
          <div>
            <dt>Percepção de valor</dt>
            <dd>-</dd>
          </div>
          <div>
            <dt>Recomendação</dt>
            <dd>-</dd>
          </div>
        </dl>
      </section>
      {message && (
        <p className={styles.message} role="status">
          {message}
        </p>
      )}
    </form>
  );
}
