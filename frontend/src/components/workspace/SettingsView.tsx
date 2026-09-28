"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import styles from "./Screens.module.css";

const notificationLabels = [
  "Receber alertas por e-mail",
  "Lembretes notas fiscais",
  "Alertas de estoque baixo",
];

export function SettingsView() {
  const [preferences, setPreferences] = useState([true, true, true]);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <section aria-label="Configurações demonstrativas">
      <p className={styles.cnpj}>
        <strong>Cnpj:</strong> xxx.xxx.xxxx-xx
      </p>
      <div className={styles.settingsGrid}>
        <section
          className={`${styles.card} ${styles.settingsCard}`}
          aria-label="Dados pessoais de exemplo"
        >
          <label className={styles.field}>
            Nome completo
            <input
              className={styles.input}
              placeholder="Moziel Sirley Alves de Souza"
              autoComplete="off"
              maxLength={160}
            />
          </label>
          <label className={styles.field}>
            E-mail
            <input
              className={styles.input}
              type="email"
              placeholder="mozielsouza28@gmail.com"
              autoComplete="off"
            />
          </label>
          <label className={styles.field}>
            Telefone
            <input
              className={styles.input}
              type="tel"
              placeholder="(61) 90000-0000"
              autoComplete="off"
              maxLength={20}
            />
          </label>
        </section>
        <section
          className={`${styles.card} ${styles.settingsCard} ${styles.preferences}`}
          aria-label="Preferências de notificações"
        >
          {notificationLabels.map((label, index) => (
            <div className={styles.toggleRow} key={label}>
              <span id={`preference-${index}`}>{label}</span>
              <button
                type="button"
                className={styles.switch}
                role="switch"
                aria-checked={preferences[index]}
                aria-labelledby={`preference-${index}`}
                onClick={() =>
                  setPreferences((previous) =>
                    previous.map((value, item) =>
                      item === index ? !value : value,
                    ),
                  )
                }
              />
            </div>
          ))}
        </section>
        <form
          className={`${styles.card} ${styles.settingsCard} ${styles.passwordCard}`}
          onSubmit={(event) => {
            event.preventDefault();
            setMessage(
              "Prévia de interface: nenhum e-mail foi enviado e sua senha não foi alterada. A recuperação será conectada na etapa de lógica.",
            );
          }}
        >
          <label className={styles.field} htmlFor="preview-password">
            Senha atual
          </label>
          <div className={styles.passwordBox}>
            <input
              id="preview-password"
              className={styles.input}
              type={passwordVisible ? "text" : "password"}
              placeholder="••••••••••••"
              autoComplete="off"
            />
            <button
              type="button"
              aria-label={passwordVisible ? "Ocultar senha" : "Mostrar senha"}
              aria-pressed={passwordVisible}
              onClick={() => setPasswordVisible((value) => !value)}
            >
              {passwordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <p>
            Alteração de senha:
            <br />
            Enviaremos um e-mail para alteração de senha
          </p>
          <button type="submit" className={styles.primary}>
            Enviar
          </button>
        </form>
        <section
          className={`${styles.card} ${styles.settingsCard}`}
          aria-label="Preferências regionais"
        >
          <label className={styles.field}>
            Idioma
            <select className={styles.select} defaultValue="pt">
              <option value="pt">Português</option>
              <option value="en">English</option>
              <option value="es">Español</option>
            </select>
          </label>
          <label className={styles.field}>
            Moeda Padrão
            <select className={styles.select} defaultValue="BRL">
              <option value="BRL">R$ - Real (BRL)</option>
              <option value="USD">US$ - Dólar (USD)</option>
              <option value="EUR">€ - Euro (EUR)</option>
            </select>
          </label>
          <label className={styles.field}>
            Fuso horário
            <select className={styles.select} defaultValue="brasilia">
              <option value="brasilia">(GMT-03:00) Brasília</option>
              <option value="manaus">(GMT-04:00) Manaus</option>
              <option value="acre">(GMT-05:00) Rio Branco</option>
            </select>
          </label>
        </section>
        <section className={`${styles.card} ${styles.about}`}>
          <h2>Sobre o IntegraMEI</h2>
          <p>Versão 1.0.0 - Plataforma de gestão para MEIs.</p>
        </section>
      </div>
      {message && (
        <p className={styles.message} role="status">
          {message}
        </p>
      )}
    </section>
  );
}
