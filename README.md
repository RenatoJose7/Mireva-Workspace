# Mireva Workspace

## Instalação com um comando

Com **Node.js 22+** e **Git** instalados, entre na pasta do projeto que os agentes deverão usar e execute este único comando:

```powershell
npx --yes github:RenatoJose7/Mireva-Workspace#main -- setup --office
```

Ele baixa o runtime em `~/.mireva/runtime`, instala as dependências, prepara `.mireva` dentro do projeto atual e abre o Office no navegador. Não é necessário instalar o `pnpm` globalmente: o lançador usa a versão correta de forma temporária.

Em outro computador, execute o mesmo comando sem `--office` e conecte o runner à sala:

```powershell
npx --yes github:RenatoJose7/Mireva-Workspace#main -- connect 2B7E325E --name "Copilot Frontend" --agent copilot --role DEVELOPMENT --capabilities CODE,GIT
```

No Office, o botão **Conectar IA** gera esse comando automaticamente depois que você escolhe o nome e a IA. Runners entram como agentes gerais; o orquestrador decide as tarefas compatíveis com as capacidades deles. Cole-o no terminal aberto dentro da pasta do projeto, no computador que será o runner.

O lançador guarda o estado de cada máquina em `.mireva/runner.json`. Para usar mais de um runner na mesma pasta, informe `--state .mireva/nome-do-runner.json`. Quando o pacote for publicado no npm, a mesma experiência passará a usar `npx @renatojose7/mireva` em vez do endereço do GitHub.

### Conexão visual, convites e memória

Abra o Office pelo lançador para iniciar também o **Mireva Agent local**:

```powershell
npx --yes github:RenatoJose7/Mireva-Workspace#main -- office
```

No botão **Conectar IA**, escolha o agente e a pasta do projeto. Em seguida, **Iniciar nesta máquina** cria o runner e o mantém ativo sem montar um comando manualmente. Marque **orquestrador inicial** apenas para a IA que criará os planos; todos os outros entram como runners gerais. O painel também gera um convite com link e QR Code para computadores na mesma rede; no outro computador, abra o convite e conecte a IA por essa mesma tela.

No centro do Orquestrador existe a **Memória do projeto**. Use-a para registrar decisões, tecnologias, regras e objetivos. Ela é enviada ao orquestrador durante o planejamento e aos runners quando executam tarefas.

Ambiente colaborativo para coordenar agentes de IA que trabalham em clones independentes do mesmo projeto. Esta primeira versão implementa a fundação local: Hub persistente, salas, participantes, eventos ordenados, tarefas iniciais e Runner/CLI.

## Estado atual

- Hub remoto no Cloudflare com Durable Objects, salas por código e eventos ordenados.
- Presença com recuperação: runners inativos aparecem como desconectados e tarefas em execução ficam bloqueadas para revisão humana.
- Tarefas com dependências, prioridade, tentativa, resultado e ciclo `READY → CLAIMED → RUNNING → REVIEW → DONE`.
- Runner automático: busca, reivindica e executa a próxima tarefa compatível.
- Adaptadores `mock`, `codex` e `copilot`. Os adaptadores Codex e GitHub Copilot chamam o CLI instalado no computador, encaminham os eventos para a sala e mantêm o runner ativo durante a execução.
- Office web inicial que mostra participantes, tarefas e eventos reais da sala.

## Hub público com Cloudflare

Depois de entrar na sua conta Cloudflare, publique o Hub com:

```powershell
npx wrangler login
pnpm hub:deploy
```

O Worker usa Durable Objects com SQLite e retorna uma URL `workers.dev`. Use-a em `--hub` ao criar a sala e conectar os Runners. No painel Cloudflare, configure o projeto Git com **build command** `pnpm install --frozen-lockfile` e **deploy command** `pnpm hub:deploy`.

## Requisitos

