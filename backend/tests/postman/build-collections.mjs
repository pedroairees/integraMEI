import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { collectionDir, privateDir, json, environment } from './support.mjs';
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const month = date.slice(0, 7);
const settings = { fullName: 'Pessoa Teste Postman Atualizada', phone: '61900000001', emailAlerts: true, invoiceReminders: false, lowStockAlerts: true, timeZone: 'America/Manaus' };
const supply = { name: 'Insumo QA {{runTag}}', unit: 'kg', minimum: 2, active: true };
const quote = { name: 'Produto QA {{runTag}}', baseCost: 20, markup: 100, currentPrice: 30, monthlyUnits: 10, ingredients: [] };
const report = { start: '{{start}}', end: '{{end}}', type: 'full', scope: 'professional', format: 'pdf', originals: false };
const test = (title, code) => `pm.test(${JSON.stringify(title)}, function () { ${code} });`;
for (const mode of ['local', 'real']) {
  const items = [];
  function add(name, method, path, status, body, checks = [], options = {}) {
    const header = [{ key: 'Accept', value: 'application/json' }];
    if (options.auth !== false) header.push({ key: 'Authorization', value: `Bearer {{${options.token ?? 'token'}}}` });
    if (options.publicKey) header.push({ key: 'apikey', value: '{{publicKey}}' });
    if (body !== undefined) header.push({ key: 'Content-Type', value: 'application/json' });
    const script = [test(`HTTP ${status}`, `pm.response.to.have.status(${status});`), ...checks];
    if (status >= 400 && path.startsWith('/v1/')) script.push(test('Erro seguro sem stack trace', 'const b = pm.response.json(); pm.expect(b.message).to.be.a("string"); pm.expect(b).not.to.have.property("stack");'));
    items.push({ name, request: { method, header, auth: { type: 'noauth' }, url: (options.base ?? '{{apiBase}}') + path, ...(body === undefined ? {} : { body: { mode: 'raw', raw: JSON.stringify(body, null, 2), options: { raw: { language: 'json' } } } }), description: options.description ?? name }, event: [{ listen: 'test', script: { type: 'text/javascript', exec: script } }] });
  }
  const eq = (title, actual, expected) => test(title, `pm.expect(${actual}).to.eql(${expected});`);
  add('01 Saúde da API', 'GET', '/health', 200, undefined, [eq('Serviço disponível', 'pm.response.json().status', '"ok"')], { auth: false });
  add('02 Dashboard exige autenticação', 'GET', '/v1/dashboard', 401, undefined, [], { auth: false });
  add('03 Token inválido é recusado', 'GET', '/v1/settings', 401, undefined, [], { token: 'invalidToken' });
  add('04 Login com conta exclusiva de teste', 'POST', '/auth/v1/token?grant_type=password', 200, { email: '{{email}}', password: '{{password}}' }, [test('Token de acesso recebido', 'pm.expect(pm.response.json().access_token).to.be.a("string").and.not.empty;'), 'if (pm.response.code === 200) pm.environment.set("token", pm.response.json().access_token);'], { auth: false, publicKey: true, base: '{{authBase}}', description: 'Login direto no Supabase Auth. Não valida a tela de login/CNPJ nem envio de confirmação por e-mail.' });
  add('05 Configurações pertencem à conta logada', 'GET', '/v1/settings', 200, undefined, [eq('Nome da conta', 'pm.response.json().fullName', 'pm.environment.get("initialName")'), eq('E-mail da conta', 'pm.response.json().email', 'pm.environment.get("email")'), test('Resposta não armazenada em cache', 'pm.expect(pm.response.headers.get("Cache-Control")).to.include("no-store");')]);
  add('06 Salvar nome, telefone e preferências', 'PATCH', '/v1/settings', 200, settings, [eq('Nome salvo', 'pm.response.json().fullName', JSON.stringify(settings.fullName))]);
  add('07 Ler novamente as configurações salvas', 'GET', '/v1/settings', 200, undefined, [test('Persistência de todos os campos', `const b = pm.response.json(); const expected = ${JSON.stringify(settings)}; for (const [k,v] of Object.entries(expected)) pm.expect(b[k], k).to.eql(v);`)]);
  add('08 Telefone inválido é recusado', 'PATCH', '/v1/settings', 400, { ...settings, phone: '123' });
  add('09 Alteração direta de e-mail no perfil é recusada', 'PATCH', '/v1/settings', 400, { ...settings, email: 'nao-enviar@example.com' });
  add('10 Dashboard reflete os lançamentos conhecidos', 'GET', '/v1/dashboard?month={{month}}&months=3&scope=professional', 200, undefined, [eq('Receita exata', 'pm.response.json().metrics.revenue', 'Number(pm.environment.get("expectedRevenue"))'), eq('Custos exatos', 'pm.response.json().metrics.costs', 'Number(pm.environment.get("expectedCosts"))'), eq('Lucro = receita - custos', 'pm.response.json().metrics.profit', 'Number(pm.environment.get("expectedRevenue")) - Number(pm.environment.get("expectedCosts"))'), test('Gráfico de despesas tem três meses e custo final correto', 'const b=pm.response.json(); pm.expect(b.evolution).to.have.length(3); pm.expect(b.evolution[2].month).to.eql(pm.environment.get("month")); pm.expect(b.evolution[2].value).to.eql(Number(pm.environment.get("expectedCosts")));')]);
  add('11 Mês inválido é recusado', 'GET', '/v1/dashboard?month=2026-13', 400);
  add('12 Salvar meta da empresa de teste', 'PATCH', '/v1/dashboard/goal', 204, { value: 1000, marginTarget: 30 });
  add('13 Meta aparece no dashboard', 'GET', '/v1/dashboard?month={{month}}', 200, undefined, [eq('Meta persistida', 'pm.response.json().goal.value', '1000'), eq('Meta de margem persistida', 'pm.response.json().marginTarget', '30')]);
  add('14 Listar insumos da empresa', 'GET', '/v1/supplies', 200, undefined, [test('Lista de insumos válida', 'pm.expect(pm.response.json().supplies).to.be.an("array");')]);
  add('15 Cadastrar insumo manualmente', 'POST', '/v1/supplies', 201, supply, [test('Identificador e versão recebidos', 'const s=pm.response.json().supply; pm.expect(s.id).to.match(/^[a-f0-9-]{36}$/); pm.expect(s.versao_cadastro).to.match(/^[a-f0-9-]{36}$/);'), 'if (pm.response.code===201) { const s=pm.response.json().supply; pm.environment.set("supplyId",s.id); pm.environment.set("supplyVersion",s.versao_cadastro); }']);
  add('16 Pesquisa encontra o insumo salvo', 'GET', '/v1/supplies?q={{runTag}}', 200, undefined, [test('Registro recém-criado encontrado', 'pm.expect(pm.response.json().supplies.some(s=>s.id===pm.environment.get("supplyId"))).to.eql(true);')]);
  add('17 Atualizar insumo com versão atual', 'PATCH', '/v1/supplies/{{supplyId}}', 200, { ...supply, minimum: 3, version: '{{supplyVersion}}' }, [eq('Estoque mínimo atualizado', 'Number(pm.response.json().supply.estoque_minimo)', '3')]);
  add('18 Impedir sobrescrita com versão antiga', 'PATCH', '/v1/supplies/{{supplyId}}', 409, { ...supply, minimum: 9, version: '{{supplyVersion}}' });
  add('19 Insumo com estoque mínimo negativo é recusado', 'POST', '/v1/supplies', 400, { ...supply, minimum: -1 });
  add('20 Registrar compra manual de insumo', 'POST', '/v1/supplies/{{supplyId}}/prices', 201, { requestId: '{{priceId}}', source: 'manual', quantity: 2, price: 6, date: '{{end}}', supplier: 'Fornecedor fictício Postman' }, [eq('Compra registrada', 'pm.response.json().success', 'true')]);
  add('21 Histórico de compra mantém preço e unidade', 'GET', '/v1/supplies/{{supplyId}}/prices?start={{start}}&end={{end}}', 200, undefined, [eq('Preço médio exato', 'pm.response.json().average', '6'), eq('Unidade preservada', 'pm.response.json().unit', '"kg"'), eq('Uma compra registrada', 'pm.response.json().points.length', '1')]);
  add('22 Calcular preço por custo base', 'POST', '/v1/pricing/quote', 200, quote, [eq('Custo de R$20', 'pm.response.json().cost', '20'), eq('Preço com markup 100%', 'pm.response.json().suggestedPrice', '40'), eq('Margem de 50%', 'pm.response.json().margin', '50')]);
  add('23 Calcular preço com insumo comprado', 'POST', '/v1/pricing/quote', 200, { ...quote, ingredients: [{ supplyId: '{{supplyId}}', quantity: 1 }] }, [eq('Custo base + compra = R$26', 'pm.response.json().cost', '26'), eq('Preço sugerido = R$52', 'pm.response.json().suggestedPrice', '52')]);
  add('24 Salvar produto precificado', 'POST', '/v1/pricing/products', 200, { ...quote, id: '{{productId}}', version: null }, [eq('ID salvo', 'pm.response.json().id', 'pm.variables.get("productId")')]);
  add('25 Consultar produto salvo', 'GET', '/v1/pricing', 200, undefined, [test('Produto persistido encontrado', 'pm.expect(pm.response.json().products.some(p=>p.id===pm.variables.get("productId"))).to.eql(true);')]);
  add('26 Impedir edição de produto com versão errada', 'POST', '/v1/pricing/products', 409, { ...quote, id: '{{productId}}', version: '{{priceId}}' });
  add('27 Rejeitar valores monetários com três casas', 'POST', '/v1/pricing/quote', 400, { ...quote, baseCost: 20.001 });
  add('28 Consultar notas de custos', 'GET', '/v1/invoices?kind=cost&period=all', 200, undefined, [test('Lista de notas válida', 'pm.expect(pm.response.json().invoices).to.be.an("array");')]);
  add('29 Rejeitar arquivo de tipo não permitido', 'POST', '/v1/invoices', 400, { name: 'teste.txt', mime: 'text/plain', content: 'dGVzdGU=', kind: 'cost' });
  add('30 Exigir justificativa suficiente para exclusão', 'DELETE', '/v1/invoices/00000000-0000-4000-8000-000000000001', 400, { reason: 'erro' });
  add('31 Consultar disponibilidade de e-mail', 'GET', '/v1/reports/options', 200, undefined, [test('Configuração de e-mail informada', 'pm.expect(pm.response.json().emailConfigured).to.be.a("boolean");')]);
  for (const [format, number, mime, signature] of [['pdf',32,'application/pdf','%PDF-'], ['xlsx',33,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','PK'], ['both',34,'application/zip','PK']]) {
    add(`${number} Exportar relatório ${format.toUpperCase()}`, 'POST', '/v1/reports/download', 200, { ...report, format }, [test('Tipo de arquivo correto', `pm.expect(pm.response.headers.get('Content-Type')).to.include(${JSON.stringify(mime)});`), test('Assinatura binária válida', `pm.expect(pm.response.text().slice(0,${signature.length})).to.eql(${JSON.stringify(signature)});`), test('Download com nome e proteção MIME', 'pm.expect(pm.response.headers.get("Content-Disposition")).to.include("attachment;"); pm.expect(pm.response.headers.get("X-Content-Type-Options")).to.eql("nosniff");')]);
  }
  add('35 Rejeitar relatório com período invertido', 'POST', '/v1/reports/download', 400, { ...report, start: '2026-11-30', end: '2026-11-01' });
  add('36 Relatório sem dados informa vazio', 'POST', '/v1/reports/download', 422, { ...report, start: '2000-01-01', end: '2000-01-02' });
  if (mode === 'real') {
    add('37 Login de uma segunda empresa isolada', 'POST', '/auth/v1/token?grant_type=password', 200, { email: '{{secondEmail}}', password: '{{secondPassword}}' }, [test('Segunda sessão recebida', 'pm.expect(pm.response.json().access_token).to.be.a("string").and.not.empty;'), 'if(pm.response.code===200) pm.environment.set("secondToken",pm.response.json().access_token);'], { auth: false, publicKey: true, base: '{{authBase}}' });
    add('38 Outra empresa não lista o insumo criado', 'GET', '/v1/supplies', 200, undefined, [eq('Lista vazia na segunda empresa', 'pm.response.json().supplies', '[]')], { token: 'secondToken' });
    add('39 Outra empresa não consulta histórico por ID', 'GET', '/v1/supplies/{{supplyId}}/prices?start={{start}}&end={{end}}', 404, undefined, [], { token: 'secondToken' });
    add('40 RLS impede leitura direta do insumo alheio', 'GET', '/rest/v1/insumos?id=eq.{{supplyId}}&select=id,nome', 200, undefined, [eq('Nenhuma linha vaza pela API do banco', 'pm.response.json()', '[]')], { token: 'secondToken', publicKey: true, base: '{{authBase}}' });
    add('41 RPC rejeita empresa de outro usuário', 'POST', '/rest/v1/rpc/dados_configuracoes', 403, { p_empresa: '{{companyId}}' }, [eq('PostgreSQL rejeita acesso', 'pm.response.json().code', '"42501"')], { token: 'secondToken', publicKey: true, base: '{{authBase}}' });
    add('42 Dashboard da segunda empresa continua zerado', 'GET', '/v1/dashboard?month={{month}}', 200, undefined, [eq('Receita de outra conta não vaza', 'pm.response.json().metrics.revenue', '0')], { token: 'secondToken' });
    add('43 Perfil da segunda conta permanece intacto', 'GET', '/v1/settings', 200, undefined, [eq('Nome não alterado em outra empresa', 'pm.response.json().fullName', '"Teste Postman B"')], { token: 'secondToken' });
  } else {
    for (const [format, n] of [['pdf',37], ['xlsx',38]]) add(`${n} E-mail ${format.toUpperCase()} com transporte simulado`, 'POST', '/v1/reports/email', 200, { ...report, format, recipient: 'qa@example.test', requestId: format==='pdf' ? '{{mailId}}' : '{{mailXlsxId}}' }, [test('Aceite informado', 'pm.expect(pm.response.json().message).to.include("aceito");')], { description: 'A API gera o anexo; o transporte de e-mail é simulado. Não comprova entrega em uma caixa de entrada real.' });
    add('39 Repetição do e-mail não dispara novo envio', 'POST', '/v1/reports/email', 200, { ...report, recipient: 'qa@example.test', requestId: '{{mailId}}' }, [test('Repetição identificada', 'pm.expect(pm.response.json().message).to.include("já foi aceito");')]);
    add('40 Recuperação exige senha atual correta', 'POST', '/v1/settings/password-reset', 400, { currentPassword: 'SenhaErrada!123' });
    add('41 Recuperação de senha com provedor simulado', 'POST', '/v1/settings/password-reset', 200, { currentPassword: '{{password}}' }, [test('Solicitação aceita', 'pm.expect(pm.response.json().message).to.include("aceita");')]);
    add('42 Alteração de e-mail aguarda confirmação simulada', 'POST', '/v1/settings/email', 200, { email: 'novo@example.test' });
    add('43 E-mail pendente não substitui identidade confirmada', 'GET', '/v1/settings', 200, undefined, [eq('E-mail confirmado preservado', 'pm.response.json().email', 'pm.environment.get("email")'), eq('Novo e-mail permanece pendente', 'pm.response.json().pendingEmail', '"novo@example.test"')]);
  }
  const vars = { invalidToken: 'token-invalido-para-teste', supplyId: '', supplyVersion: '', productId: randomUUID(), priceId: randomUUID(), mailId: randomUUID(), mailXlsxId: randomUUID() };
  const collection = { info: { name: `IntegraMEI - ${mode === 'real' ? 'Supabase real' : 'Local com serviços simulados'}`, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json', description: 'Executar em ordem pelo Collection Runner. Usa exclusivamente contas/empresas sintéticas. Gera e modifica dados de teste. Nunca usar credenciais de uma conta pessoal. Testes reais não enviam e-mails nem chamam IA. Consulte INSTRUCOES.md.' }, variable: Object.entries(vars).map(([key,value])=>({key,value})), item: items };
  json(resolve(collectionDir, `${mode}.postman_collection.json`), collection);
  json(resolve(collectionDir, `${mode}.postman_environment.example.json`), environment(`IntegraMEI ${mode} - preencher localmente`, { apiBase: `http://127.0.0.1:${mode === 'real' ? 3338 : 3337}`, authBase: mode==='real' ? 'https://SEU-PROJETO.supabase.co' : 'http://127.0.0.1:39401', publicKey: '', email: '', password: '', secondEmail: '', secondPassword: '', companyId: '', otherCompanyId: '', runTag: '', month, start: `${month}-01`, end: date, expectedRevenue: mode==='real'?150:1200, expectedCosts: mode==='real'?0:600, initialName: mode==='real'?'Teste Postman A':'Perfil Cadastrado', token: '', secondToken: '' }));
}
json(resolve(privateDir,'local.environment.json'), environment('IntegraMEI local - somente simulação', { apiBase:'http://127.0.0.1:3337',authBase:'http://127.0.0.1:39401',publicKey:'test-publishable-key',email:'dashboard@example.test',password:'Only-for-local-tests!42',runTag:randomUUID(),month,start:`${month}-01`,end:date,expectedRevenue:1200,expectedCosts:600,initialName:'Perfil Cadastrado',token:'' }));
console.log('Coleções local/real criadas: 43 requisições em cada. Ambientes compartilháveis sem credenciais.');
