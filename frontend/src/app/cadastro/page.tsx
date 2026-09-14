"use client";

import Image from "next/image";
import Link from "next/link";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { Check, Upload } from "lucide-react";

import styles from "./page.module.css";

function onlyNumbers(value: string, maxLength: number) {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

function formatCnpj(value: string) {
  const numbers = onlyNumbers(value, 14);

  return numbers
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
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
  const [companyLegalName, setCompanyLegalName] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [documentName, setDocumentName] = useState("");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackIsError, setFeedbackIsError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleDocumentChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setDocumentFile(file);
    setDocumentName(file?.name ?? "");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setFeedback("");

    if (!termsAccepted) {
      setFeedbackIsError(true);
      setFeedback("Leia e aceite os Termos de Uso e a Política de Privacidade.");
      return;
    }

    if (!documentFile) {
      setFeedbackIsError(true);
      setFeedback("Envie o documento RG ou CNH.");
      return;
    }

    const formData = new FormData();
    formData.set("fullName", fullName);
    formData.set("companyLegalName", companyLegalName);
    formData.set("cnpj", cnpj);
    formData.set("birthDate", birthDate);
    formData.set("phone", phone);
    formData.set("email", email);
    formData.set("termsAccepted", String(termsAccepted));
    formData.set("document", documentFile);

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/cadastro", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as { message?: string };

      if (!response.ok) {
        throw new Error(payload.message ?? "Não foi possível criar o cadastro.");
      }

      setFeedbackIsError(false);
      setFeedback(
        payload.message ??
          "Cadastro criado. Confira seu e-mail para definir sua senha.",
      );
      setFullName("");
      setCompanyLegalName("");
      setCnpj("");
      setBirthDate("");
      setPhone("");
      setEmail("");
      setDocumentFile(null);
      setDocumentName("");
      setTermsAccepted(false);
      form.reset();
    } catch (error) {
      setFeedbackIsError(true);
      setFeedback(
        error instanceof Error
          ? error.message
          : "Não foi possível criar o cadastro.",
      );
    } finally {
      setIsSubmitting(false);
    }
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
              required
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="company-legal-name">Razão social</label>
            <input
              id="company-legal-name"
              type="text"
              value={companyLegalName}
              onChange={(event) => setCompanyLegalName(event.target.value)}
              placeholder="Digite"
              autoComplete="organization"
              required
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="cnpj">CNPJ</label>
            <input
              id="cnpj"
              type="text"
              value={cnpj}
              onChange={(event) => setCnpj(formatCnpj(event.target.value))}
              placeholder="ex: 00.000.000/0000-00"
              inputMode="numeric"
              maxLength={18}
              autoComplete="off"
              required
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
              required
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
              required
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
              required
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
              accept="application/pdf,image/jpeg,image/png"
              onChange={handleDocumentChange}
              required
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

          {feedback ? (
            <p
              className={styles.formFeedback}
              role={feedbackIsError ? "alert" : "status"}
              data-error={feedbackIsError}
            >
              {feedback}
            </p>
          ) : null}

          <button className={styles.submitButton} type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Enviando..." : "Avançar"}
          </button>
        </form>
      </section>
    </main>
  );
}
