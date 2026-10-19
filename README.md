# Mireva Workspace

Ambiente colaborativo para coordenar agentes de IA que trabalham em clones independentes do mesmo projeto. Esta primeira versão implementa a fundação local: Hub persistente, salas, participantes, eventos ordenados, tarefas iniciais e Runner/CLI.

## Estado atual

- Hub local HTTP com persistência JSON e recuperação após reinício.
- Salas privadas com código de convite e até cinco Runners mais o proprietário.
- Eventos ordenados por sala, presença e tarefa inicial com dependências.
- Runner independente que publica e busca eventos de forma resiliente.
- CLI funcional: `init`, `login`, `create`, `join`, `start`, `status`, `agents`, `doctor` e `leave`.

Cloudflare Durable Objects, autenticação remota, WebSockets, adaptadores reais de IA, Office web e Git worktrees pertencem às próximas fases. O adaptador `mock` existe apenas para desenvolvimento e testes.

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
