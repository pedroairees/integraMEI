# Testes de API IntegraMEI com Postman

As coleções têm 43 requisições cada e devem ser executadas **em ordem**, com uma iteração. Há verificações de sucesso, validação de entrada, persistência, concorrência por versão e isolamento entre empresas. Respostas 400, 401, 403, 404, 409 e 422 são resultados esperados nos cenários de recusa.

## Evidências desta execução

Abra `output/testes-postman/evidencias.html` para navegar pelas respostas e verificações. O relatório em PDF fica em `output/pdf/integramei-evidencias-postman.pdf`.

- `local-resultados.json` e `real-resultados.json`: resultados normalizados da Postman CLI, com respostas, tempos, verificações e hashes dos relatórios originais.
- `*-junit.xml` e `*-postman.log`: relatórios gerados pela CLI, com credenciais removidas.
- `amostras/`: PDF, XLSX e ZIP efetivamente retornados pela API durante a rodada final.
- `validacao-arquivos.json`: abertura dos arquivos, estrutura do ZIP e valores do Excel.
- `real-preconditions.json` e `real-cleanup.json`: preparação e remoção dos dados sintéticos.
- `historico/`: tentativas iniciais, incluindo falhas de conectividade e a correção de uma expectativa da coleção. Não foram omitidas para apresentar apenas uma execução favorável.
- `SHA256SUMS.txt`: integridade dos arquivos compartilhados. Não equivale a assinatura digital independente.

O ambiente local executa o backend da aplicação com serviços externos simulados. O ambiente real usa o mesmo backend com o Supabase Auth/PostgreSQL configurado no projeto. A coleção não testa navegador, login por CNPJ, cadastro com confirmação por e-mail, qualidade de OCR, envio real de e-mail nem o ciclo completo de uma nota fiscal. A venda sintética de R$150 é preparada diretamente como pré-condição; não representa teste do upload de nota. O gráfico `evolution` representa despesas.

## Importar no Postman

1. Abra o Postman e use **Import**.
2. Importe `local.postman_collection.json` ou `real.postman_collection.json` desta pasta.
3. Importe o ambiente correspondente. Os arquivos `*.example.json` são modelos sem credenciais. Para a execução preparada pelos comandos abaixo, use o arquivo privado em `tmp/postman-private/`. Não sincronize/exporte esse ambiente com senhas preenchidas.
4. Selecione o ambiente, abra a coleção e clique em **Run**. Mantenha a ordem, uma iteração e todas as requisições selecionadas.
5. Consulte os resultados na aba de testes. Use a CLI abaixo para gerar os relatórios JSON/JUnit/log automaticamente.

**Use exclusivamente contas de teste.** A coleção modifica nome, telefone, preferências, meta e cadastra insumos, compras e produtos. O teste real verifica duas empresas e nunca deve apontar para uma conta pessoal. Nunca coloque `SUPABASE_SECRET_KEY` na coleção ou no ambiente Postman. A chave de servidor é usada somente pelo preparador local.

## Preparação (na raiz do repositório)

Requer Node 24 e as dependências já instaladas do backend/frontend. A CLI é instalada em `tmp/`, sem modificar os pacotes da aplicação.

```powershell
npm install --prefix tmp/postman-runtime --no-save --package-lock=false postman-cli@1.86.0
node backend/tests/postman/build-collections.mjs
```

Esse comando recria IDs e ambientes. Prepare uma rodada nova; não execute a mesma coleção duas vezes sobre as mesmas fixtures, pois há verificações de dados iniciais e criação.

### Ambiente local isolado

Em um terminal:

```powershell
cd frontend
node e2e/serve.mjs
```

Em outro terminal, na raiz:

```powershell
node backend/tests/postman/run.mjs local
```

Portas: API 3337, Auth simulado 39401 e frontend de apoio 3107. Interrompa o servidor com Ctrl+C para limpar o estado em memória. Recomece com um processo novo para repetir.

### Supabase real

As variáveis Supabase devem estar em `backend/.env` ou `frontend/.env.local`. O preparador lê as chaves sem imprimi-las e cria duas contas identificadas por UUID, sem enviar e-mails. O banco deve ter as migrações do projeto aplicadas. Este fluxo não aplica migrações nem altera o schema.

```powershell
node backend/tests/postman/real-fixtures.mjs setup
node backend/tests/postman/serve-real.mjs
```

Em outro terminal, na raiz:

```powershell
node backend/tests/postman/run.mjs real
node backend/tests/postman/real-fixtures.mjs cleanup
```

Execute `cleanup` mesmo se os testes falharem. Ele usa exclusivamente os IDs criados e registrados em `tmp/postman-private/fixtures.json`, confere nome da empresa/identidade e verifica a remoção. Não remova o manifesto antes da limpeza. Se houver falha, preserve-o para concluir a limpeza; não apague tabelas inteiras. As duas contas ficam indisponíveis após a limpeza; prepare novas para repetir os testes.

A API real de teste fica na porta 3338. O backend normal do projeto não é substituído. Encerre esse servidor com Ctrl+C ao terminar.

## Gerar evidências e relatório

Após as duas execuções e a limpeza:

```powershell
node backend/tests/postman/evidence.mjs
python backend/tests/postman/report.py
```

O Python precisa de `reportlab` e `pypdf`. O script produz o PDF, o pacote ZIP e hashes. Os relatórios brutos da CLI permanecem em `tmp/postman-private/` (ignorado pelo Git); podem conter credenciais. Compartilhe apenas a pasta de evidências e o pacote final, que removem senhas, tokens e cabeçalhos de autenticação. Não envie o diretório `tmp/`.

`run.mjs` usa a CLI oficial com coleção local e `--no-report-events`, sem login no Postman Cloud. O código de saída é preservado. Os números do PDF vêm dos arquivos gerados pela CLI, não de uma simulação de resultados.

Documentação oficial: https://learning.postman.com/docs/postman-cli/postman-cli-collections/
