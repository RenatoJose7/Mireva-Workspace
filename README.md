# Mireva Workspace

## Instalação com um comando

Com **Node.js 22+** e **Git** instalados, entre na pasta do projeto que os agentes deverão usar e execute este único comando:

```powershell
npx @renatojose7/mireva
```

Ele baixa o runtime em `~/.mireva/runtime`, instala as dependências, prepara `.mireva` dentro do projeto atual e abre o Office no navegador. Na tela inicial, escolha **Criar escritório** ou **Entrar em um escritório**; o Hub já vem configurado. Não é necessário instalar o `pnpm` globalmente: o lançador usa a versão correta de forma temporária.

Em outro computador, entre na pasta do mesmo projeto e execute o mesmo comando. Depois, abra o convite ou digite o código da sala e clique em **Conectar IA**. O botão inicia o runner nessa máquina.

Runners entram como agentes gerais; o orquestrador decide as tarefas compatíveis com as capacidades deles. A alternativa de terminal continua disponível dentro da tela de conexão para casos avançados.

O lançador guarda o estado de cada máquina em `.mireva/runner.json`. Para usar mais de um runner na mesma pasta, informe `--state .mireva/nome-do-runner.json`. Se quiser usar a versão ainda não publicada do repositório, substitua `npx @renatojose7/mireva` por `npx --yes github:RenatoJose7/Mireva-Workspace#main --`.

### Conexão visual, convites e memória

Abra o Office pelo lançador para iniciar também o **Mireva Agent local**:

```powershell
npx @renatojose7/mireva office
```

No botão **Conectar IA**, escolha o agente, a pasta do projeto e a permissão inicial. Em seguida, **Iniciar nesta máquina** cria o runner e o mantém ativo sem montar um comando manualmente. Marque **orquestrador inicial** apenas para a IA que criará os planos; todos os outros entram como runners gerais. O painel também gera um convite com link e QR Code para computadores na mesma rede; no outro computador, abra o convite e conecte a IA por essa mesma tela.

Antes de conectar, o Office verifica a pasta, a instalação da IA, o login disponível e a comunicação com o Hub. Os resultados aparecem na própria janela com a correção sugerida para cada item.

Ao selecionar uma estação no escritório, você pode conversar diretamente com aquele agente e alterar sua política entre **Somente leitura**, **Trabalhar no projeto**, **Projeto + internet** e **Acesso ampliado**. O perfil normal autoriza as ferramentas do Copilot dentro do fluxo não interativo, mas continua bloqueando publicação e comandos administrativos conhecidos. O perfil ampliado remove proteções do CLI e deve ser usado apenas em ambiente controlado.

No centro do Orquestrador existe a **Memória do projeto**. Use-a para registrar decisões, tecnologias, regras e objetivos. Ela é enviada ao orquestrador durante o planejamento e aos runners quando executam tarefas.

Ambiente colaborativo para coordenar agentes de IA que trabalham em clones independentes do mesmo projeto. Esta primeira versão implementa a fundação local: Hub persistente, salas, participantes, eventos ordenados, tarefas iniciais e Runner/CLI.

## Estado atual

- Hub remoto no Cloudflare com Durable Objects, salas por código e eventos ordenados.
- Presença com recuperação: runners inativos aparecem como desconectados, o supervisor local tenta reiniciá-los e tarefas interrompidas retornam à fila sem aceitar resultados de uma execução antiga.
- Tarefas com dependências, prioridade, tentativa, resultado e ciclo `READY → CLAIMED → RUNNING → REVIEW → DONE`.
- Runner automático: busca, reivindica e executa a próxima tarefa compatível.
- Adaptadores `mock`, `codex` e `copilot`. Os adaptadores Codex e GitHub Copilot chamam o CLI instalado no computador, encaminham os eventos para a sala e mantêm o runner ativo durante a execução.
- Office web inicial que mostra participantes, tarefas e eventos reais da sala.
- Central de erros persistente com diagnóstico técnico, tentativa novamente, exportação e liberação de permissão por tarefa ou estação.
- Caixa de decisões para aprovar planos e entregas, liberar retomadas e cancelar ou corrigir uma tarefa em execução.
- Controle Git explícito por estação: consultar alterações, criar branch `mireva/...` e criar commit local. O Mireva não faz `push` ou `merge` automaticamente.

## Erros, recuperação e permissões

O menu **Erros** reúne falhas de autenticação, rede, limite do provedor, ferramenta ausente, tempo excedido e bloqueios de permissão. Cada registro mostra uma explicação simples, a ação recomendada e os detalhes técnicos recolhidos. É possível copiar ou baixar o diagnóstico, tentar a tarefa novamente e, quando necessário, liberar um perfil mais amplo somente para aquela tarefa.

O launcher mantém a configuração dos runners em `~/.mireva/sessions.json` e os logs dentro de `.mireva` no projeto. Se um processo encerrar inesperadamente, ele tenta reiniciar até cinco vezes com intervalos progressivos. Depois que o computador reiniciar, abrir o Mireva novamente restaura as sessões salvas. O Hub devolve tarefas abandonadas à fila e usa uma identificação por execução para não aceitar uma entrega atrasada de outra tentativa.

Os estados visuais distinguem quando a IA está pensando, executando comandos, aguardando permissão ou login, sem internet, limitada pelo provedor, bloqueada ou desconectada. Publicação e comandos administrativos continuam bloqueados nos perfis normais.

## Decisões, intervenção e Git

Use o menu **Decisões** para centralizar o que precisa de uma ação humana: plano proposto, entrega em revisão, permissão pendente e tarefa em andamento. Em uma tarefa ativa, **Enviar correção** interrompe a execução atual e devolve a tarefa para a fila com sua instrução anexada. **Cancelar** encerra a tarefa, mas não apaga arquivos que a IA já tenha alterado.

No menu **Git**, cada runner de desenvolvimento pode receber três comandos explícitos: ver alterações, criar uma branch com prefixo `mireva/` e criar um commit local. A pausa da estação impede novas atribuições depois da tarefa atual. Push, merge e resolução automática de conflitos continuam fora do fluxo para manter a decisão humana.

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

O Codex trabalha no diretório em que o comando foi iniciado e usa a política escolhida no Office. O padrão permite alterações no projeto; o perfil de leitura mantém o sandbox sem escrita, e o acesso ampliado precisa ser selecionado explicitamente. Ao concluir, a tarefa vai para `REVIEW`; a decisão de marcar `DONE` permanece humana.

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

O Mireva chama `copilot -p` dentro do diretório em que o comando foi iniciado e traduz a política da estação para as opções de permissão do Copilot CLI. Isso evita prompts invisíveis no runner não interativo. Publicação e `sudo` permanecem negados no perfil normal; depois da entrega, a tarefa aparece em `REVIEW` para aprovação humana.

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
