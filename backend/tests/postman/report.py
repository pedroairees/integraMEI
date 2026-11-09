"""Create a human-readable evidence report from actual Postman CLI results."""
import hashlib
import json
import shutil
import zipfile
from datetime import datetime
from pathlib import Path
from xml.sax.saxutils import escape

from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'output' / 'testes-postman'
PDF = ROOT / 'output' / 'pdf' / 'integramei-evidencias-postman.pdf'
load = lambda name: json.loads((OUT / name).read_text(encoding='utf-8'))
summary = load('resumo.json')
runs = [load(f'{mode}-resultados.json') for mode in ('local', 'real')]
navy, blue, light, green = map(colors.HexColor, ['#1E3C73', '#5799C4', '#EDF3FA', '#166534'])
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='Hero', fontName='Helvetica-Bold', fontSize=28, leading=32, textColor=navy, spaceAfter=14))
styles.add(ParagraphStyle(name='Sub', fontName='Helvetica', fontSize=12, leading=18, textColor=navy, spaceAfter=12))
styles.add(ParagraphStyle(name='BodyQA', fontName='Helvetica', fontSize=10, leading=15, spaceAfter=9, textColor=colors.HexColor('#26374D')))
styles.add(ParagraphStyle(name='TinyQA', fontName='Helvetica', fontSize=7.5, leading=10, textColor=colors.HexColor('#465A72')))
styles.add(ParagraphStyle(name='CellQA', fontName='Helvetica', fontSize=7.5, leading=9.4))
styles.add(ParagraphStyle(name='HeadQA', fontName='Helvetica-Bold', fontSize=8, leading=10, textColor=colors.white))
styles.add(ParagraphStyle(name='KPI', fontName='Helvetica-Bold', fontSize=23, leading=27, alignment=TA_CENTER, textColor=navy))
styles.add(ParagraphStyle(name='KPILabel', fontSize=9, leading=12, alignment=TA_CENTER, textColor=navy))
styles['Heading2'].textColor = navy
styles['Heading2'].spaceBefore = 10
styles['Heading2'].spaceAfter = 9
def p(text, style='BodyQA'):
    return Paragraph(escape(str(text)).replace('\n', '<br/>'), styles[style])

# Validate PDF responses independently of the Postman signature assertions.
pdf_checks = []
for mode, expected in [('local', '1.200,00'), ('real', '150,00')]:
    sample = OUT / 'amostras' / f'{mode}-relatorio.pdf'
    reader = PdfReader(sample)
    text = '\n'.join(page.extract_text() or '' for page in reader.pages)
    passed = expected in text and 'Faturamento' in text
    pdf_checks.append({'mode': mode, 'artifact': sample.name, 'check': 'PDF contém faturamento esperado', 'expected': expected, 'passed': passed, 'pages': len(reader.pages)})
(OUT / 'validacao-texto-pdf.json').write_text(json.dumps(pdf_checks, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
if not all(c['passed'] for c in pdf_checks):
    raise RuntimeError('Um PDF exportado não contém o faturamento esperado; preserve a evidência e investigue.')

PDF.parent.mkdir(parents=True, exist_ok=True)
doc = SimpleDocTemplate(str(PDF), pagesize=A4, rightMargin=42, leftMargin=42, topMargin=48, bottomMargin=42, title='IntegraMEI - Evidências de testes Postman', author='IntegraMEI | Execução assistida por Codex')
story = [p('INTEGRAMEI  /  VALIDAÇÃO DE API', 'TinyQA'), Spacer(1,18), p('Evidências de testes\ncom Postman', 'Hero'), p('Resultados verificáveis em ambiente local e no Supabase real.', 'Sub')]
requests = sum(r['summary']['executedRequests']['executed'] for r in runs)
assertions = sum(r['summary']['tests']['passed'] for r in runs)
failures = sum(r['summary']['tests']['failed'] for r in runs)
kpis = Table([[p(requests,'KPI'),p(assertions,'KPI'),p(failures,'KPI')], [p('requisições HTTP','KPILabel'),p('verificações aprovadas','KPILabel'),p('falhas na rodada final','KPILabel')]], colWidths=[170]*3)
kpis.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),light),('TOPPADDING',(0,0),(-1,0),14),('BOTTOMPADDING',(0,-1),(-1,-1),14)]))
story += [kpis, Spacer(1,18), p('Resultado da rodada final', 'Heading2')]
data = [[p(v,'HeadQA') for v in ['Ambiente','Requisições','Verificações','Resultado']]]
for r in runs:
    data.append([p('Supabase real' if r['mode']=='real' else 'Local simulado','CellQA'), p(r['summary']['executedRequests']['executed'],'CellQA'), p(f"{r['summary']['tests']['passed']}/{r['summary']['tests']['executed']}",'CellQA'),p('APROVADO' if r['exitCode']==0 else 'FALHOU','CellQA')])
