import Image from "next/image";
import styles from "./Screens.module.css";

const examples = [
  {
    color: "yellow",
    icon: "warning",
    title: "Alerta de inflação",
    text: "A farinha de trigo aumentou 12% nos últimos 30 dias, considere antecipar suas compras.",
  },
  {
    color: "blue",
    icon: "opportunity",
    title: "Oportunidade de compra",
    text: "O açúcar esta com preço 8% abaixo da média dos últimos 3 meses, bom momento para comprar!",
  },
  {
    color: "green",
    icon: "pricing",
    title: "Recomendação de precificação",
    text: "O produto “Bolo de Chocolate” pode ter o preço ajustado para R$37,89 mantendo uma boa margem de lucro.",
  },
] as const;

export function AlertsView() {
  return (
    <ul
      className={styles.alerts}
      tabIndex={0}
      aria-label="Alertas demonstrativos do Figma; role para ver mais"
    >
      {Array.from({ length: 12 }, (_, index) => {
        const item = examples[index % examples.length];
        return (
          <li className={`${styles.alert} ${styles[item.color]}`} key={index}>
            <span className={styles.alertIcon} aria-hidden="true">
              <Image
                src={`/assets/screens/alert-${item.color}-circle.svg`}
                alt=""
                width={66}
                height={61}
              />
              <Image
                src={`/assets/screens/alert-${item.icon}.svg`}
                alt=""
                width={44}
                height={44}
              />
            </span>
            <div>
              <h2>{item.title}</h2>
              <p>{item.text}</p>
            </div>
            <time dateTime="2026-04-15">15/04/2026</time>
          </li>
        );
      })}
    </ul>
  );
}
