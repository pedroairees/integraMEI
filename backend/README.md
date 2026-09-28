# IntegraMEI — backend

Primeira entrega: API REST do dashboard (US004), organizada conforme as camadas do documento de arquitetura. A documentação original em `docs/` não foi alterada.

## Organização

- `src/web`: rotas, validação, respostas HTTP e OpenAPI.
- `src/core/dashboard`: regras financeiras e contratos de repositório, sem dependência de HTTP ou Supabase.
- `src/infra/supabase`: autenticação e persistência com o token do usuário, nunca com chave administrativa nas consultas financeiras.
- `tests`: testes de regras e da API, sem acesso ao banco remoto.
- `../frontend`: interface e adaptador de transporte `/api/backend/*`, que mantém o token fora do JavaScript do navegador.
- `../supabase/migrations`: SQL para o Supabase existente em português. O schema inglês em `database/migrations/001_initial_schema.sql` é outro ambiente; não aplicá-lo sobre o atual.

## Preparar o Supabase

No SQL Editor, execute `supabase/migrations/20260926120000_dashboard_read_access.sql`, a partir da raiz do repositório. Ela depende da migração de autenticação já existente. Adiciona a meta de margem opcional, habilita RLS financeiro por empresa e faz as views respeitarem RLS. Não apaga dados. Deve ser aplicada antes de usar o dashboard com dados reais. Não cria permissões de escrita para módulos financeiros ainda não implementados.

## Executar (Node.js 24 ou superior)

Em um terminal na pasta `backend`:

```sh
npm install
npm run dev
```

Em outro terminal na pasta `frontend`:

```sh
npm run dev
```

API local: `http://127.0.0.1:3333`. OpenAPI/Swagger em desenvolvimento: `http://127.0.0.1:3333/docs`. Frontend padrão: `http://localhost:3000`.

Para configuração independente, copie `.env.example` para `.env` e configure `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`. Em desenvolvimento, se não estiverem configurados, o backend reutiliza as variáveis públicas de `frontend/.env.local`. Nenhuma credencial é copiada ou versionada. O novo backend não precisa da secret key.

O frontend usa `BACKEND_URL=http://127.0.0.1:3333` por padrão apenas em desenvolvimento. Em produção, defina `BACKEND_URL` no ambiente do Next, configure as variáveis próprias do backend e use HTTPS no proxy de entrada. Use `HOST=0.0.0.0` somente em ambientes/container com acesso de rede devidamente controlado. `npm run build` compila; `npm start` executa o resultado.

## Endpoints

Todas as rotas `/v1` exigem Bearer token verificado no Supabase e empresa vinculada. A empresa é obtida pelo usuário autenticado, nunca por parâmetros fornecidos pelo navegador.

- `GET /health`: processo ativo, não é teste de conectividade do banco.
- `GET /v1/dashboard?month=2026-09&months=6&scope=professional`: indicadores, evolução, distribuição e alertas reais. `months`: 3, 6, 12. `scope`: professional, personal, all. Mês não pode ser futuro.
- `PATCH /v1/dashboard/goal`: `{ "value": 8000, "marginTarget": 30 }`, apenas proprietário. `value=0` desativa meta de receita, `marginTarget=null` remove meta de margem; omitir margem preserva seu valor atual.
- `GET /v1/supplies/:id/history`: mesmos filtros de período; preços unitários, unidade e fornecedor. O insumo precisa pertencer à empresa autenticada.

Não envie a secret key como token da API. A documentação completa dos contratos é gerada pelos schemas das rotas; disponível apenas em desenvolvimento.

## Regras da primeira entrega

- Receita vem de `vendas`. Custos e retiradas vêm de `notas_fiscais` confirmadas. Notas pendentes e falhas ficam fora dos indicadores.
- Lucro = receita − custos profissionais. Retiradas pessoais nunca reduzem a margem operacional (RN-005), mesmo ao alterar a visão do gráfico.
- A evolução apresenta meses consecutivos até o mês selecionado. Comparação considera o mês calendário anterior; base anterior zero retorna “sem base”, não uma porcentagem inventada.
- Totais monetários são somados em centavos. Margem sem receita e meta não configurada retornam `null`.
- Interpretação conservadora de US004/6: projeção é liberada com 15 datas distintas com vendas no mês; 15 vendas em um único dia não bastam. A média usa os dias decorridos no mês e calendário de São Paulo. Para mês encerrado, projeção equivale à receita efetiva.
- Distribuição permite selecionar categoria e consultar os cinco insumos de maior impacto. Histórico preserva a unidade; não calcula médias misturando kg, litros etc.
- Nenhum dado demonstrativo é inserido no Supabase ao iniciar a aplicação.
- Leituras são paginadas para evitar totais truncados pelo limite padrão do Supabase. Não há cache compartilhado entre usuários.

## Validar

```sh
npm run typecheck
npm test
npm run build
```

Na pasta `frontend`: `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run test:e2e`. Os testes de navegador sobem a API real contra um provedor Supabase simulado localmente; não validam políticas RLS do banco remoto. Para homologação, após aplicar o SQL, testar dois usuários de empresas diferentes e confirmar que um não acessa os dados do outro pela Data API.

## Limites desta etapa

Os fluxos existentes de login, cadastro e definição de senha foram preservados. Sua extração para a API independente será uma etapa específica, para não regredir convites e cookies de sessão.

Ainda não estão entregues: captura/OCR com Gemini (US001), CRUD financeiro completo e fluxo de revisão (US003), geração de alertas preditivos (US005/US007), precificação (US006), relatórios (US008), PWA offline, auditoria de criptografia/infraestrutura e testes de carga. Os menus dessas páginas continuam explicitamente indisponíveis; não simulam operações bem-sucedidas. O histórico consultado a partir do dashboard é uma primeira parte de US002.

A nova API não altera lançamentos financeiros; RN-006 permanece sob responsabilidade dos gatilhos existentes. O documento V6 fala em 30 dias de fechamento, enquanto a migração local bloqueia qualquer mês fechado: resolver essa diferença antes de implementar alterações/exclusões financeiras. A documentação exige IA, mas ela não é substituída por estimativas fixas nesta entrega.