Node.js 22+ e pnpm 10+. Os comandos abaixo funcionam no PowerShell e no terminal integrado do VS Code no Windows.

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm test
```

Para publicar o Hub no Cloudflare, o pnpm pode pedir aprovação do build do `workerd`. Quando aparecer esse aviso, execute `pnpm approve-builds`, selecione `workerd`, e depois rode `pnpm hub:deploy` novamente.

## Executar uma tarefa com o Codex

Em um computador que tenha o Codex CLI autenticado, atualize o projeto e confirme a instalação:

```powershell
git pull
pnpm install
codex login
pnpm cli doctor -- --hub https://mireva-hub.renatojosesfc.workers.dev --adapter codex
```

Entre na sala usando `codex` como agente (ou reutilize um estado de runner já conectado):

```powershell
pnpm cli join 2B7E325E -- --hub https://mireva-hub.renatojosesfc.workers.dev --name "Codex do Renato" --agent codex --capabilities CODE,RESEARCH,TEST,GIT --state .mireva\runner-codex.json
```

O proprietário cria uma tarefa. Depois, no runner com o Codex, execute uma vez para testar ou deixe o processo acompanhando a fila:

```powershell
pnpm cli work -- --state .mireva\runner-codex.json --adapter codex --once
pnpm cli work -- --state .mireva\runner-codex.json --adapter codex
```

O Codex trabalha no diretório em que o comando foi iniciado. Ele não recebe permissões globais nem comandos para ignorar proteções: qualquer aprovação continua sob controle do usuário. Ao concluir, a tarefa vai para `REVIEW`; a decisão de marcar `DONE` permanece humana por enquanto.

## Executar uma tarefa com o GitHub Copilot

Instale e autentique o **GitHub Copilot CLI** no computador que será o runner. A extensão do VS Code não é suficiente para o runner automático.

```powershell
copilot
pnpm cli doctor -- --hub https://mireva-hub.renatojosesfc.workers.dev --adapter copilot
```

No primeiro comando, conclua o login interativo do Copilot e saia dele antes de executar o `doctor`. As versões atuais do Copilot CLI não usam mais `copilot auth login`.

Entre na sala e inicie o trabalhador. O primeiro comando processa uma tarefa; o segundo acompanha a fila continuamente:

```powershell
pnpm cli join 2B7E325E -- --hub https://mireva-hub.renatojosesfc.workers.dev --name "Copilot do Renato" --agent copilot --capabilities CODE,RESEARCH,TEST,GIT --state .mireva\runner-copilot.json
pnpm cli work -- --state .mireva\runner-copilot.json --adapter copilot --once
pnpm cli work -- --state .mireva\runner-copilot.json --adapter copilot
```

O Mireva chama `copilot -p` dentro do diretório em que o comando foi iniciado. O Copilot continua respeitando as confirmações e permissões configuradas no próprio CLI; depois da entrega, a tarefa aparece em `REVIEW` para aprovação humana.

## Conversar com o orquestrador

O painel **Orquestrador** do Office envia pedidos para a sala. Para que eles virem tarefas, deixe um runner exclusivo de planejamento com o Codex CLI ou GitHub Copilot CLI conectado. Ele lê o pedido, considera os agentes e capacidades presentes na sala e cria um **plano em rascunho**. Nenhuma tarefa é executada antes de você aprovar o plano no Office.

Antes do primeiro uso, atualize o repositório e publique a versão nova do Hub para que ele aceite planos:

```powershell
git pull
pnpm install
pnpm hub:deploy
```

```powershell
pnpm cli join 2B7E325E -- --hub https://mireva-hub.renatojosesfc.workers.dev --name "Orquestrador Codex" --agent codex --capabilities ORCHESTRATE --state .mireva\orchestrator.json
pnpm cli orchestrate -- --state .mireva\orchestrator.json --adapter codex
```

Use `--adapter copilot` se preferir o Copilot como planejador. Depois, escreva o objetivo no Office. O processo `orchestrate` responde com o plano, o Office mostra as tarefas e suas dependências, você aprova e clica em **Distribuir tarefas prontas**. Os runners de Codex/Copilot então executam apenas as tarefas compatíveis com as suas capacidades.

## Trabalhar em outro projeto

O Mireva não cria uma pasta de site por conta própria: você escolhe a pasta do projeto que os agentes devem ler e alterar. Mantenha o Mireva aberto na sua própria pasta e informe o destino com `--project-dir`. Assim, o arquivo de estado continua em `.mireva`, mas o Codex lê o projeto escolhido e o Copilot altera somente esse projeto.

```bash
mkdir -p ~/Projetos/meu-site

