import { NextResponse } from "next/server";

import { getServerSupabaseClient } from "@/src/lib/supabase/server";

export const runtime = "nodejs";

const MAX_DOCUMENT_SIZE = 5 * 1024 * 1024;
const ACCEPTED_DOCUMENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

function textValue(formData: FormData, field: string) {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

function parseBirthDate(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);

  if (!match) {
    return null;
  }

  const [, day, month, year] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== Number(month) - 1 ||
    parsed.getUTCDate() !== Number(day)
  ) {
    return null;
  }

  return `${year}-${month}-${day}`;
}

function safeFileName(fileName: string) {
  const normalized = fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-");

  return normalized.slice(0, 120) || "documento";
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const fullName = textValue(formData, "fullName");
    const companyLegalName = textValue(formData, "companyLegalName");
    const cnpj = textValue(formData, "cnpj").replace(/\D/g, "");
    const birthDate = parseBirthDate(textValue(formData, "birthDate"));
    const phone = textValue(formData, "phone").replace(/\D/g, "");
    const email = textValue(formData, "email").toLowerCase();
    const termsAccepted = textValue(formData, "termsAccepted") === "true";
    const document = formData.get("document");

    if (
      !fullName ||
      !companyLegalName ||
      cnpj.length !== 14 ||
      !birthDate ||
      phone.length < 10 ||
      !/^\S+@\S+\.\S+$/.test(email) ||
      !termsAccepted
    ) {
      return NextResponse.json(
        { message: "Revise os dados obrigatórios do cadastro." },
        { status: 400 },
      );
    }

    if (!(document instanceof File)) {
      return NextResponse.json(
        { message: "Envie o documento RG ou CNH." },
        { status: 400 },
      );
    }

    if (
      document.size === 0 ||
      document.size > MAX_DOCUMENT_SIZE ||
      !ACCEPTED_DOCUMENT_TYPES.has(document.type)
    ) {
      return NextResponse.json(
        { message: "O documento deve ser PDF, JPEG ou PNG de até 5 MB." },
        { status: 400 },
      );
    }

    const supabase = getServerSupabaseClient();
    const redirectTo = new URL("/definir-senha", request.url).toString();
    const { data: invitation, error: invitationError } =
      await supabase.auth.admin.inviteUserByEmail(email, {
        data: {
          nome_completo: fullName,
          razao_social: companyLegalName,
          cnpj,
          data_nascimento: birthDate,
          telefone: phone,
        },
        redirectTo,
      });

    if (invitationError || !invitation.user) {
      const duplicateCnpj = invitationError?.message
        .toLowerCase()
        .includes("cnpj");

      return NextResponse.json(
        {
          message: duplicateCnpj
            ? "Este CNPJ já possui um cadastro."
            : "Não foi possível criar o cadastro. Verifique os dados e tente novamente.",
        },
        { status: duplicateCnpj ? 409 : 400 },
      );
    }

    const documentPath = `${invitation.user.id}/${crypto.randomUUID()}-${safeFileName(document.name)}`;
    const { error: uploadError } = await supabase.storage
      .from("user-documents")
      .upload(documentPath, document, {
        contentType: document.type,
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json(
        {
          message:
            "O cadastro foi criado, mas não foi possível enviar o documento. Entre em contato com o suporte.",
        },
        { status: 500 },
      );
    }

    const { error: profileError } = await supabase
      .from("usuarios")
      .update({ documento_path: documentPath })
      .eq("usuario_auth_id", invitation.user.id);

    if (profileError) {
      return NextResponse.json(
        {
          message:
            "O cadastro foi criado, mas não foi possível vincular o documento. Entre em contato com o suporte.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        message:
          "Cadastro criado. Confira seu e-mail para confirmar a conta e definir sua senha.",
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { message: "Não foi possível processar o cadastro agora." },
      { status: 500 },
    );
  }
}
