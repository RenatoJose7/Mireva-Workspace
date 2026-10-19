# Execução no Windows

Instale Node.js LTS e habilite o pnpm com `corepack enable`. Abra o projeto no PowerShell e execute `pnpm install --frozen-lockfile` seguido de `pnpm test`.

Para desenvolvimento, inicie o Hub com `pnpm hub -- --port 8787`. O arquivo de dados padrão é `.mireva/hub.json`; ele pode ser apagado apenas quando não houver salas que você queira preservar.

Use caminhos distintos em `--state` para cada Runner. Não execute comandos destrutivos de Git, force push ou operações fora do diretório do projeto a partir do Runner.
