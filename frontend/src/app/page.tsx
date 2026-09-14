"use client";

import Image from "next/image";
import Link from "next/link";
import { type FormEvent, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

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
  }

  return (
    <main className={styles.page}>
      <section className={styles.loginCard}>
        <div className={styles.logoCrop}>
          <Image
            src="/assets/integramei-logo.png"
            alt="IntegraMEI"
            className={styles.logo}
            width={489}
            height={343}
            priority
          />
        </div>

        <div className={styles.heading}>
          <h1>
            Integ<span>ra</span><strong>MEI</strong>
          </h1>

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
            <label className={styles.srOnly} htmlFor="cnpj">
              CNPJ
            </label>
            <div className={styles.inputWrapper}>
              <Image
                src="/assets/remember-checkbox.svg"
                alt=""
                className={styles.inputIcon}
                width={32}
                height={32}
              />

              <input
                id="cnpj"
                type="text"
                placeholder="CNPJ"
                value={cnpj}
                onChange={(event) =>
                  handleCnpjChange(event.target.value)
                }
                maxLength={18}
                autoComplete="username"
                inputMode="numeric"
              />
            </div>
          </div>

          <div className={styles.inputGroup}>
            <label className={styles.srOnly} htmlFor="password">
              Senha
            </label>
            <div className={styles.inputWrapper}>
              <Image
                src="/assets/cnpj-icon.svg"
                alt=""
                className={styles.inputIcon}
                width={31}
                height={31}
              />

              <input
                id="password"
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

            <Link className={styles.forgotPassword} href="/recuperar-senha">
              Esqueci minha senha
            </Link>
          </div>

          <button
            type="submit"
            className={styles.loginButton}
          >
            Entrar
          </button>
        </form>

        <p className={styles.divider}>
          <span>ou</span>
        </p>

        <Link className={styles.createAccount} href="/cadastro">
          Criar conta
        </Link>
      </section>
    </main>
  );
}
