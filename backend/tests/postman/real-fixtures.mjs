// Admin is used ONLY for provisioning/cleanup of this run's synthetic tenants.
// Postman itself receives only the publishable key and ordinary test credentials.
import { createClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { configuration, privateDir, artifactDir, json, read, environment } from './support.mjs';
const { url, key, adminKey } = configuration();
const client = createClient(url, adminKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20000) }) } });
const manifestPath = resolve(privateDir, 'fixtures.json');
function checked(result, label) {
  if (result.error) throw Error(`${label}: ${result.error.code ?? result.error.status ?? 'error'} ${result.error.message}`);
  return result.data;
}
function cnpj() {
  let value = Array.from(randomBytes(8), x => String(x % 10)).join('') + '0001';
  for (const weights of [[5,4,3,2,9,8,7,6,5,4,3,2], [6,5,4,3,2,9,8,7,6,5,4,3,2]]) {
    const mod = weights.reduce((s, w, i) => s + Number(value[i]) * w, 0) % 11;
    value += mod < 2 ? '0' : String(11 - mod);
  }
  return value;
}
if (process.argv[2] === 'setup') {
  if (existsSync(manifestPath) && !read(manifestPath).cleanedAt) throw Error('Existe uma execução sem limpeza concluída; use cleanup antes de preparar outra.');
  const state = { runId: randomUUID(), startedAt: new Date().toISOString(), project: new URL(url).hostname, tenants: [] };
  json(manifestPath, state);
  for (const label of ['A', 'B']) {
    const email = `qa-postman-${state.runId}-${label.toLowerCase()}@example.com`;
    const password = `Qa!${randomBytes(24).toString('base64url')}9z`;
    const data = checked(await client.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nome_completo: `Teste Postman ${label}`, razao_social: `TESTE POSTMAN ${state.runId} ${label}`, cnpj: cnpj(), data_nascimento: '1990-01-01', telefone: '61900000000' } }), 'Criar conta sintética');
    const tenant = { label, authId: data.user.id, email, password };
    state.tenants.push(tenant); json(manifestPath, state);
    const profile = checked(await client.from('usuarios').select('id').eq('usuario_auth_id', tenant.authId).single(), 'Perfil criado pelo trigger');
    tenant.profileId = profile.id; json(manifestPath, state);
    const membership = checked(await client.from('membros_empresa').select('empresa_id').eq('usuario_id', tenant.profileId).single(), 'Empresa criada pelo trigger');
    tenant.companyId = membership.empresa_id; json(manifestPath, state);
  }
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const a = state.tenants[0], b = state.tenants[1];
  // Known sale is a fixture, not evidence of an invoice upload or financial posting.
  const sale = checked(await client.from('vendas').insert({ empresa_id: a.companyId, data: date, valor_total: 150 }).select('id').single(), 'Venda sintética de R$150');
  state.saleId = sale.id; json(manifestPath, state);
  json(resolve(privateDir, 'real.environment.json'), environment('IntegraMEI - Supabase real - PRIVADO', {
    apiBase: 'http://127.0.0.1:3338', authBase: url, publicKey: key,
    email: a.email, password: a.password, secondEmail: b.email, secondPassword: b.password,
    companyId: a.companyId, otherCompanyId: b.companyId, runTag: state.runId,
    month: date.slice(0, 7), start: date.slice(0, 7) + '-01', end: date,
    expectedRevenue: 150, expectedCosts: 0, initialName: 'Teste Postman A', token: '', secondToken: ''
  }));
  json(resolve(artifactDir, 'real-preconditions.json'), { runId: state.runId, preparedAt: new Date().toISOString(), project: state.project, tenants: state.tenants.map(({ label, authId, companyId, profileId }) => ({ label, authId, companyId, profileId })), sale: { id: sale.id, value: 150, date }, authentication: 'Contas sintéticas criadas via Admin, confirmadas sem envio de e-mail. Login testado com senha pelo Auth real.', adminKeyInCollection: false });
  console.log('Preparadas 2 contas exclusivas e 1 venda sintética de R$150. Credenciais apenas em tmp ignorado pelo Git.');
} else if (process.argv[2] === 'cleanup') {
  const state = read(manifestPath);
  if (state.project !== new URL(url).hostname || !state.runId) throw Error('Manifesto não corresponde ao projeto configurado.');
  const actions = [];
  for (const t of state.tenants) {
    if (!t.email.startsWith(`qa-postman-${state.runId}-`)) throw Error('Identidade fora do escopo de teste.');
    const found = await client.auth.admin.getUserById(t.authId);
    if (found.data.user && found.data.user.email !== t.email) throw Error('A conta não corresponde ao manifesto.');
    if (t.companyId) {
      const company = checked(await client.from('empresas').select('razao_social').eq('id', t.companyId).maybeSingle(), 'Verificar empresa');
      if (company && company.razao_social !== `TESTE POSTMAN ${state.runId} ${t.label}`) throw Error('Empresa fora do escopo de teste.');
      // Only this manifest's companies. Never truncate or delete by generic name.
      for (const table of ['insumos_precos_registrados', 'produtos', 'insumos', 'vendas']) {
        checked(await client.from(table).delete().eq('empresa_id', t.companyId), `Limpar ${table}`);
        const remaining = checked(await client.from(table).select('id').eq('empresa_id', t.companyId), `Verificar ${table}`);
        if (remaining.length) throw Error(`Registros de teste restantes em ${table}`);
        actions.push({ tenant: t.label, table, remaining: 0 });
      }
      checked(await client.from('membros_empresa').delete().eq('empresa_id', t.companyId).eq('usuario_id', t.profileId), 'Limpar vínculo');
    }
    if (t.profileId) checked(await client.from('usuarios').delete().eq('id', t.profileId).eq('usuario_auth_id', t.authId), 'Limpar perfil');
    if (t.companyId) checked(await client.from('empresas').delete().eq('id', t.companyId), 'Limpar empresa');
    if (found.data.user) checked(await client.auth.admin.deleteUser(t.authId), 'Limpar Auth');
    const check = await client.auth.admin.getUserById(t.authId);
    if (check.data.user || (check.error && check.error.status !== 404)) throw Error('Não foi possível verificar remoção no Auth.');
    for (const [table, column, id] of [['usuarios', 'usuario_auth_id', t.authId], ['empresas', 'id', t.companyId], ['membros_empresa', 'usuario_id', t.profileId], ['preferencias_usuario', 'usuario_auth_id', t.authId]]) {
      if (!id) continue;
      const rows = checked(await client.from(table).select(column).eq(column, id), `Verificar limpeza de ${table}`);
      if (rows.length) throw Error(`Limpeza incompleta de ${table}`);
      actions.push({ tenant: t.label, table, remaining: 0 });
    }
    actions.push({ tenant: t.label, authDeleted: true });
  }
  state.cleanedAt = new Date().toISOString(); json(manifestPath, state);
  json(resolve(artifactDir, 'real-cleanup.json'), { runId: state.runId, cleanedAt: state.cleanedAt, actions, existingAccountsModified: false });
  console.log('Limpeza concluída: somente as contas e dados sintéticos desta execução foram removidos.');
} else throw Error('Use setup ou cleanup.');
