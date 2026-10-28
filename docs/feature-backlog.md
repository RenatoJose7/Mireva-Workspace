# Mireva Workspace — Feature backlog

Este arquivo registra funcionalidades combinadas para implementação futura. Itens daqui ainda precisam de definição técnica e priorização antes de entrar em desenvolvimento.

## Próximas funcionalidades

### Sugestões de regras pelo orquestrador

Permitir que o orquestrador identifique decisões importantes durante a conversa e proponha inclusões ou alterações na memória do projeto.

- O orquestrador não altera a memória silenciosamente.
- Cada sugestão mostra o texto atual e a mudança proposta.
- O proprietário pode aprovar, editar ou recusar.
- Somente após aprovação a nova regra é salva e distribuída aos runners.
- Toda alteração gera um evento no histórico da sala.

### Agentes especializados por skills

Permitir que cada estação receba um perfil especializado composto por uma ou mais skills, além das capacidades genéricas atuais.

- Selecionar skills ao conectar ou editar uma IA.
- Exibir especialidade e skills no Office.
- O orquestrador considera skills, ferramenta, modelo e disponibilidade ao distribuir tarefas.
- Cada skill declara requisitos locais, tipos de entrada, entregáveis e limitações.
- Uma tarefa pode exigir uma ou várias skills.
- Perfis reutilizáveis podem combinar várias skills, como `Redator SEO`, `Editor de vídeo` ou `Frontend React`.

### Integração com Claude, Antigravity e modelos — concluída na 0.1.11

Claude Code e Antigravity foram adicionados como providers reais ao lado de Codex, Copilot e mock.

- Criar um adapter `antigravity` isolado em `packages/agent-adapters`.
- Permitir selecionar o modelo Gemini disponível ao conectar ou editar uma estação.
- Usar o provider tanto como orquestrador quanto como runner especializado.
- Detectar capacidades, contexto suportado e recursos multimodais de cada modelo.
- Exibir provider e modelo ativos nas páginas Escritório e Equipe.
- Capturar saída, erros, arquivos alterados, consumo e estado da execução no formato comum do Mireva.
- Manter o modelo desacoplado das skills: a mesma IA pode assumir pesquisa, roteiro, design ou outra especialidade configurada.
- Conexão oficial definida pelo CLI `agy`, com execução headless, diagnóstico de autenticação e descoberta por `agy models`.
- Claude usa o CLI `claude`, aceita aliases ou IDs completos de modelo e pode atuar como runner ou orquestrador.

## Skills iniciais sugeridas

- Desenvolvimento frontend e UI.
- Desenvolvimento backend e APIs.
- Testes, QA e acessibilidade.
- Revisão de código e arquitetura.
- Pesquisa com fontes e síntese.
- Copywriting e revisão editorial.
- SEO e estratégia de conteúdo.
- Design gráfico e geração/edição de imagens.
- Edição de vídeo e motion graphics.
- Áudio, narração e tratamento de som.
- Análise de dados e planilhas.
- Documentação, apresentações e relatórios.
- Automação e integrações entre serviços.

## Primeira equipe especializada — Produção de vídeo com IA

Esta será a primeira equipe implementada. O objetivo é transformar um briefing do usuário em um vídeo final, mantendo entregáveis claros entre as estações.

### 1. Pesquisador de vídeo

**Skill:** `VIDEO_RESEARCH`

- Pesquisa tema, público, referências, dados e concorrentes.
- Registra fontes e separa fatos confirmados de sugestões criativas.
- Entrega um dossiê de pesquisa, referências e recomendações para o roteiro.

### 2. Roteirista e copywriter

**Skill:** `VIDEO_SCRIPT`

- Transforma o briefing e a pesquisa em conceito, gancho, estrutura e roteiro.
- Adapta linguagem, duração, plataforma, público e chamada para ação.
- Entrega roteiro de narração, textos em tela, divisão por cenas e lista inicial de planos.

### 3. Diretor de arte e designer

**Skill:** `VISUAL_DESIGN`

- Define direção visual, paleta, tipografia, composição e ritmo gráfico.
- Cria storyboard, prompts e assets visuais necessários para cada cena.
- Entrega guia visual, storyboard e arquivos de imagem organizados por cena.

### 4. Produtor de áudio e narração

**Skill:** `AUDIO_NARRATION`

- Define voz, tom, ritmo e pronúncia da narração.
- Produz ou trata voz, música e efeitos sonoros.
- Entrega narração final, trilha, efeitos, transcrição e marcações de tempo.

### 5. Editor de vídeo

**Skill:** `VIDEO_EDITING`

- Recebe roteiro, storyboard, assets e áudio aprovados.
- Monta cenas, animações, transições, legendas e mixagem final.
- Valida duração, resolução, proporção, sincronismo e legibilidade.
- Entrega vídeo final, arquivo editável/composição e relatório de qualidade.

### Fluxo inicial

1. O usuário informa objetivo, público, plataforma, duração e formato.
2. Pesquisa produz o dossiê.
3. Copywriting produz o roteiro e a lista de cenas.
4. O usuário aprova ou pede ajustes no roteiro.
5. Design e áudio trabalham em paralelo a partir do roteiro aprovado.
6. Edição recebe todos os materiais e monta o vídeo.
7. O usuário revisa o vídeo final e aprova ou solicita correções.

### Aprovações humanas recomendadas

- Briefing inicial.
- Roteiro e estrutura de cenas.
- Vídeo final.

Direção visual e voz podem ter aprovação opcional quando o usuário quiser controle mais detalhado.