t=Table(data,colWidths=[190,95,105,120]);t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),navy),('BOTTOMPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),9),('LINEBELOW',(0,1),(-1,-1),.5,colors.HexColor('#DCE4EE'))]));story.append(t)
story += [Spacer(1,14),p('O que foi comprovado', 'Heading2'),p('Login no Auth, proteção de rotas, persistência de perfil e preferências, metas financeiras, cadastro e histórico de insumos, precificação, controle de versões e exportações em PDF, Excel e ZIP.'),p('No Supabase real, uma segunda conta não conseguiu consultar o insumo nem as configurações da primeira. A receita sintética de R$150 apareceu no dashboard e nas exportações. O gráfico de despesas retornou custo zero, conforme a pré-condição.'),p('Limpeza concluída','Heading2'),p('As contas e empresas sintéticas das duas rodadas reais foram removidas. A rodada final verificou ausência de insumos, preços, produtos, vendas, perfis, vínculos, preferências e contas Auth usados no teste.'),Spacer(1,8),p(f"Execução final em 07/11/2026. Postman CLI {summary['postmanVersion']} | Node {summary['node']}",'TinyQA'),p(f"Código testado: {summary['commit']} | branch {summary['branch']}",'TinyQA'),p('Coleções executadas pela CLI oficial do Postman, sem publicação dos resultados na nuvem. As evidências compartilháveis removem senhas e tokens.', 'TinyQA')]

for r in runs:
    story += [PageBreak(),p('Supabase real' if r['mode']=='real' else 'Ambiente local simulado','Hero'),p(r['environment'],'TinyQA'),p(f"Início: {r['startedAt']} | Fim: {r['finishedAt']} (UTC)",'TinyQA'),Spacer(1,10)]
    rows=[[p(v,'HeadQA') for v in ['Cenário','HTTP','ms','Estado']]]
    for e in r['executions']:
        rows.append([p(e['name'],'CellQA'),p(e['status'],'CellQA'),p(e['durationMs'],'CellQA'),p('PASSOU' if e['passed'] else 'FALHOU','CellQA')])
    table=Table(rows,colWidths=[365,37,48,60],repeatRows=1,hAlign='LEFT')
    table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),navy),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,light]),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),2),('BOTTOMPADDING',(0,0),(-1,-1),2)]))
    story += [table,Spacer(1,8),p('HTTP 4xx nos cenários de recusa é o resultado esperado. Os tempos são observações desta rodada, não um teste de desempenho. Detalhes de cada asserção e corpo de resposta estão no HTML e no JSON.', 'TinyQA')]

story += [PageBreak(),p('Método e limites', 'Hero'),p('Pré-condições e execução','Heading2'),p('O preparador criou duas contas exclusivas de teste, com e-mail previamente confirmado via Admin e sem envio de mensagem. O Postman obteve sessões normais pelo Supabase Auth. A chave administrativa não foi fornecida à coleção.'),p('Foi inserida uma venda sintética de R$150 na empresa A. A empresa B permaneceu vazia. As requisições autenticadas da API usam a chave pública e a sessão do usuário, exercitando as políticas de acesso reais do banco.'),p('Arquivos efetivamente exportados','Heading2'),p('Os seis arquivos em amostras/ são os bytes recebidos nas respostas da API: PDF, Excel e ZIP de cada ambiente. Além das 204 asserções Postman, houve 14 verificações complementares: abertura dos PDFs, conteúdo textual, valores e fórmulas em cache do Excel, soma das vendas e integridade/estrutura dos ZIPs.'),p('Histórico preservado','Heading2'),p('Duas tentativas locais iniciais não alcançaram a API devido a bloqueio de conexão. Na primeira rodada real, a asserção de evolução comparou o gráfico de despesas com receita (101/102 aprovações). A expectativa foi corrigida conforme o contrato existente e a coleção inteira foi repetida com contas novas. Nenhum arquivo da aplicação foi alterado.'),p('Fora do escopo','Heading2')]
for limit in summary['limits']:
    story.append(p('- ' + limit))
story += [p('Como revisar e repetir','Heading2'),p('Abra evidencias.html para navegar pelos cenários. Os arquivos *-resultados.json, *-junit.xml e *-postman.log permitem conferir as respostas, asserções e a execução. Use INSTRUCOES.md para importar as coleções no Postman e preparar novas contas de teste.'),p('SHA256SUMS.txt registra os hashes dos arquivos. São evidências geradas localmente a partir de uma execução da CLI; os hashes não representam certificação ou assinatura independente.','TinyQA')]

def page_chrome(canvas, document):
    canvas.saveState()
    width,height=A4
    canvas.setStrokeColor(blue);canvas.setLineWidth(2);canvas.line(42,height-30,width-42,height-30)
    canvas.setFont('Helvetica',8);canvas.setFillColor(navy)
    canvas.drawString(42,24,'IntegraMEI | Evidências Postman | Dados sintéticos')
    canvas.drawRightString(width-42,24,f'{document.page}')
    canvas.restoreState()
doc.build(story,onFirstPage=page_chrome,onLaterPages=page_chrome)
shutil.copy2(PDF, OUT / 'relatorio-evidencias.pdf')
shutil.copy2(Path(__file__).with_name('INSTRUCOES.md'), OUT / 'INSTRUCOES.md')
eligible=lambda path: path.is_file() and not path.name.endswith('-run-location.json') and path.name not in {'SHA256SUMS.txt','integramei-testes-postman.zip'}
files=sorted(p for p in OUT.rglob('*') if eligible(p))
manifest='\n'.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(OUT).as_posix()}' for p in files)+'\n'
(OUT/'SHA256SUMS.txt').write_text(manifest,encoding='utf-8')
with zipfile.ZipFile(OUT/'integramei-testes-postman.zip','w',zipfile.ZIP_DEFLATED) as archive:
    for path in files+[OUT/'SHA256SUMS.txt']:
        archive.write(path,path.relative_to(OUT))
print(json.dumps({'pdf':str(PDF),'pages':len(PdfReader(PDF).pages),'bundleFiles':len(files)+1,'pdfChecksPassed':len(pdf_checks)},ensure_ascii=False))
