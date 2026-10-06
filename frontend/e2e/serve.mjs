// Local authentication provider used ONLY by Playwright. No real Supabase calls.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { buildApp } from "../../backend/src/web/app.ts";
import { createSessionResolver } from "../../backend/src/infra/supabase/session.ts";

const companyId = "11111111-1111-4111-8111-111111111111";
const supplyId = "22222222-2222-4222-8222-222222222222";
const month = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
})
  .format(new Date())
  .slice(0, 7);
const previous = new Date(`${month}-01T00:00:00Z`);
previous.setUTCMonth(previous.getUTCMonth() - 1);
let goal = 8000;
let marginTarget = null;
const financialRows = {
  vendas: [
    {
      id: "sale-1",
      empresa_id: companyId,
      data: `${month}-01`,
      valor_total: 1200,
    },
    {
      id: "sale-2",
      empresa_id: companyId,
      data: `${previous.toISOString().slice(0, 7)}-01`,
      valor_total: 1000,
    },
  ],
  notas_fiscais: [
    {
      id: "note-1",
      empresa_id: companyId,
      data_emissao: `${month}-01`,
      valor_total: 600,
      tipo: "professional",
      categoria_id: "category-1",
      status: "confirmed",
    },
    {
      id: "note-2",
      empresa_id: companyId,
      data_emissao: `${month}-01`,
      valor_total: 200,
      tipo: "personal",
      categoria_id: "category-2",
      status: "confirmed",
    },
  ],
  categorias: [
    { id: "category-1", empresa_id: companyId, nome: "Insumos" },
    { id: "category-2", empresa_id: companyId, nome: "Retiradas" },
  ],
  itens_nota_fiscal: [
    {
      id: "item-1",
      nota_fiscal_id: "note-1",
      insumo_id: supplyId,
      valor_total_item: 600,
    },
  ],
  insumos: [{ id: supplyId, empresa_id: companyId, nome: "Farinha" }],
  historico_precos: [
    {
      id: "price-1",
      empresa_id: companyId,
      insumo_id: supplyId,
      data_compra: `${month}-01`,
      valor_unitario: 6,
      unidade_medida: "kg",
      fornecedor_id: "supplier-1",
    },
  ],
  fornecedores: [
    {
      id: "supplier-1",
      empresa_id: companyId,
      razao_social: "Fornecedor de teste",
    },
  ],
  alertas: [],
};

const user = {
  id: "b76530b9-9324-4d94-a5ec-5bda2ab3c2aa",
  aud: "authenticated",
  role: "authenticated",
  email: "dashboard@example.test",
  email_confirmed_at: "2026-09-01T00:00:00Z",
  created_at: "2026-09-01T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { nome_completo: "Usuário Teste" },
};
const sessions = new Map();
const invoiceFiles = new Map();
const refreshTokens = new Set();
const refreshReplays = new Map();

