"use client";

import { FormEvent, useState } from "react";
import {
  Eye,
  EyeOff,
  LockKeyhole,
  UserRound,
} from "lucide-react";

import styles from "./page.module.css";

export default function LoginPage() {
  const [cnpj, setCnpj] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  function handleCnpjChange(value: string) {
    const numbers = value.replace(/\D/g, "").slice(0, 14);

    const formatted = numbers
      .replace(/^(\d{2})(\d)/, "$1.$2")
      .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1/$2")
      .replace(/(\d{4})(\d)/, "$1-$2");

    setCnpj(formatted);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    console.log("CNPJ:", cnpj);
    console.log("Senha:", password);
    console.log("Lembrar de mim:", rememberMe);
  }

  return (
    <main className={styles.page}>
      <section className={styles.loginCard}>
        <div className={styles.logoContainer}>
          <img
            src="/logo.svg"
            alt="IntegraMEI"
            className={styles.logo}
          />
        </div>

        <div className={styles.heading}>
          <h1>IntegraMEI</h1>

          <p>
            Seu assistente financeiro
            <br />
            inteligente.
          </p>
        </div>

        <div className={styles.formTitle}>
          <h2>Acesse sua conta</h2>
        </div>

        <form
          className={styles.form}
          onSubmit={handleSubmit}
        >
          <div className={styles.inputGroup}>
            <div className={styles.inputWrapper}>
              <UserRound
                size={14}
                strokeWidth={2}
                className={styles.inputIcon}
              />

              <input
                type="text"
                placeholder="CNPJ"
                value={cnpj}
                onChange={(event) =>
                  handleCnpjChange(event.target.value)
                }
                maxLength={18}
                autoComplete="username"
              />
            </div>
          </div>

          <div className={styles.inputGroup}>
            <div className={styles.inputWrapper}>
              <LockKeyhole
                size={14}
                strokeWidth={2}
                className={styles.inputIcon}
              />

              <input
                type={showPassword ? "text" : "password"}
                placeholder="Senha"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                autoComplete="current-password"
              />

              <button
                type="button"
                className={styles.passwordButton}
                onClick={() =>
                  setShowPassword(!showPassword)
                }
                aria-label={
                  showPassword
                    ? "Ocultar senha"
                    : "Mostrar senha"
                }
              >
                {showPassword ? (
                  <EyeOff size={13} />
                ) : (
                  <Eye size={13} />
                )}
              </button>
            </div>
          </div>

          <div className={styles.options}>
            <label className={styles.remember}>
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(event) =>
                  setRememberMe(event.target.checked)
                }
              />

              <span>Lembrar de mim</span>
            </label>

            <a
              href="#"
              className={styles.forgotPassword}
            >
              Esqueci minha senha
            </a>
          </div>

          <button
            type="submit"
            className={styles.loginButton}
          >
            Entrar
          </button>
        </form>

        <div className={styles.divider}>
          <span>ou</span>
        </div>

        <a
          href="#"
          className={styles.createAccount}
        >
          Criar conta
        </a>
      </section>
    </main>
  );
}