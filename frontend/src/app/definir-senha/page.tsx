"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";

import { getBrowserSupabaseClient } from "@/src/lib/supabase/browser";

import styles from "./page.module.css";

export default function DefinePasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [isReady, setIsReady] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackIsError, setFeedbackIsError] = useState(false);

  useEffect(() => {
    async function establishInviteSession() {
      try {
        const supabase = getBrowserSupabaseClient();
        const code = new URLSearchParams(window.location.search).get("code");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);

          if (error) {
            throw error;
          }
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          throw new Error(
            "Este link é inválido ou expirou. Solicite um novo convite.",
          );
        }

        setIsReady(true);
      } catch (error) {
        setFeedbackIsError(true);
        setFeedback(
          error instanceof Error
            ? error.message
            : "Não foi possível validar o convite.",
        );
      }
    }

    void establishInviteSession();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");

    if (password.length < 8) {
      setFeedbackIsError(true);
      setFeedback("A senha deve ter ao menos 8 caracteres.");
      return;
    }

    if (password !== confirmation) {
      setFeedbackIsError(true);
      setFeedback("As senhas não coincidem.");
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = getBrowserSupabaseClient();
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        throw error;
      }

      setFeedbackIsError(false);
      setFeedback("Senha definida. Agora você já pode entrar na sua conta.");
      setPassword("");
      setConfirmation("");
    } catch (error) {
      setFeedbackIsError(true);
      setFeedback(
        error instanceof Error
          ? error.message
          : "Não foi possível definir a senha.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="define-password-title">
        <h1 id="define-password-title">Defina sua senha</h1>
        <p>
          Crie uma senha para acessar sua conta IntegraMEI com seu CNPJ.
        </p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label htmlFor="new-password">Nova senha</label>
          <input
            id="new-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            disabled={!isReady || isSubmitting}
            required
          />

          <label htmlFor="password-confirmation">Confirme a senha</label>
          <input
            id="password-confirmation"
            type="password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            disabled={!isReady || isSubmitting}
            required
          />

          {feedback ? (
            <p
              className={styles.feedback}
              role={feedbackIsError ? "alert" : "status"}
              data-error={feedbackIsError}
            >
              {feedback}
            </p>
          ) : null}

          <button type="submit" disabled={!isReady || isSubmitting}>
            {isSubmitting ? "Salvando..." : "Salvar senha"}
          </button>
        </form>

        <Link href="/">Voltar ao login</Link>
      </section>
    </main>
  );
}
