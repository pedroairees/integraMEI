import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { AppError } from "../../core/errors.ts";
import type {
  Settings,
  SettingsInput,
  SettingsRepository,
} from "../../core/settings/types.ts";

export class SupabaseSettingsRepository implements SettingsRepository {
  private client: SupabaseClient;
  private company: string;
  private user: User;
  private url: string;
  private publicKey: string;
  private token: string;
  private appUrl: string;
  constructor(
    client: SupabaseClient,
    company: string,
    user: User,
    url: string,
    publicKey: string,
    token: string,
    appUrl = process.env.APP_URL ||
      (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : ""),
  ) {
    this.client = client;
    this.company = company;
    this.user = user;
    this.url = url;
    this.publicKey = publicKey;
    this.token = token;
    this.appUrl = appUrl;
  }

  private async rpc(name: string, args: Record<string, unknown> = {}) {
    const { data, error } = await this.client.rpc(name, {
      p_empresa: this.company,
      ...args,
    });
    if (error) {
      if (["PGRST202", "42P01", "42703"].includes(error.code))
        throw new AppError(
          503,
          "Aplique a migração 20261104120000_account_settings.sql no Supabase para habilitar as configurações.",
        );
      if (error.code === "42501")
        throw new AppError(403, "Você não tem acesso a estas configurações.");
      throw new AppError(
        502,
        "Não foi possível salvar ou consultar as configurações. Tente novamente.",
      );
    }
    if (!data) throw new AppError(404, "Perfil não encontrado.");
    return {
      ...data,
      email: this.user.email,
      pendingEmail: this.user.new_email || null,
    } as Settings;
  }
  get() {
    return this.rpc("dados_configuracoes");
  }
  save(input: SettingsInput) {
    return this.rpc("salvar_configuracoes", { p_dados: input });
  }

  async changeEmail(email: string) {
    if (email === this.user.email?.toLowerCase())
      throw new AppError(400, "Informe um e-mail diferente do atual.");
    let response: Response;
    try {
      // Auth's user endpoint uses the verified user's JWT, never a service-role/admin credential.
      response = await fetch(`${this.url.replace(/\/$/, "")}/auth/v1/user`, {
        method: "PUT",
        headers: {
          apikey: this.publicKey,
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
        signal: AbortSignal.timeout(12000),
        redirect: "error",
      });
    } catch {
      throw new AppError(
        502,
        "Não foi possível confirmar a solicitação. Confira seu e-mail antes de tentar novamente.",
      );
    }
    if (!response.ok) {
      if (response.status === 429)
        throw new AppError(
          429,
          "Aguarde alguns minutos antes de solicitar outro e-mail.",
        );
      throw new AppError(
        400,
        "Não foi possível solicitar a alteração de e-mail. Verifique o endereço e tente novamente.",
      );
    }
  }
  async requestPasswordReset(password: string) {
    let redirect: URL;
    try {
      redirect = new URL("/definir-senha", this.appUrl);
      if (
        redirect.protocol !== "https:" &&
        !(
          redirect.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(redirect.hostname)
        )
      )
        throw Error();
    } catch {
      throw new AppError(
        503,
        "A recuperação de senha ainda não foi configurada para este endereço do aplicativo.",
      );
    }
    const auth = createClient(this.url, this.publicKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(12000) }),
      },
    });
    try {
      const { data, error } = await auth.auth.signInWithPassword({
        email: this.user.email!,
        password,
      });
      if (error || data.user?.id !== this.user.id)
        throw new AppError(
          400,
          "Senha atual incorreta ou indisponível. Confira e tente novamente.",
        );
      const reset = await auth.auth.resetPasswordForEmail(this.user.email!, {
        redirectTo: redirect.toString(),
      });
      if (reset.error)
        throw new AppError(
          reset.error.status === 429 ? 429 : 502,
          "Não foi possível solicitar o e-mail de recuperação. Aguarde alguns minutos e tente novamente.",
        );
    } finally {
      // Dispose of only the temporary password-verification session. Keep the user's browser session.
      await auth.auth.signOut({ scope: "local" }).catch(() => undefined);
    }
  }
}
