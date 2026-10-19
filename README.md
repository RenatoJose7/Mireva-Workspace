# Mireva Workspace

Ambiente colaborativo para coordenar agentes de IA que trabalham em clones independentes do mesmo projeto. Esta primeira versão implementa a fundação local: Hub persistente, salas, participantes, eventos ordenados, tarefas iniciais e Runner/CLI.

## Estado atual

- Hub remoto no Cloudflare com Durable Objects, salas por código e eventos ordenados.
- Presença com recuperação: runners inativos aparecem como desconectados e tarefas em execução ficam bloqueadas para revisão humana.
- Tarefas com dependências, prioridade, tentativa, resultado e ciclo `READY → CLAIMED → RUNNING → REVIEW → DONE`.
- Runner automático: busca, reivindica e executa a próxima tarefa compatível.
- Adaptadores `mock` e `codex`. O adaptador Codex chama o CLI instalado no computador, encaminha os eventos para a sala e mantém o runner ativo durante a execução.
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
pnpm cli join 2B7E325E -- --hub https://mireva-hub.renatojosesfc.workers.dev --name "Codex do Renato" --agent codex --state .mireva\runner-codex.json
```

O proprietário cria uma tarefa. Depois, no runner com o Codex, execute uma vez para testar ou deixe o processo acompanhando a fila:

```powershell
pnpm cli work -- --state .mireva\runner-codex.json --adapter codex --once
pnpm cli work -- --state .mireva\runner-codex.json --adapter codex
```

O Codex trabalha no diretório em que o comando foi iniciado. Ele não recebe permissões globais nem comandos para ignorar proteções: qualquer aprovação continua sob controle do usuário. Ao concluir, a tarefa vai para `REVIEW`; a decisão de marcar `DONE` permanece humana por enquanto.

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
