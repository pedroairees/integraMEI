"use client";
import { useState } from "react";
import { currency, monthLabel } from "./types";
import styles from "./Dashboard.module.css";

export function FinancialChart({
  points,
}: {
  points: { month: string; value: number }[];
}) {
  const [active, setActive] = useState<number | null>(null);
  const maximum = Math.max(1, ...points.map((p) => p.value));
  const x = (i: number) => 65 + i * (715 / Math.max(1, points.length - 1));
  const y = (value: number) => 150 - (value / maximum) * 125;
  return (
    <figure className={styles.liveChart}>
      <svg viewBox="0 0 820 195" aria-label="Evolução dos gastos por mês">
        {[0, 0.5, 1].map((ratio) => (
          <g key={ratio}>
            <line
              x1="65"
              x2="795"
              y1={y(ratio * maximum)}
              y2={y(ratio * maximum)}
              stroke="#d5dfeb"
            />
            <text
              x="55"
              y={y(ratio * maximum) + 4}
              textAnchor="end"
              fontSize="11"
              fill="#555"
            >
              {new Intl.NumberFormat("pt-BR", {
                notation: "compact",
                maximumFractionDigits: 1,
              }).format(ratio * maximum)}
            </text>
          </g>
        ))}
        <polyline
          points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")}
          fill="none"
          stroke="#1b3a70"
          strokeWidth="2"
        />
        {points.map((p, i) => (
          <g key={p.month}>
            <circle
              cx={x(i)}
              cy={y(p.value)}
              r="7"
              fill="#1b3a70"
              tabIndex={0}
              role="button"
              aria-label={`${monthLabel(p.month)}: ${currency(p.value)}`}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setActive(i);
                }
              }}
            >
              <title>
                {monthLabel(p.month)}: {currency(p.value)}
              </title>
            </circle>
            <text
              x={x(i)}
              y="179"
              textAnchor="middle"
              fontSize="11"
              fill="#555"
            >
              {monthLabel(p.month)}
            </text>
          </g>
        ))}
      </svg>
      <figcaption aria-live="polite">
        {active !== null && points[active]
          ? `${monthLabel(points[active].month)}: ${currency(points[active].value)}`
          : "Toque ou navegue pelos pontos para consultar os valores."}
      </figcaption>
      <details>
        <summary>Ver valores em tabela</summary>
        <table>
          <thead>
            <tr>
              <th>Mês</th>
              <th>Gastos</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.month}>
                <td>{monthLabel(p.month)}</td>
                <td>{currency(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
