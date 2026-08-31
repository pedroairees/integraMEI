# Banco de dados local - IntegraMEI

Este diretório entrega um PostgreSQL local para desenvolvimento. A migração usa SQL padrão compatível com PostgreSQL 16 e pode ser aplicada depois a um projeto PostgreSQL do Supabase.

O modelo cobre notas fiscais e extração por IA, fornecedores, categorias pessoal/profissional, insumos, histórico de preços, estoque, produtos, sugestões de preço, vendas, dashboard, alertas, tarefas de compra, exportações e períodos fechados.

## Subir localmente

Com o Docker Desktop em execução, na raiz do repositório:

    Copy-Item database/.env.example database/.env
    docker compose --env-file database/.env -f database/docker-compose.yml up -d

O PostgreSQL ficará disponível em localhost:54329 por padrão. Os dados de demonstração são carregados apenas na primeira criação do volume.

## Validar

    Get-Content database/tests/001_schema_test.sql | docker compose --env-file database/.env -f database/docker-compose.yml exec -T postgres psql -U integramei -d integramei -v ON_ERROR_STOP=1

Consultas para as informações que alimentam as telas:

    docker compose --env-file database/.env -f database/docker-compose.yml exec postgres psql -U integramei -d integramei -c "SELECT * FROM v_monthly_dashboard;"
    docker compose --env-file database/.env -f database/docker-compose.yml exec postgres psql -U integramei -d integramei -c "SELECT * FROM v_product_price_suggestions;"

## Regras implementadas

A função app.confirm_expense_document(id) é a única transição para confirmar uma nota. Ela exige CNPJ do emissor, fornecedor, data, valor total, categoria definida e pelo menos um item (RN-001). Ao confirmar, cria o histórico de preços e a entrada de estoque quando a unidade do item coincide com a unidade-base do insumo.

O gatilho de histórico compara a compra com a média dos 90 dias anteriores e cria alerta de alta acima do limite configurado do negócio, 10% por padrão (RN-003). Quedas de 5% ou mais também geram aviso de redução e oportunidade de compra. Alterações e exclusões de lançamentos em meses encerrados são bloqueadas (RN-006).

Na precificação, o banco usa markup: custo de produção x (1 + impostos) x (1 + markup). Essa convenção respeita o exemplo do requisito em que R$ 20,00 com 100% resulta em R$ 40,00. A interface deve usar o termo markup, pois margem percentual representa outro cálculo.

## Produção com Supabase

Este Compose é somente para desenvolvimento local. Para produção, aplique primeiro a migração em um projeto Supabase, configure Auth, Storage privado para imagens de notas e políticas RLS antes de conectar o frontend. A chave service_role nunca deve ser exposta no navegador.
