# Multica Telegram Bridge

Bridge externo entre **Telegram** e **Multica**, permitindo que usuários autorizados interajam com **agentes**, **squads** e **issues** do Multica diretamente pelo Telegram — sem alterar o core do Multica.

O bridge consome as **APIs REST** do Multica para ações síncronas (criar issue, listar, comentar, chat com agentes) e mantém uma conexão **WebSocket** para receber atualizações em tempo real (mudanças de status, comentários, mensagens de agentes e conclusão/falha de tarefas).

---

## Índice

- [Visão geral](#visão-geral)
- [Arquitetura](#arquitetura)
- [Funcionalidades](#funcionalidades)
- [Stack técnica](#stack-técnica)
- [Pré-requisitos](#pré-requisitos)
- [Instalação e execução](#instalação-e-execução)
  - [Local (desenvolvimento)](#local-desenvolvimento)
  - [Docker](#docker)
  - [Docker Compose](#docker-compose)
- [Configuração (.env)](#configuração-env)
- [Comandos do Telegram](#comandos-do-telegram)
- [Segurança](#segurança)
- [Observabilidade](#observabilidade)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Desenvolvimento](#desenvolvimento)
- [Validação no ambiente real](#validação-no-ambiente-real)
- [Roadmap por fases](#roadmap-por-fases)
- [Solução de problemas](#solução-de-problemas)
- [Licença](#licença)

---

## Visão geral

| Item | Descrição |
|------|-----------|
| **Objetivo** | Operar agentes, squads e issues do Multica pelo Telegram |
| **Modelo** | Serviço externo independente (não acopla ao core do Multica) |
| **Comunicação** | REST (ações) + WebSocket (eventos em tempo real) |
| **Autorização** | Allowlist de `telegram_user_id` no `.env` |
| **Deploy** | Docker / Docker Compose |

---

## Arquitetura

```text
Telegram App / Grupo / Chat privado
        |
        | Webhook ou Polling
        v
Multica Telegram Bridge  ──REST──►  Multica Backend
        ▲                               |
        └──────────WebSocket────────────┘
        |
        | Mensagens / Notificações
        v
Usuário autorizado
```

Internamente o bridge é dividido em camadas bem definidas:

- **Telegram Adapter** — recebe mensagens, valida autorização, interpreta comandos e formata respostas.
- **Multica REST Client** — monta headers padrão, chama as APIs e trata erros HTTP.
- **Multica WebSocket Client** — conecta no `/ws`, reconecta automaticamente e filtra eventos.
- **Mention Resolver** — resolve `@nome` para `{ type: agent | squad, id }` com cache de aliases.
- **Serviços de domínio** — Issue, Agent, Squad, Chat e Notification Service.
- **Storage** — cache em memória com TTL e idempotência de eventos (substituível por Postgres/Redis).

---

## Funcionalidades

- ✅ Autorização por `telegram_user_id` (e opcionalmente por chat/grupo).
- ✅ Listagem de **agentes** e **squads** com menções `@` utilizáveis.
- ✅ Resolução de menções `@agente` / `@squad` com tratamento de **não encontrada** e **ambígua**.
- ✅ Criação de **issues** atribuídas a agente ou squad.
- ✅ Listagem de issues por **status** (com aliases amigáveis em português).
- ✅ Detalhe e **comentário** em issues.
- ✅ **Chat** direto com agentes (chat sessions do Multica).
- ✅ **Notificações em tempo real** via WebSocket (issues, comentários, tasks).
- ✅ **Fallback por polling** quando o WebSocket cai.
- ✅ Reconexão automática do WebSocket com backoff exponencial.
- ✅ **Idempotência** de eventos (evita notificações duplicadas).
- ✅ **Rate limiting** simples por usuário.
- ✅ Logs estruturados com **mascaramento de segredos**.
- ✅ Health check (`/health`) e validação de configuração no startup.

---

## Stack técnica

- **Node.js 22** + **TypeScript** (ESM)
- **Fastify** — servidor HTTP (health check + webhook)
- **Telegraf** — Telegram Bot API
- **ws** — cliente WebSocket
- **Zod** — validação de `.env` e payloads
- **undici** — cliente HTTP para o Multica
- **pino** / **pino-pretty** — logs estruturados
- **vitest** — testes

---

## Pré-requisitos

1. **Node.js 22+** (para execução local) ou **Docker**.
2. Um **bot do Telegram** criado via [@BotFather](https://t.me/BotFather) → obtém o `TELEGRAM_BOT_TOKEN`.
3. Seu **ID de usuário do Telegram** → consulte com [@userinfobot](https://t.me/userinfobot).
4. Acesso ao **backend do Multica** e um **Personal Access Token (PAT)** dedicado ao bridge.
5. O **slug do workspace** do Multica a ser controlado.

---

## Instalação e execução

### Local (desenvolvimento)

```bash
# 1. Instale as dependências
npm install

# 2. Configure o ambiente
cp .env.example .env
# edite o .env com seus valores reais

# 3. Rode em modo desenvolvimento (hot reload)
npm run dev

# Ou compile e rode em produção
npm run build
npm start
```

### Docker

```bash
# Build da imagem
docker build -t multica-telegram-bridge:latest .

# Execução (passando o .env)
docker run -d \
  --name multica-telegram-bridge \
  --env-file .env \
  -p 3333:3333 \
  --restart unless-stopped \
  multica-telegram-bridge:latest
```

### Docker Compose

```bash
cp .env.example .env   # preencha os valores
docker compose up -d --build
docker compose logs -f
```

Para integrar com a stack do Multica na mesma rede Docker, ajuste no `.env`:

```env
MULTICA_API_BASE_URL=http://backend:8080
MULTICA_WS_URL=ws://backend:8080/ws
```

e descomente o bloco `networks` no `docker-compose.yml`.

---

## Configuração (.env)

Todas as variáveis estão documentadas em [`.env.example`](./.env.example). As principais:

### Obrigatórias

| Variável | Descrição |
|----------|-----------|
| `TELEGRAM_BOT_TOKEN` | Token do bot (BotFather) |
| `TELEGRAM_ALLOWED_USER_IDS` | IDs autorizados, separados por vírgula |
| `MULTICA_API_BASE_URL` | URL base do backend do Multica |
| `MULTICA_API_TOKEN` | Personal Access Token dedicado ao bridge |
| `MULTICA_WORKSPACE_SLUG` | Slug do workspace alvo |

> Se qualquer obrigatória estiver ausente/inválida, **o bridge falha no startup com mensagem clara** e não inicia (critério de aceite CA-04).

### Telegram

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `TELEGRAM_MODE` | `polling` | `polling` ou `webhook` |
| `TELEGRAM_WEBHOOK_URL` | — | Obrigatório se `TELEGRAM_MODE=webhook` |
| `TELEGRAM_WEBHOOK_SECRET` | — | Segredo opcional para validar o webhook |
| `TELEGRAM_ALLOWED_CHAT_IDS` | — | Allowlist opcional de chats/grupos |

### Multica / WebSocket

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `MULTICA_WS_URL` | — | `ws://` ou `wss://` (obrigatório se WebSocket ativo) |
| `MULTICA_WORKSPACE_ID` | — | Usado para filtrar eventos do WebSocket |
| `BRIDGE_ENABLE_WEBSOCKET` | `true` | Habilita conexão em tempo real |
| `BRIDGE_ENABLE_POLLING_FALLBACK` | `true` | Fallback quando o WS cai |
| `BRIDGE_POLLING_INTERVAL_SECONDS` | `30` | Intervalo do polling de fallback |
| `BRIDGE_NOTIFICATION_CHAT_ID` | — | Chat que recebe as notificações |

### Bridge / Segurança

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `BRIDGE_PORT` | `3333` | Porta HTTP (health/webhook) |
| `BRIDGE_LOG_LEVEL` | `info` | Nível de log |
| `BRIDGE_CACHE_TTL_SECONDS` | `300` | TTL do cache de agentes/squads |
| `BRIDGE_MAX_MESSAGE_LENGTH` | `3500` | Tamanho máximo das mensagens |
| `BRIDGE_RATE_LIMIT_PER_MINUTE` | `30` | Limite de comandos por usuário/min |
| `BRIDGE_ALLOW_GROUP_MESSAGES` | `true` | Permite uso em grupos |
| `BRIDGE_REQUIRE_EXPLICIT_MENTION` | `true` | Exige `@` para acionar agentes |

---

## Comandos do Telegram

### Básicos

```text
/start     Inicia e mostra a ajuda
/help      Lista de comandos
/status    Status do bridge e da conexão com o Multica
```

### Agentes e squads

```text
/agentes   Lista agentes disponíveis com menções @
/squads    Lista squads disponíveis com menções @
/refresh   Atualiza o cache de agentes, squads e aliases
```

### Issues

```text
/issues                  Lista todas as issues
/issues in_progress      Filtra por status canônico
/issues andamento        Filtra por alias amigável
/issue <id>              Detalhes de uma issue
/comentar <id> <texto>   Comenta em uma issue
```

**Status canônicos:** `backlog`, `todo`, `in_progress`, `in_review`, `done`, `blocked`, `cancelled`

**Aliases amigáveis:** `abertas`, `andamento`, `revisao`, `bloqueadas`, `concluidas`, `canceladas`

### Criar issue

Formato simples (título apenas):

```text
/nova-issue @claude Corrigir erro na tela de login
```

Formato completo (`título | descrição | prioridade`):

```text
/nova-issue @claude | Corrigir erro na tela de login | Erro 500 após o login | high
```

Para squad:

```text
/nova-issue @squad-dev | Ajustar cadastro | Revisar validações | medium
```

Resposta esperada:

```text
✅ Issue criada com sucesso

ID: MUL-123
Título: Corrigir erro na tela de login
Atribuído para: @claude
Status: A fazer
Prioridade: high
```

### Chat com agente

```text
/chat @claude Analise a issue 123 e me diga o próximo passo
```

O bridge cria (ou reutiliza) uma chat session por usuário + agente, envia a mensagem e devolve a resposta — que também pode chegar depois via notificação em tempo real.

---

## Segurança

A segurança foi tratada como requisito central (planejamento, seção 12):

- 🔒 **Allowlist obrigatória** — o bot só responde a `TELEGRAM_ALLOWED_USER_IDS`. Sem nenhum ID, o startup falha.
- 🔒 **Política de grupos** — em grupos, exige permissão e (opcionalmente) allowlist de chats; usuários não autorizados são ignorados silenciosamente.
- 🔒 **Rate limiting** por usuário, evitando abuso/flood.
- 🔒 **Segredos só no servidor** — o `MULTICA_API_TOKEN` e o `TELEGRAM_BOT_TOKEN` nunca são enviados ao Telegram nem logados; o logger **mascara/redacta** tokens e headers de autenticação.
- 🔒 **Erros seguros** — mensagens ao usuário nunca expõem token, stacktrace ou headers internos (CA-02).
- 🔒 **Sem comandos destrutivos** no MVP (`/delete-issue`, `/cancel-task` etc. ficam fora, conforme planejamento).
- 🔒 **Webhook autenticado** — suporte ao `secret_token` do Telegram.
- 🔒 **Container endurecido** — imagem multi-stage rodando como usuário **não-root**, `read_only`, `cap_drop: ALL` e `no-new-privileges`.
- 🔒 **`.gitignore`** robusto — `.env`, chaves e segredos jamais vão para o repositório.

> ⚠️ O `MULTICA_API_TOKEN` tem acesso ao workspace. Trate-o como **segredo crítico**: use um PAT dedicado, com o menor escopo possível, e rotacione periodicamente.

---

## Observabilidade

**Logs** (pino, estruturados, com redaction): startup, validação de `.env`, conexão com Telegram, health check, conexão/desconexão do WebSocket, criação de issue, erros de API, acessos não autorizados, eventos recebidos e notificações enviadas.

**Nunca logado:** `TELEGRAM_BOT_TOKEN`, `MULTICA_API_TOKEN`, headers de autenticação e payloads sensíveis completos.

**Health check:** `GET /health` retorna o status do serviço e do WebSocket:

```bash
curl http://localhost:3333/health
# {"status":"ok","websocket":"connected","timestamp":"..."}
```

---

## Estrutura do projeto

```text
src/
  main.ts                      # Bootstrap: config, health check, bot, WS, HTTP
  config/
    env.ts                     # Validação do .env com Zod
  telegram/
    telegram.bot.ts            # Instância Telegraf + middleware de auth
    telegram.commands.ts       # Handlers dos comandos
    telegram.auth.ts           # Autorização + rate limit
    telegram.formatter.ts      # Formatação das mensagens
  multica/
    multica.client.ts          # Client REST
    multica.types.ts           # Schemas/Tipos (Zod)
    multica.websocket.ts       # Client WebSocket com reconnect
  domain/
    mention-resolver.ts        # Resolução de @menções
    issue.service.ts           # Criar/listar/comentar issues
    agent.service.ts           # Agentes (com cache)
    squad.service.ts           # Squads (com cache)
    chat.service.ts            # Chat com agentes
    notification.service.ts    # Eventos -> notificações
  storage/
    cache.ts                   # Cache TTL em memória
    repository.ts              # Idempotência, sessions, rate limit
  utils/
    logger.ts                  # pino + mascaramento de segredos
    normalize.ts               # Normalização e geração de aliases
    errors.ts                  # Hierarquia de erros seguros
```

---

## Desenvolvimento

```bash
npm run dev         # Hot reload (tsx watch)
npm run build       # Compila TypeScript -> dist/
npm start           # Executa a build
npm run typecheck   # Verificação de tipos
npm run lint        # ESLint
npm run format      # Prettier
npm test            # Testes (vitest)
```

---

## Validação no ambiente real

Antes do uso em produção, valide na instância alvo do Multica (planejamento, seção 4):

- versão do Multica em uso;
- se `GET /api/squads` está funcional no self-hosted (algumas versões têm a UI mas a rota ainda não);
- se o PAT do bridge possui acesso ao workspace;
- se o WebSocket `/ws` aceita autenticação via token (header ou query);
- o **formato real dos eventos** do WebSocket (os nomes de evento usados aqui são preparados para `issue.*`, `task.*`, `chat.*` — ajuste em `notification.service.ts` se necessário);
- se há proxy/reverse proxy entre o bridge e o Multica (Nginx/Caddy/Traefik exigem configuração de *upgrade* para WebSocket).

> O bridge isola todas as chamadas no `MulticaClient` e os schemas usam `passthrough`/campos opcionais, justamente para tolerar pequenas variações de payload entre versões do Multica.

---

## Roadmap por fases

- **Fase 1 — MVP REST** ✅ bot, autorização, `/agentes`, `/squads`, resolução de `@`, `/nova-issue`, `/issues <status>`.
- **Fase 2 — WebSocket e notificações** ✅ conexão, notificações de issue/comentário/task, reconnect e fallback.
- **Fase 3 — Chat com agentes** ✅ `/chat`, criação/reuso de session, vínculo usuário+agente.
- **Fase 4 — Produção** 🔜 persistência (Postgres/Redis), auditoria, métricas Prometheus, comandos administrativos com confirmação dupla.

---

## Solução de problemas

| Sintoma | Causa provável | Ação |
|---------|----------------|------|
| Falha no startup com lista de variáveis | `.env` incompleto | Preencha as variáveis indicadas |
| `Health check do Multica falhou` | URL/token inválidos ou backend fora | Verifique `MULTICA_API_BASE_URL` e `MULTICA_API_TOKEN` |
| Bot não responde | Usuário fora da allowlist | Adicione seu ID em `TELEGRAM_ALLOWED_USER_IDS` |
| `/squads` vazio | Rota indisponível na versão | Valide `GET /api/squads` na instância |
| WebSocket desconectado | Proxy sem upgrade ou token recusado | Ajuste o proxy / use `wss://` / valide auth do `/ws` |
| Sem notificações | `BRIDGE_NOTIFICATION_CHAT_ID` ausente | Configure o chat de notificações |

---

## Licença

[MIT](./LICENSE)
