import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { root, privateDir, artifactDir, collectionDir, json, read } from './support.mjs';
const hash = b => createHash('sha256').update(b).digest('hex');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const secrets = new Set();
const rawDirs = readdirSync(privateDir, { withFileTypes:true }).filter(e=>e.isDirectory()&&/^(local|real)-/.test(e.name)).map(e=>resolve(privateDir,e.name));
for (const mode of ['local','real']) {
  for (const entry of read(resolve(privateDir, `${mode}.environment.json`)).values) if (/password|token|key/i.test(entry.key) && entry.value) secrets.add(String(entry.value));
}
for (const dir of rawDirs) {
  if (!existsSync(resolve(dir, 'raw.json'))) continue;
  for (const e of read(resolve(dir,'raw.json')).run.executions) {
    if (!e.requestExecuted.url.path?.includes('token')) continue;
    try { const b=JSON.parse(Buffer.from(e.response.stream.data).toString()); for(const k of ['access_token','refresh_token']) if(b[k]) secrets.add(b[k]); } catch { /* No successful auth response. */ }
    try { const b=JSON.parse(e.requestExecuted.body.raw); if(b.password) secrets.add(b.password); } catch { /* No request body. */ }
  }
}
function redact(s) {
  let out=String(s);
  for(const secret of secrets) out=out.split(secret).join('[REMOVIDO]');
  return out.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[TOKEN REMOVIDO]').replace(/\b(?:sb_secret_|sk-proj-|gsk_)[A-Za-z0-9_-]+/g,'[CHAVE REMOVIDA]');
}
function cleanObject(v) {
  if(Array.isArray(v)) return v.map(cleanObject);
  if(v&&typeof v==='object') return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,/password|access_token|refresh_token|authorization|cookie|secret|apikey/i.test(k)?'[REMOVIDO]':cleanObject(x)]));
  return typeof v==='string'?redact(v):v;
}
const modes=[], binaryChecks=[];
const sampleDir=resolve(artifactDir,'amostras'); mkdirSync(sampleDir,{recursive:true});
for(const mode of ['local','real']) {
  const location=read(resolve(privateDir,`${mode}-run-location.json`));
  const rawPath=resolve(location.privateRunDirectory,'raw.json');
  const raw=read(rawPath).run;
  const executions=[];
  for(const e of raw.executions) {
    const q=e.requestExecuted, r=e.response, path='/' + (q.url.path??[]).join('/');
    const headers=Object.fromEntries((r?.headers??[]).filter(h=>/^(content-type|content-disposition|cache-control|x-content-type-options)$/i.test(h.key)).map(h=>[h.key.toLowerCase(),h.value]));
    let requestBody, responseBody, artifact;
    if(q.body?.raw) { try { requestBody=cleanObject(JSON.parse(q.body.raw)); } catch { requestBody=redact(q.body.raw); } }
    const bytes=Buffer.from(r?.stream?.data??[]);
    if(headers['content-type']?.includes('json')) { try { responseBody=cleanObject(JSON.parse(bytes.toString())); } catch { responseBody=redact(bytes.toString()); } }
    else if(r?.code===200 && path==='/v1/reports/download') {
      const ext=headers['content-type'].includes('pdf')?'pdf':headers['content-type'].includes('spreadsheet')?'xlsx':'zip';
      const name=`${mode}-relatorio.${ext}`; writeFileSync(resolve(sampleDir,name),bytes);
      artifact={file:`amostras/${name}`,bytes:bytes.length,sha256:hash(bytes)};
      if(ext==='xlsx') {
        const wb=new ExcelJS.Workbook(); await wb.xlsx.load(bytes);
        const details=wb.getWorksheet('Lançamentos');
        // ExcelJS's reader omits a cached formula result equal to zero. Verify
        // the actual OOXML <v> rather than interpreting undefined as zero.
        const archive=await JSZip.loadAsync(bytes);
        const xml=await archive.file('xl/worksheets/sheet1.xml').async('string');
        const cached=cell=>{const match=xml.match(new RegExp(`<c r="${cell}"[^>]*>[\\s\\S]*?<v>([^<]+)</v>`));return match?Number(match[1]):null;};
        const expected=mode==='real'?150:1200, costs=mode==='real'?0:600;
        const rows=[]; details.eachRow((r,n)=>{if(n>1)rows.push({kind:r.getCell(2).value,amount:r.getCell(6).value});});
        for(const [checkName,actual,wanted] of [['Resumo: faturamento',cached('B9'),expected],['Resumo: custos',cached('B10'),costs],['Resumo: lucro',cached('B11'),expected-costs],['Soma das vendas exportadas',rows.filter(r=>r.kind==='Faturamento').reduce((s,r)=>s+Number(r.amount),0),expected]]) binaryChecks.push({mode,artifact:name,check:checkName,expected:wanted,actual,passed:actual===wanted});
      } else if(ext==='zip') {
        const zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
        const files=Object.keys(zip.files).filter(n=>!zip.files[n].dir);
        binaryChecks.push({mode,artifact:name,check:'ZIP abre, passa no CRC e contém PDF e XLSX',expected:true,actual:files.some(n=>n.endsWith('.pdf'))&&files.some(n=>n.endsWith('.xlsx')),passed:files.some(n=>n.endsWith('.pdf'))&&files.some(n=>n.endsWith('.xlsx')),files});
      } else {
        const pdf=await PDFDocument.load(bytes);
        binaryChecks.push({mode,artifact:name,check:'PDF abre e possui páginas',expected:true,actual:pdf.getPageCount()>0,passed:pdf.getPageCount()>0,pages:pdf.getPageCount()});
      }
    }
    const checks=(e.tests??[]).map(t=>({name:t.name,status:t.status,...(t.error?{error:redact(t.error.message)}:{})}));
    executions.push({name:q.name,method:q.method,path,query:(q.url.query??[]).map(({key,value})=>({key,value})),requestBody,status:r?.code??null,durationMs:r?.responseTime??null,headers,responseBody,artifact,checks,errors:(e.errors??[]).map(x=>({code:x.code,message:redact(x.message)})),passed:checks.every(t=>t.status==='passed')&&!(e.errors?.length)&&Boolean(r)});
  }
  const result={mode,environment:mode==='real'?'Backend local + Supabase Auth/PostgreSQL reais':'Backend local + Auth, banco, armazenamento e e-mail simulados',tool:'Postman CLI',version:read(resolve(root,'tmp/postman-runtime/node_modules/postman-cli/package.json')).version,startedAt:new Date(raw.meta.started).toISOString(),finishedAt:new Date(raw.meta.completed).toISOString(),durationMs:raw.meta.duration,exitCode:location.exitCode,summary:raw.summary,rawReportSha256:hash(readFileSync(rawPath)),redaction:'Headers de autenticação omitidos; senhas e tokens removidos. JSON normalizado do relatório original da CLI, sem alterar resultados.',collectionSha256:hash(readFileSync(resolve(collectionDir,`${mode}.postman_collection.json`))),executions};
  json(resolve(artifactDir,`${mode}-resultados.json`),result);
  writeFileSync(resolve(artifactDir,`${mode}-junit.xml`),redact(readFileSync(resolve(location.privateRunDirectory,'raw.xml'),'utf8')));
  writeFileSync(resolve(artifactDir,`${mode}-postman.log`),redact(readFileSync(resolve(location.privateRunDirectory,'raw-cli.txt'),'utf8').replace(/\x1b\[[0-9;]*m/g,'')));
  copyFileSync(resolve(collectionDir,`${mode}.postman_collection.json`),resolve(artifactDir,`${mode}.postman_collection.json`));
  copyFileSync(resolve(collectionDir,`${mode}.postman_environment.example.json`),resolve(artifactDir,`${mode}.postman_environment.example.json`));
  modes.push(result);
}
const history=rawDirs.filter(dir=>existsSync(resolve(dir,'raw.json'))).map(dir=>{
  const r=read(resolve(dir,'raw.json')).run;
  return {run:basename(dir),startedAt:new Date(r.meta.started).toISOString(),summary:r.summary,rawReportSha256:hash(readFileSync(resolve(dir,'raw.json'))),failures:r.executions.filter(e=>e.errors?.length||e.tests?.some(t=>t.status==='failed')).map(e=>({name:e.requestExecuted.name,errors:(e.errors??[]).map(x=>({code:x.code,message:redact(x.message)})),checks:e.tests?.filter(t=>t.status==='failed').map(t=>({name:t.name,message:redact(t.error?.message)}))}))};
});
json(resolve(artifactDir,'historico/execucoes.json'), {notes:['Duas tentativas locais não alcançaram a API por restrição de conexão (EACCES/ETIMEDOUT); não são resultados da aplicação.', 'Na primeira rodada real, 101/102 verificações passaram. A asserção do gráfico comparava despesas com receita. Foi corrigida conforme o contrato existente; a aplicação não foi alterada. A coleção completa foi repetida com novas contas.'],runs:history});
json(resolve(artifactDir,'validacao-arquivos.json'),binaryChecks);
const summary={generatedAt:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),branch:execFileSync('git',['branch','--show-current'],{cwd:root,encoding:'utf8'}).trim(),node:process.version,postmanVersion:modes[0].version,results:modes.map(({mode,environment,summary,exitCode,startedAt,finishedAt,durationMs})=>({mode,environment,summary,exitCode,startedAt,finishedAt,durationMs})),artifactChecks:binaryChecks,cleanup:read(resolve(artifactDir,'real-cleanup.json')),limits:['Não comprova entrega real de e-mails, confirmação de cadastro ou alteração real de endereço.', 'Não testa provedores externos de IA, qualidade do OCR, upload/lançamento/exclusão completos de notas, carga ou interface visual.', 'A venda real de R$150 é uma pré-condição sintética inserida para testar leitura financeira e exportação; não foi criada pelo fluxo de notas.', 'Testes reais usam o backend local com Auth e banco reais. O navegador, BFF e login por CNPJ não fazem parte desta coleção.']};
json(resolve(artifactDir,'resumo.json'),summary);
const total=modes.reduce((n,m)=>n+m.summary.executedRequests.executed,0), passed=modes.reduce((n,m)=>n+m.summary.tests.passed,0), failed=modes.reduce((n,m)=>n+m.summary.tests.failed,0);
writeFileSync(resolve(artifactDir,'evidencias.html'),`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IntegraMEI | Evidências Postman</title><style>body{font:16px system-ui,sans-serif;background:#f2f5fa;color:#142a4d;margin:0}main{max-width:1120px;margin:auto;padding:40px 24px}h1{font-size:36px}h2{margin-top:40px}.cards{display:flex;gap:16px;flex-wrap:wrap}.card,details{background:white;padding:20px;border:1px solid #dce4ee;border-radius:12px;margin:12px 0}.card b{display:block;font-size:30px}.ok{color:#166534}.bad{color:#b91c1c}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:10px;border-bottom:1px solid #dce4ee;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}summary{cursor:pointer}small{color:#52647a}a{color:#1e3c73}@media print{details{break-inside:avoid}body{background:white}}</style><main><small>VALIDAÇÃO DA API / ${escape(summary.generatedAt)}</small><h1>IntegraMEI · Testes com Postman</h1><p>Execução real da Postman CLI ${escape(summary.postmanVersion)}. Resultados de dois ambientes separados.</p><div class="cards"><div class="card"><b>${total}</b>requisições</div><div class="card"><b class="ok">${passed}</b>verificações aprovadas</div><div class="card"><b class="${failed?'bad':'ok'}">${failed}</b>falhas na rodada final</div></div><p>Commit: <code>${summary.commit}</code> · branch ${escape(summary.branch)}</p>${modes.map(m=>`<h2>${m.mode==='real'?'Supabase real':'Ambiente local simulado'}</h2><p>${escape(m.environment)}. ${m.summary.executedRequests.executed} requisições, ${m.summary.tests.passed}/${m.summary.tests.executed} verificações aprovadas. ${escape(m.startedAt)} a ${escape(m.finishedAt)}.</p><p><a href="${m.mode}-resultados.json">Respostas e verificações (JSON)</a> · <a href="${m.mode}-junit.xml">JUnit XML</a> · <a href="${m.mode}-postman.log">Log Postman</a></p>${m.executions.map(e=>`<details><summary><span class="${e.passed?'ok':'bad'}">${e.passed?'PASSOU':'FALHOU'}</span> · ${escape(e.name)} · HTTP ${e.status??'sem resposta'} · ${e.durationMs??0} ms</summary><p><code>${escape(e.method)} ${escape(e.path)}</code></p><ul>${e.checks.map(t=>`<li>${escape(t.status)}: ${escape(t.name)} ${escape(t.error??'')}</li>`).join('')}</ul>${e.artifact?`<p><a href="${e.artifact.file}">Baixar arquivo efetivamente retornado pela API</a> (${e.artifact.bytes} bytes)</p>`:`<pre>${escape(JSON.stringify(e.responseBody,null,2)??'Sem corpo de resposta')}</pre>`}</details>`).join('')}`).join('')}<h2>Limpeza e limites</h2><p>As duas contas sintéticas finais e seus dados foram removidos em ${escape(summary.cleanup.cleanedAt)}. A primeira rodada também foi limpa. As operações foram limitadas às empresas registradas no manifesto de teste.</p><ul>${summary.limits.map(l=>`<li>${escape(l)}</li>`).join('')}</ul><p><a href="historico/execucoes.json">Histórico das tentativas iniciais</a> · <a href="validacao-arquivos.json">Conferência dos arquivos exportados</a> · <a href="real-cleanup.json">Comprovação da limpeza</a></p><p><small>Senhas, chaves e tokens foram removidos. O resumo não substitui uma auditoria de segurança ou teste de carga.</small></p></main></html>`);
console.log(JSON.stringify({requests:total,passed,failed,binaryChecks:binaryChecks.length,binaryFailures:binaryChecks.filter(c=>!c.passed).length}));
if(failed||binaryChecks.some(c=>!c.passed)||modes.some(m=>m.exitCode!==0))process.exitCode=1;
