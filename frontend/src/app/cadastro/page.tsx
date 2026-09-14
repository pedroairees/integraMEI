"use client";

import Image from "next/image";
import Link from "next/link";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { Check, Upload } from "lucide-react";

import styles from "./page.module.css";

function onlyNumbers(value: string, maxLength: number) {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

function formatCpf(value: string) {
  const numbers = onlyNumbers(value, 11);

  return numbers
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

function formatBirthDate(value: string) {
  const numbers = onlyNumbers(value, 8);

  return numbers
    .replace(/^(\d{2})(\d)/, "$1/$2")
    .replace(/(\d{2})(\d)/, "$1/$2");
}

function formatPhone(value: string) {
  const numbers = onlyNumbers(value, 11);

  return numbers
    .replace(/^(\d{2})(\d)/, "$1 $2")
    .replace(/(\d{5})(\d)/, "$1-$2");
}

export default function RegisterPage() {
  const [fullName, setFullName] = useState("");
  const [cpf, setCpf] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [documentName, setDocumentName] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);

  function handleDocumentChange(event: ChangeEvent<HTMLInputElement>) {
    setDocumentName(event.target.files?.[0]?.name ?? "");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  return (
    <main className={styles.page}>
      <section className={styles.registerCard} aria-labelledby="register-title">
        <header className={styles.header}>
          <Link
            className={styles.backLink}
            href="/"
            aria-label="Voltar para a tela de login"
          >
            <Image
              src="/assets/register-back.svg"
              alt=""
              width={66}
              height={39}
            />
          </Link>
          <h1 id="register-title">Dados Pessoais</h1>
        </header>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label htmlFor="full-name">Nome completo</label>
            <input
              id="full-name"
              type="text"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Digite"
              autoComplete="name"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="cpf">Cpf</label>
            <input
              id="cpf"
              type="text"
              value={cpf}
              onChange={(event) => setCpf(formatCpf(event.target.value))}
              placeholder="ex: 000.000.000-00"
              inputMode="numeric"
              maxLength={14}
              autoComplete="off"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="birth-date">Data de nascimento</label>
            <input
              id="birth-date"
              type="text"
              value={birthDate}
              onChange={(event) =>
                setBirthDate(formatBirthDate(event.target.value))
              }
              placeholder="ex: 00/00/0000"
              inputMode="numeric"
              maxLength={10}
              autoComplete="bday"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="phone">Telefone</label>
            <input
              id="phone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(formatPhone(event.target.value))}
              placeholder="ex: 00 00000-0000"
              inputMode="tel"
              maxLength={13}
              autoComplete="tel"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Digite"
              autoComplete="email"
            />
          </div>

          <div className={styles.documentField}>
            <label htmlFor="document">Documento (RG/CNH)</label>
            <label className={styles.uploadControl} htmlFor="document">
              <Upload aria-hidden="true" size={16} strokeWidth={3} />
              <span>{documentName || "Selecione o(s) arquivo(s)"}</span>
            </label>
            <input
              id="document"
              className={styles.fileInput}
              type="file"
              accept="image/*,.pdf"
              onChange={handleDocumentChange}
            />
          </div>

          <div className={styles.terms}>
            <input
              id="terms"
              type="checkbox"
              checked={termsAccepted}
              onChange={(event) => setTermsAccepted(event.target.checked)}
            />
            <label className={styles.termsIndicator} htmlFor="terms">
              {termsAccepted ? (
                <Check size={11} strokeWidth={3} />
              ) : (
                <Image
                  src="/assets/register-terms.svg"
                  alt=""
                  width={16}
                  height={15}
                />
              )}
            </label>
            <p>
              Li e aceito os <Link href="/termos-de-uso">Termos de Uso</Link>
              {" e a "}
              <Link href="/politica-de-privacidade">Política de Privacidade</Link>
            </p>
          </div>

          <button className={styles.submitButton} type="submit">
            Avançar
          </button>
        </form>
      </section>
    </main>
  );
}