# Na pasta Mireva-Workspace
pnpm cli orchestrate -- --state .mireva/orchestrator-codex.json --adapter codex --project-dir ~/Projetos/meu-site
pnpm cli work -- --state .mireva/runner-copilot.json --adapter copilot --project-dir ~/Projetos/meu-site
```

O próximo formato de distribuição será um pacote NPM para chamar esses comandos sem clonar o repositório do Mireva. Por enquanto, `--project-dir` permite usar o fluxo em qualquer projeto local.

## Distribuição por capacidade

Cada runner pode declarar capacidades ao entrar na sala. Ao criar uma tarefa, informe as capacidades necessárias e, no Office, use o botão **Distribuir tarefas prontas** do orquestrador. Ele atribui cada tarefa ao agente disponível que atende aos requisitos e tem menos trabalho ativo.

```powershell
pnpm cli task-create -- --state .mireva\runner-a.json --title "Implementar checkout" --capabilities CODE,TEST
pnpm cli join 2B7E325E -- --hub https://mireva-hub.renatojosesfc.workers.dev --name "Pesquisador" --agent gemini --capabilities RESEARCH --state .mireva\runner-research.json
```

## Acompanhamento de limites

O Office mostra quando cada runner foi visto pela última vez, sua tarefa atual e um indicador de limite. Como Codex, Copilot e outros provedores não oferecem um formato único de saldo pelo terminal, esse indicador é **informado manualmente**: ele não consulta nem estima créditos por conta própria.

Você pode preencher os campos **Limite do provedor** no painel da estação ou reportar pelo terminal do próprio runner:

```powershell
pnpm cli limit-report -- --state .mireva\runner-copilot.json --used 72 --limit 100 --unit "mensagens" --reset-at "2026-11-01T00:00:00.000Z"
```

O Office destaca em amarelo a partir de 70% e em vermelho a partir de 90%. Depois de atualizar o projeto, publique o Hub uma vez para disponibilizar esse acompanhamento remoto:

```powershell
git pull
pnpm install
pnpm hub:deploy
```

## Demonstração com dois Runners

No primeiro terminal:

```powershell
pnpm hub -- --port 8787 --data .mireva/hub.json
```

No segundo terminal, crie a sala e guarde o `code` retornado:

```powershell
pnpm cli create -- --hub http://127.0.0.1:8787 --name "Projeto Mireva" --owner Renato
```

Em dois diretórios separados (para não compartilhar o arquivo de estado), entre na sala:

```powershell
pnpm --dir C:\caminho\Mireva-Workspace cli join CODIGO -- --hub http://127.0.0.1:8787 --name "Runner A" --agent mock --state .mireva\runner-a.json
pnpm --dir C:\caminho\Mireva-Workspace cli join CODIGO -- --hub http://127.0.0.1:8787 --name "Runner B" --agent mock --state .mireva\runner-b.json
```

Execute `mireva start` para cada estado. Use `status` ou `agents` com o mesmo `--state` para conferir o estado da sala.

## Estrutura

```
apps/hub             Hub local; futuro adaptador Cloudflare
packages/protocol    contratos Zod/TypeScript compartilhados
packages/runner      cliente autônomo do Hub
packages/cli         comandos de projeto e Runner
docs                 decisões e arquitetura
```
