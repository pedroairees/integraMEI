"use client";
import { useState } from "react";
import { dateLabel, priceLabel, type History } from "./supplies-api";
import css from "./Supplies.module.css";
const colors = [
  "#1c3a70",
  "#24763d",
  "#a74620",
  "#7846a8",
  "#147b86",
  "#a3286c",
];
export function SupplyHistory({ history }: { history: History }) {
  const [active, setActive] = useState<string | null>(null);
  const { points, unit, minimum, maximum, average } = history;
  if (!points.length)
    return (
      <p className={css.notice}>
        Histórico indisponível: realize o primeiro lançamento de nota para este
        insumo ou registre um preço manual. Verifique também o período e a
        unidade selecionados.
      </p>
    );
  const suppliers = [...new Set(points.map((p) => p.supplier))].sort();
  const color = (name: string) =>
    colors[suppliers.indexOf(name) % colors.length];
  const max = Math.max(1, ...points.map((p) => p.value));
  const first = Date.parse(points[0].date),
    last = Date.parse(points.at(-1)!.date);
  const x = (date: string) =>
    last === first
      ? 430
      : 85 + ((Date.parse(date) - first) / (last - first)) * 690;
  const y = (value: number) => 200 - (value / max) * 160;
  const selected = points.find((p) => p.id === active);
  return (
    <>
      <figure className={css.chart}>
        <h2>{history.supply.nome}</h2>
        <p>Evolução do preço unitário (R$/{unit})</p>
        <div
          className={css.chartScroll}
          tabIndex={0}
          aria-label="Gráfico de preços; role horizontalmente em telas pequenas"
        >
          <svg
            viewBox="0 0 830 250"
            role="img"
            aria-label="Histórico real de preços por fornecedor"
          >
            {[0, 0.5, 1].map((r) => (
              <g key={r}>
                <line
                  x1="85"
                  x2="790"
                  y1={y(r * max)}
                  y2={y(r * max)}
                  stroke="#d5dfeb"
                />
                <text x="78" y={y(r * max) + 4} textAnchor="end" fontSize="12">
                  {priceLabel(r * max)}
                </text>
              </g>
            ))}
            <line
              x1="85"
              x2="790"
              y1={y(average!)}
              y2={y(average!)}
              stroke="#555"
              strokeDasharray="5 5"
            >
              <title>Média: {priceLabel(average!)}</title>
            </line>
            {suppliers.map((s) => (
              <polyline
                key={s}
                points={points
                  .filter((p) => p.supplier === s)
                  .map((p) => `${x(p.date)},${y(p.value)}`)
                  .join(" ")}
                fill="none"
                stroke={color(s)}
                strokeWidth="2"
              />
            ))}
            {points.map((p) => (
              <circle
                key={p.id}
                cx={x(p.date)}
                cy={y(p.value)}
                r="6"
                fill={color(p.supplier)}
                tabIndex={0}
                role="button"
                aria-label={`${dateLabel(p.date)}: ${priceLabel(p.value)} por ${unit}, ${p.supplier}`}
                onFocus={() => setActive(p.id)}
                onMouseEnter={() => setActive(p.id)}
                onClick={() => setActive(p.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActive(p.id);
                  }
                }}
              >
                <title>
                  {dateLabel(p.date)} • {p.supplier} • {priceLabel(p.value)}
                </title>
              </circle>
            ))}
            <text x="85" y="235" fontSize="12">
              {dateLabel(points[0].date)}
            </text>
            <text x="775" y="235" fontSize="12" textAnchor="end">
              {dateLabel(points.at(-1)!.date)}
            </text>
          </svg>
        </div>
        <figcaption aria-live="polite">
          {selected
            ? `${dateLabel(selected.date)} — ${selected.supplier}: ${priceLabel(selected.value)}/${unit}`
            : "Passe o mouse, toque ou use o teclado nos pontos para consultar cada compra."}
        </figcaption>
        <ul className={css.legend}>
          {suppliers.map((s) => (
            <li key={s}>
              <span style={{ backgroundColor: color(s) }} aria-hidden="true" />
              {s}
            </li>
          ))}
        </ul>
      </figure>
      <div className={css.summary}>
        {[
          { title: "Maior preço", point: maximum },
          { title: "Menor preço", point: minimum },
        ].map((v) => (
          <article key={v.title}>
            <h3>{v.title}</h3>
            <strong>{priceLabel(v.point!.value)}</strong>
            <p>
              {dateLabel(v.point!.date)} • {v.point!.supplier}
            </p>
          </article>
        ))}
        <article>
          <h3>Preço médio (período)</h3>
          <strong>{priceLabel(average!)}</strong>
          <p>
            Média simples de {points.length} registro(s), em {unit}. Não
            ponderada pela quantidade.
          </p>
        </article>
      </div>
      <p>
        Menor preço no período: {minimum!.supplier},{" "}
        {priceLabel(minimum!.value)}/{unit}. Os valores são das suas compras,
        não de uma pesquisa de mercado.
      </p>
      <details>
        <summary>Ver histórico em tabela</summary>
        <div className={css.tableScroll}>
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Fornecedor</th>
                <th>Preço unitário</th>
                <th>Origem</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.id}>
                  <td>{dateLabel(p.date)}</td>
                  <td>{p.supplier}</td>
                  <td>
                    {priceLabel(p.value)}/{p.unit}
                  </td>
                  <td>{p.source === "manual" ? "Manual" : "Nota de custo"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
