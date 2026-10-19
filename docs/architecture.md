# Arquitetura da Fase 1

O Hub local é a fonte de verdade. Ele mantém cada sala em um arquivo JSON local, atribui um número monotônico aos eventos e expõe HTTP para criação de salas, presença, eventos e tarefas. A persistência grava um arquivo temporário e o renomeia somente após a gravação terminar.

O Runner não executa um agente real nesta fase. Ele é um processo independente com identidade própria: envia presença e eventos, mantém a sequência mais recente recebida e consulta apenas os eventos posteriores a ela. Isso permite reconexão sem repetir o histórico já processado.

Os contratos vivem em `@mireva/protocol`. O futuro Hub Cloudflare deverá manter os mesmos contratos e substituir somente a implementação de armazenamento/transporte por Durable Object e WebSocket hibernável.

Limitações atuais: o Hub local aceita conexões apenas em `127.0.0.1`, não há autenticação, os eventos são recebidos por polling HTTP e não existe execução de IA. Esses limites são deliberados para validar o núcleo antes de expor uma sala na internet.