function session() {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: expiresAt, aud: "authenticated" })}.${Buffer.from(crypto.randomUUID()).toString("base64url")}`;
  const refreshToken = crypto.randomUUID();
  sessions.set(token, refreshToken);
  refreshTokens.add(refreshToken);
  return {
    access_token: token,
    refresh_token: refreshToken,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    user,
  };
}

const authServer = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:39401");
  const token = req.headers.authorization?.replace(/^Bearer /, "");
  const send = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === "/auth/v1/token") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (url.searchParams.get("grant_type") === "refresh_token") {
      // Supabase permits concurrent refresh reuse for 10 seconds (SSR + API).
      // https://supabase.com/docs/guides/auth/sessions
      const replay = refreshReplays.get(body.refresh_token);
      if (
        replay &&
        Date.now() - replay.at < 10000 &&
        refreshTokens.has(replay.session.refresh_token)
      ) {
        return send(200, replay.session);
      }
      if (!refreshTokens.has(body.refresh_token))
        return send(400, {
          code: "refresh_token_not_found",
          message: "Invalid refresh token",
        });
      refreshTokens.delete(body.refresh_token);
      const refreshed = session();
      refreshReplays.set(body.refresh_token, {
        at: Date.now(),
        session: refreshed,
      });
      return send(200, refreshed);
    }
    if (
      body.email === user.email &&
      body.password === "Only-for-local-tests!42"
    )
      return send(200, session());
    return send(400, {
      code: "invalid_credentials",
      message: "Invalid login credentials",
    });
  }
  if (url.pathname === "/auth/v1/user") {
    if (sessions.has(token)) return send(200, user);
    return send(401, { code: "bad_jwt", message: "Invalid token" });
  }
  if (url.pathname === "/auth/v1/logout") {
    refreshTokens.delete(sessions.get(token));
    sessions.delete(token);
    res.writeHead(204);
    return res.end();
  }
  if (url.pathname.startsWith("/storage/v1/object/")) {
    if (!sessions.has(token)) return send(403, { message: "Unauthorized" });
    if (
      (req.method === "DELETE" &&
        url.pathname === "/storage/v1/object/invoice-documents") ||
      url.pathname === "/storage/v1/object/list/invoice-documents"
    ) {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      if (req.method === "DELETE") {
        for (const path of body.prefixes) {
          if (!path.startsWith(`${user.id}/${companyId}/`))
            return send(403, { message: "Denied" });
          const note = financialRows.notas_fiscais.find(
            (row) => row.caminho_arquivo === path,
          );
          if (
            note &&
            (!note.exclusao_solicitada_em || !note.exclusao_justificativa)
          )
            return send(403, { message: "Not deleting" });
          invoiceFiles.delete(path);
        }
        return send(
          200,
          body.prefixes.map((name) => ({ name })),
        );
      }
      if (!body.prefix.startsWith(`${user.id}/${companyId}`))
        return send(403, { message: "Denied" });
      return send(
        200,
        [...invoiceFiles.keys()]
          .filter((path) => path.startsWith(body.prefix + "/"))
          .map((path) => ({ name: path.split("/").at(-1) }))
          .filter((item) => !body.search || item.name.includes(body.search)),
      );
    }
    const path = decodeURIComponent(
      url.pathname.replace(
        /^\/storage\/v1\/object\/(authenticated\/)?invoice-documents\//,
        "",
      ),
    );
    if (!path.startsWith(`${user.id}/${companyId}/`))
      return send(403, { message: "Denied" });
    if (req.method === "POST") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      invoiceFiles.set(path, {
        data: Buffer.concat(chunks),
        mime: req.headers["content-type"],
      });
      return send(200, { Key: `invoice-documents/${path}` });
    }
    const file = invoiceFiles.get(path);
    if (req.method === "GET" && file) {
      res.writeHead(200, { "Content-Type": file.mime });
      return res.end(file.data);
    }
    return send(404, { message: "Not found" });
  }
  if (url.pathname.startsWith("/rest/v1/")) {
    if (token !== "test-server-key" && !sessions.has(token))
      return send(403, { message: "Unauthorized" });
    if (req.method === "POST" && url.pathname === "/rest/v1/notas_fiscais") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      if (body.enviado_por !== user.id || body.empresa_id !== companyId)
        return send(403, { message: "Denied" });
      if (
        financialRows.notas_fiscais.some(
          (row) => row.hash_arquivo === body.hash_arquivo,
        )
      )
        return send(409, { code: "23505" });
      body.exclusao_solicitada_em = null;
      body.exclusao_justificativa = null;
      financialRows.notas_fiscais.push(body);
      return send(201, body);
    }
    if (req.method === "PATCH" && url.pathname === "/rest/v1/empresas") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      goal = body.meta_faturamento_mensal;
      if (body.meta_margem_lucro_percentual !== undefined)
        marginTarget = body.meta_margem_lucro_percentual;
    }
    const rows = {
      "/rest/v1/empresas": [
        {
          id: companyId,
          cnpj: "12345678000195",
          razao_social: "Empresa Teste",
          meta_faturamento_mensal: goal,
          meta_margem_lucro_percentual: marginTarget,
        },
      ],
      "/rest/v1/membros_empresa": [
        { usuario_id: "test-profile", empresa_id: companyId, papel: "owner" },
      ],
      "/rest/v1/usuarios": [
        { id: "test-profile", usuario_auth_id: user.id, email: user.email },
      ],
    };
    let found =
      rows[url.pathname] ?? financialRows[url.pathname.split("/").at(-1)] ?? [];
    found = found.filter((row) =>
      [...url.searchParams].every(([field, condition]) => {
        if (["select", "order", "offset", "limit"].includes(field)) return true;
        let value = row[field];
        if (field.startsWith("notas_fiscais."))
          value = financialRows.notas_fiscais.find(
            (n) => n.id === row.nota_fiscal_id,
          )?.[field.split(".")[1]];
        if (condition.startsWith("eq."))
          return String(value) === condition.slice(3);
        if (condition.startsWith("gte."))
          return String(value) >= condition.slice(4);
        if (condition.startsWith("lt."))
          return String(value) < condition.slice(3);
        if (condition === "is.null") return value == null;
        if (condition === "not.is.null") return value != null;
        return true;
      }),
    );
    if (req.method === "DELETE" && url.pathname === "/rest/v1/notas_fiscais") {
      if (
        found.some(
          (row) =>
            row.enviado_por !== user.id ||
            !row.exclusao_solicitada_em ||
            !row.exclusao_justificativa ||
            invoiceFiles.has(row.caminho_arquivo),
        )
      )
        return send(403, { message: "Denied" });
      financialRows.notas_fiscais = financialRows.notas_fiscais.filter(
        (row) => !found.includes(row),
      );
    }
    if (req.method === "PATCH" && url.pathname === "/rest/v1/notas_fiscais") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      for (const row of found) {
        if (row.enviado_por !== user.id)
          return send(403, { message: "Denied" });
        if (
          body.exclusao_solicitada_em &&
          (!body.exclusao_justificativa ||
            body.exclusao_justificativa.trim().length < 10)
        )
          return send(400, { message: "Reason required" });
        Object.assign(row, body);
      }
    }
    const offset = Number(url.searchParams.get("offset") ?? 0),
      limit = Number(url.searchParams.get("limit") ?? 500);
    found = found.slice(offset, offset + limit);
    return send(
      200,
      req.headers.accept?.includes("application/vnd.pgrst.object+json")
        ? (found[0] ?? null)
        : found,
    );
  }
  return send(404, { message: "Unsupported mock request" });
});

await new Promise((resolve) => authServer.listen(39401, "127.0.0.1", resolve));
const backend = await buildApp(
  createSessionResolver("http://127.0.0.1:39401", "test-publishable-key"),
  {
    invoiceReader: {
      read: async (file) => {
        if (file.toString().includes("unreadable"))
          throw new Error("Simulated OCR failure");
        return {
          supplier: "Fornecedor E2E",
          cnpj: file.toString().includes("revenue")
            ? "12345678000195"
            : "98765432000198",
          recipientCnpj: file.toString().includes("revenue")
            ? "98765432000198"
            : file.toString().includes("ambiguous")
              ? null
              : "12345678000195",
          operation: "sale",
          date: `${month}-01`,
          total: 89.9,
          number: "123",
          items: ["Insumo de teste"],
        };
      },
    },
  },
);
await backend.listen({ port: 3337, host: "127.0.0.1" });
const app = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "--port", "3107"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_TEST_OUTPUT_DIR: ".next-e2e",
      BACKEND_URL: "http://127.0.0.1:3337",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:39401",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
      SUPABASE_SECRET_KEY: "test-server-key",
      SUPABASE_SERVICE_ROLE_KEY: "test-server-key",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    app.kill();
    authServer.close();
    void backend.close();
  });
}
app.on("exit", (code) => {
  authServer.close();
  void backend.close();
  process.exitCode = code ?? 0;
});
