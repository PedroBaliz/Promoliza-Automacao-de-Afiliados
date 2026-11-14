# Regras do orquestrador — Promoliza

Lido pelo skill `/orquestrar`. Estas regras prevalecem sobre o roteiro genérico.

## Briefing base (use e complemente com o que mudou)

Bot TypeScript/Node (CommonJS, Node >= 22.12) que lê grupos do Telegram com uma **conta de usuário**
(gramjs, `src/services/telegram-source.service.ts`), resolve links do Mercado Livre
(`src/services/link.service.ts`: allowlist de hosts, redirect manual, páginas `/social/` viram o
link do produto, dedup pelo ID MLB), aplica a tag de afiliado (`src/utils/affiliate.ts`) e publica
pelo **bot** do Telegram (`src/providers/telegram.provider.ts`, canal principal) e, opcionalmente, no
WhatsApp via Baileys (`src/providers/whatsapp.provider.ts`, fila própria, nunca bloqueia o Telegram).
Histórico de 30 dias em `.local/posted-products.json`. Produção no Railway (projeto
`robust-strength`, serviço `Promoliza`, deploy automático a cada merge no `main`).

## Mapa de especialistas

| Área tocada | Agente |
|---|---|
| link.service, affiliate, dedup, extração de URLs, `/social/` | `promoliza-pipeline` |
| telegram-source, telegram.provider, whatsapp.provider, sessões | `messaging-integrations` |
| Dockerfile, docker-compose, Railway, volumes, healthcheck | `devops-deploy` |
| segredos, `.env`, logs, entrada externa | `security-auditor` |

## Regras críticas (repasse a todo agente que executa comandos)

- **Nunca** rodar o bot localmente (`npm run dev`, `npm start`, `docker compose up`, container
  `promoliza_app`) nem abrir o Docker Desktop sem antes conferir `docker ps -a`: a mesma
  `TELEGRAM_SOURCE_SESSION` em dois lugares gera `AUTH_KEY_DUPLICATED` e derruba a produção.
- Validar imagem só com `docker build` + `docker run --rm --entrypoint sh` (nunca o compose).
- **Nunca** ler nem imprimir valores do `.env` ou das variáveis do Railway. Para comparar sessões,
  use o sha256 (10 primeiros caracteres).
- Testes nunca fazem rede real (mock de `axios`) e fazem `process.chdir` para um diretório
  temporário antes de importar módulos que carregam `dotenv`.
- Alterar variáveis de produção, apagar recursos ou fazer deploy: só com confirmação do usuário.

## Verificação

```
npx tsc --noEmit
npm test        # se falhar logo após editar, rode de novo (corrida no cache do tsx)
npm run build
```

## Verificação pós-deploy (oferecer após merge no main)

Pelo conector do Railway (ou `railway logs`), no deploy mais recente do `robust-strength`:
- `[TelegramSource] Conectado.` e `Monitorando N chat(s)`;
- `[WhatsApp] Conectado com sucesso.` (se `WHATSAPP_GROUP_JID` estiver definido);
- nenhuma ocorrência de `AUTH_KEY_DUPLICATED`, `EACCES` ou `❌ [Promoliza]`.
