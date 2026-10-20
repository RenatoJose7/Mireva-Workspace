# Mireva Workspace

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
copilot auth login
pnpm cli doctor -- --hub https://mireva-hub.renatojosesfc.workers.dev --adapter copilot
```

Entre na sala e inicie o trabalhador. O primeiro comando processa uma tarefa; o segundo acompanha a fila continuamente:

```powershell
pnpm cli join 2B7E325E -- --hub https://mireva-hub.renatojosesfc.workers.dev --name "Copilot do Renato" --agent copilot --capabilities CODE,RESEARCH,TEST,GIT --state .mireva\runner-copilot.json
pnpm cli work -- --state .mireva\runner-copilot.json --adapter copilot --once
pnpm cli work -- --state .mireva\runner-copilot.json --adapter copilot
```

O Mireva chama `copilot -p` dentro do diretório em que o comando foi iniciado. O Copilot continua respeitando as confirmações e permissões configuradas no próprio CLI; depois da entrega, a tarefa aparece em `REVIEW` para aprovação humana.

## Conversar com o orquestrador

O painel **Orquestrador** do Office envia pedidos para a sala. Para que eles virem tarefas, deixe um runner exclusivo de planejamento com o Copilot CLI conectado. Ele lê o pedido, considera os agentes e capacidades presentes na sala e cria um **plano em rascunho**. Nenhuma tarefa é executada antes de você aprovar o plano no Office.

Antes do primeiro uso, atualize o repositório e publique a versão nova do Hub para que ele aceite planos:

```powershell
git pull
pnpm install
pnpm hub:deploy
```

```powershell
pnpm cli join 2B7E325E -- --hub https://mireva-hub.renatojosesfc.workers.dev --name "Orquestrador Copilot" --agent copilot --capabilities ORCHESTRATE --state .mireva\orchestrator.json
pnpm cli orchestrate -- --state .mireva\orchestrator.json --adapter copilot
```

Depois, escreva o objetivo no Office. O processo `orchestrate` responde com o plano, o Office mostra as tarefas e suas dependências, você aprova e clica em **Distribuir tarefas prontas**. Os runners de Codex/Copilot então executam apenas as tarefas compatíveis com as suas capacidades.

## Distribuição por capacidade

Cada runner pode declarar capacidades ao entrar na sala. Ao criar uma tarefa, informe as capacidades necessárias e, no Office, use o botão **Distribuir tarefas prontas** do orquestrador. Ele atribui cada tarefa ao agente disponível que atende aos requisitos e tem menos trabalho ativo.

```powershell
pnpm cli task-create -- --state .mireva\runner-a.json --title "Implementar checkout" --capabilities CODE,TEST
pnpm cli join 2B7E325E -- --hub https://mireva-hub.renatojosesfc.workers.dev --name "Pesquisador" --agent gemini --capabilities RESEARCH --state .mireva\runner-research.json
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
