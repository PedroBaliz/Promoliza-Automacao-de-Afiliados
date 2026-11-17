# Promoliza — Automação de Afiliados no Telegram e WhatsApp

Bot em TypeScript/Node.js que lê ofertas de canais e grupos do **Telegram** e
de grupos do **WhatsApp**, identifica links do Mercado Livre, converte esses
links para o **seu link de afiliado** e republica a oferta (texto, foto e link)
em um grupo de destino do Telegram e, opcionalmente, em um grupo do WhatsApp.

> **Automação de marketing de afiliados e ofertas do Mercado Livre no Telegram e no WhatsApp.**

Peças usadas:

- **Conta de usuário do Telegram** ([gramjs](https://github.com/gram-js/gramjs)):
  lê os canais e grupos de origem.
- **Bot do Telegram** (Bot API): publica no grupo de destino.
- **Conta do WhatsApp** ([Baileys](https://github.com/WhiskeySockets/Baileys)),
  opcional: lê grupos de origem e/ou publica em um grupo de destino.

## Sumário

- [Funcionalidades](#funcionalidades)
- [Como funciona](#como-funciona)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Início rápido](#início-rápido)
- [Pré-requisitos](#pré-requisitos)
- [Configuração](#configuração)
- [Sessão do Telegram](#sessão-do-telegram)
- [WhatsApp](#whatsapp)
- [Comandos](#comandos)
- [Health check](#health-check)
- [Docker](#docker)
- [Deploy no Railway](#deploy-no-railway)
- [Regras do processamento](#regras-do-processamento)
- [Segurança](#segurança)

## Funcionalidades

- **Origens:** canais e grupos do Telegram (`TELEGRAM_SOURCE_CHATS`) e grupos
  do WhatsApp (`WHATSAPP_SOURCE_JIDS`, opcional).
- **Destinos:** grupo do Telegram (obrigatório) e grupo do WhatsApp
  (`WHATSAPP_GROUP_JID`, opcional).
- Extração de links do texto, de links embutidos, de botões, de links sem
  `http` (ex.: `meli.la/abc`) e da prévia de link do WhatsApp.
- Acesso somente a links do Mercado Livre ou de encurtadores conhecidos, com o
  host revalidado a cada redirecionamento (proteção contra SSRF).
- Conversão para o seu link de afiliado, sempre removendo a afiliação de quem
  postou. Páginas `/social/<afiliado>` são convertidas no link do produto.
- Texto original republicado **inteiro**, com o link afiliado encurtado
  (is.gd) **no lugar do link original**. Os outros links saem, junto com os
  rótulos e emojis que ficariam soltos.
- Foto da oferta: a foto original da mensagem. Nas mensagens do WhatsApp sem
  foto anexada, é usada a prévia do link (a foto do produto no Mercado Livre).
- Um mesmo produto não é republicado no mesmo dia (horário de Brasília), venha
  de qualquer origem. No dia seguinte, pode sair de novo.
- O WhatsApp nunca bloqueia nem atrasa o Telegram.
- Endpoint `/health` para o Docker e o Railway.

> O bot só processa mensagens que chegam **depois** de iniciar; não lê o
> histórico. Ele também não limita a frequência de publicação: as ofertas
> saem no ritmo em que chegam nas origens.

## Como funciona

```text
 Telegram (canais/grupos)            WhatsApp (grupos, opcional)
          |                                   |
 TelegramSourceService               WhatsAppSourceService
 (consulta a cada 10 s)              (evento de mensagem nova)
          |                                   |
          +-------------> deal-pipeline <-----+
                               |
             1. resolve o link (só hosts permitidos)
             2. descarta o que não é Mercado Livre
             3. descarta repetidos (mesmo dia)
             4. aplica a tag de afiliado e encurta (is.gd)
             5. pega a foto da mensagem
                               |
                               v
             TelegramProvider ──> grupo de destino (Telegram)
                               |
                               v
             WhatsAppProvider (opcional, fila própria) ──> grupo de destino (WhatsApp)
```

- O Telegram é o **canal principal**. Se a publicação nele falhar por motivo
  temporário, a oferta é tentada de novo e nada é descartado.
- O produto é marcado como publicado logo depois do envio ao Telegram. Assim,
  uma queda durante o envio ao WhatsApp não gera repetição no Telegram.
- O WhatsApp recebe a oferta por uma fila separada (até 50 pendentes). Uma
  falha nele só aparece no log.

A leitura do Telegram usa uma **conta de usuário**, porque um bot não consegue
ler canais e grupos de terceiros. A publicação é feita pelo **bot**.

## Estrutura do projeto

```text
src/
├── config/
│   └── env.config.ts               # Leitura e normalização das variáveis
├── providers/
│   ├── telegram.provider.ts        # Publicação via Telegram Bot API
│   └── whatsapp.provider.ts        # Conexão Baileys: publica e escuta grupos de origem
├── services/
│   ├── deal-pipeline.ts            # Etapa comum: link → afiliado → dedup → publicar
│   ├── telegram-source.service.ts  # Leitura das origens do Telegram
│   ├── whatsapp-source.service.ts  # Leitura das origens do WhatsApp
│   ├── link.service.ts             # Extração, resolução e encurtamento de URLs
│   └── database.service.ts         # Histórico de produtos publicados (dedup)
├── scripts/
│   ├── generate-session.ts         # npm run session: gera a sessão do Telegram
│   └── whatsapp-groups.ts          # npm run whatsapp-groups: lista os JIDs dos grupos
├── utils/
│   ├── affiliate.ts                # Montagem do link afiliado
│   ├── caption.ts                  # Montagem e corte da legenda
│   ├── errors.ts                   # Mensagens de erro sem segredos
│   └── timeout.ts                  # Tempo limite para chamadas externas
└── index.ts                        # Inicialização: HTTP, origens e destinos
```

- Os testes ficam ao lado de cada módulo (`*.test.ts`).
- Na raiz: `Dockerfile`, `docker-compose.yml`, `.env.example` e a pasta
  `.claude/`, com os agentes do Claude Code usados no projeto.
- `.local/` é criada em tempo de execução e não é versionada. Ela guarda:
  - `.local/posted-products.json`: histórico de produtos publicados;
  - `.local/whatsapp-session/`: sessão do WhatsApp.

## Início rápido

```powershell
npm ci
copy .env.example .env   # Linux/macOS: cp .env.example .env
npm run session          # gera TELEGRAM_SOURCE_SESSION (cole no .env)
npm run dev
```

> ⚠️ **Não rode o bot no seu computador enquanto a produção estiver no ar
> com a mesma sessão do Telegram.** Veja
> [Uma sessão, uma instância](#uma-sessão-uma-instância).

## Pré-requisitos

- Node.js **22.12 ou superior**. O Baileys é ESM e é carregado via `require`.
- Uma conta do Telegram inscrita nos canais e grupos de origem.
- `API ID` e `API Hash` obtidos em [my.telegram.org](https://my.telegram.org).
- Um bot criado no BotFather, com permissão para enviar mensagens no grupo de
  destino.
- Opcional: uma conta do WhatsApp que participe dos grupos de origem e/ou de
  destino. De preferência, um número dedicado.
- Opcional: Docker, para rodar em container.

## Configuração

Copie o `.env.example` para `.env` e preencha:

```env
PORT=3000
NODE_ENV=development

ML_AFFILIATE_TAG=matt:sua_matt_word:sua_matt_tool

# Telegram — bot que publica
TELEGRAM_BOT_TOKEN=123456789:token_do_bot
TELEGRAM_CHAT_ID=-1001234567890

# Telegram — conta que lê as origens
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=seu_api_hash
TELEGRAM_SOURCE_PHONE=+5511999999999
TELEGRAM_SOURCE_CHATS=@canal1,-1001234567890
TELEGRAM_SOURCE_SESSION=

# WhatsApp (opcional)
WHATSAPP_GROUP_JID=
WHATSAPP_SOURCE_JIDS=
WHATSAPP_PAIRING_PHONE=
```

### Geral

| Variável | Descrição |
|---|---|
| `PORT` | Porta do servidor HTTP. Padrão `3000`. No Railway é definida automaticamente. |
| `NODE_ENV` | Ambiente. O Docker já define `production`. |

### Afiliado do Mercado Livre

`ML_AFFILIATE_TAG` aceita dois formatos:

- `matt:<matt_word>:<matt_tool>`: adiciona `matt_word` e `matt_tool` ao link.
- Tag simples (ex.: `minha_tag`): adiciona o parâmetro `tag`.

Os parâmetros de afiliado que vêm no link da origem (`matt_word`, `matt_tool`
e `tag`) são sempre removidos antes de aplicar a sua tag.

- Se o formato `matt:` estiver incompleto, o bot não inicia.
- Se a variável estiver vazia, o bot mostra um aviso e publica os links **sem
  afiliação**.

### Telegram

| Variável | Descrição |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token do bot que publica. |
| `TELEGRAM_CHAT_ID` | ID do grupo ou canal de destino. |
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | Credenciais de [my.telegram.org](https://my.telegram.org). |
| `TELEGRAM_SOURCE_PHONE` | Telefone da conta que lê as origens, com DDI. |
| `TELEGRAM_SOURCE_CHATS` | Origens separadas por vírgula: `@username` ou ID numérico. **Não** use o nome exibido do grupo. |
| `TELEGRAM_SOURCE_SESSION` | Sessão da conta de leitura (veja [Sessão do Telegram](#sessão-do-telegram)). |

### WhatsApp (opcional)

| Variável | Descrição |
|---|---|
| `WHATSAPP_GROUP_JID` | Grupo de **destino** (`<id>@g.us`). Vazio = não publica no WhatsApp. |
| `WHATSAPP_SOURCE_JIDS` | Grupos de **origem** (`<id>@g.us`), separados por vírgula. Vazio = não lê o WhatsApp. |
| `WHATSAPP_PAIRING_PHONE` | Número da conta com DDI, só dígitos (ex.: `5561999999999`). Se definido, o login usa um código de pareamento em vez do QR Code. |

Os JIDs aparecem com `npm run whatsapp-groups`. O WhatsApp só conecta se
`WHATSAPP_GROUP_JID` ou `WHATSAPP_SOURCE_JIDS` estiver preenchido.

## Sessão do Telegram

Gere a sessão no seu computador, num terminal interativo:

```powershell
npm run session
```

1. Informe o código recebido no Telegram.
2. Informe a senha de verificação em duas etapas, se houver.
3. Copie o valor exibido para `TELEGRAM_SOURCE_SESSION`, no `.env` e/ou nas
   variáveis do Railway.

O comando sempre cria uma sessão nova e só faz isso: não lê grupos nem
publica nada. Se `TELEGRAM_SOURCE_SESSION` estiver vazia e não houver terminal
interativo (ex.: no Railway), o bot encerra explicando o que fazer.

### Uma sessão, uma instância

O Telegram **invalida** uma sessão usada por dois processos ao mesmo tempo
(erro `AUTH_KEY_DUPLICATED`). A partir daí, o bot para de ler as origens até
você gerar uma sessão nova. Para evitar isso:

- Rode **uma única instância** com cada sessão.
- No Railway, use 1 réplica e `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS=0`. Não crie
  ambientes de PR ou staging com a mesma sessão.
- Não rode `npm run dev` nem o container local (`docker compose`) enquanto a
  produção estiver no ar. O container local usa `restart: unless-stopped`: ao
  abrir o Docker Desktop, ele pode subir sozinho e derrubar a produção.
- Ao desligar (`SIGTERM`), o bot desconecta do Telegram antes de sair, para o
  próximo deploy não encontrar a conexão antiga aberta.

## WhatsApp

### Conectar a conta

Na primeira execução, o log mostra um QR Code. No celular, abra o WhatsApp →
**Dispositivos conectados** → **Conectar dispositivo** e escaneie.

Se o QR Code ficar grande demais para escanear (comum no painel de logs do
Railway), defina `WHATSAPP_PAIRING_PHONE`. O log passa a mostrar um código como
`ABCD-EFGH`: no celular, vá em **Dispositivos conectados** → **Conectar
dispositivo** → **Conectar com número de telefone** e digite o código.

A sessão fica em `.local/whatsapp-session/` e é reaproveitada nos reinícios,
desde que essa pasta esteja num volume persistente. Cada lugar onde o bot roda
(seu computador ou o Railway) conecta como um dispositivo separado.

### Grupo de destino

Com `WHATSAPP_GROUP_JID` definido, cada oferta publicada no Telegram também é
enviada a esse grupo. A conta conectada precisa participar dele.

### Grupos de origem

Com `WHATSAPP_SOURCE_JIDS` definido, as mensagens novas desses grupos passam
pelo mesmo pipeline do Telegram e são publicadas nos mesmos destinos.

- A conta conectada precisa ser **membro** dos grupos de origem.
- **Texto lido:** texto simples, texto com prévia de link, legenda de foto ou
  vídeo, e mensagens temporárias ou de visualização única.
- **Links lidos:** com `https://`, sem esquema (`meli.la/abc`) e o link da
  prévia.
- **Foto**, nesta ordem:
  1. a foto anexada;
  2. a prévia do link em alta qualidade, que é a foto do produto no Mercado
     Livre;
  3. a miniatura da prévia, em baixa resolução.
- Os asteriscos do negrito do WhatsApp (`*R$49*`) são removidos, porque
  apareceriam literalmente no Telegram.
- **Mensagens ignoradas:**
  - as enviadas pela própria conta;
  - o histórico;
  - mensagens com mais de 15 minutos (ex.: entregues depois de uma queda
    longa);
  - mensagens repetidas.
- O grupo de destino não pode estar entre as origens. Se estiver, o bot não
  inicia.
- **Telegram fora do ar:** a oferta é tentada até 8 vezes, com espera
  crescente. As mensagens são processadas uma por vez, numa fila em memória de
  até 200. Se o processo reiniciar, o que estava pendente se perde.

> Contas que leem e republicam muito de forma automática correm risco de
> banimento pelo WhatsApp. Use um número dedicado.

### Reconexão e erros

- Em quedas de conexão, o bot reconecta sozinho, com espera crescente de 2 s
  até 5 min.
- Nos casos abaixo, o WhatsApp é desativado até o próximo reinício. O
  Telegram continua normalmente e o motivo aparece no log.

  | Código | Motivo | O que fazer |
  |---|---|---|
  | 401 | Logout no celular | Apague `.local/whatsapp-session/` e conecte de novo |
  | 440 | Sessão aberta em outra instância | Deixe só uma rodando e reinicie |
  | 403 | Conexão recusada pelo WhatsApp | Verifique a conta |
  | 411 | Sessão incompatível | Apague `.local/whatsapp-session/` e conecte de novo |

- Se o WhatsApp não estiver conectado na hora do envio, a mensagem é ignorada
  no WhatsApp e registrada no log. Logo após iniciar, o bot espera até 30 s
  pela conexão.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Roda o bot com `tsx` (desenvolvimento). |
| `npm run build` | Compila para `dist/`. |
| `npm start` | Roda a versão compilada. |
| `npm test` | Roda os testes (`node:test`). |
| `npm run session` | Gera uma nova `TELEGRAM_SOURCE_SESSION` e encerra. |
| `npm run whatsapp-groups` | Conecta o WhatsApp, lista os grupos da conta com o JID de cada um e encerra (não usa o Telegram). |

## Health check

`GET /health` responde:

- `200 {"telegram":"ok"}` se as origens do Telegram foram lidas com sucesso nos
  últimos 3 minutos;
- `503 {"telegram":"indisponível"}` caso contrário, inclusive durante a
  inicialização.

O `HEALTHCHECK` do `Dockerfile` usa esse endpoint. Se a inicialização do
Telegram falhar, ou se a sessão for invalidada, o processo encerra com código
`1` para o Docker ou o Railway reiniciar.

Uma inicialização normal mostra no log:

```text
🌐 [HTTP] Servidor Web ativo na porta 3000
[WhatsAppSource] Monitorando 1 grupo(s) de origem.
[TelegramSource] Conectado.
[TelegramSource] Chat de origem resolvido: @canal (-100...)
[TelegramSource] Monitorando 1 chat(s) de origem.
[WhatsApp] Conectado com sucesso.
```

## Docker

A imagem usa build multi-stage com `node:22-slim` e roda como o usuário `node`,
sem root. O `docker-compose.yml` publica a porta interna `3000` na porta
`3001` e monta o volume `promoliza_data` em `/app/.local`.

```powershell
docker compose up --build -d          # sobe ou recria
docker compose ps                     # status (healthy quando /health = 200)
docker compose logs -f promoliza-bot  # logs, incluindo o QR Code do WhatsApp
docker compose down                   # para (mantém o volume)
```

- `restart: unless-stopped`: o container volta sozinho se cair, e também ao
  abrir o Docker Desktop. Lembre de
  [uma sessão, uma instância](#uma-sessão-uma-instância).
- Logs rotacionados: 3 arquivos de até 10 MB.
- **Volume:** sem o volume, recriar o container apaga o histórico, o que
  permite republicar ofertas, e pede o QR Code de novo. Para apagar o volume:
  `docker volume rm promoliza_data`.

## Deploy no Railway

1. Crie um projeto em [railway.com](https://railway.com) com **Deploy from
   GitHub Repo** e selecione este repositório. O Railway usa o `Dockerfile`.
2. Configure as variáveis do `.env` em **Variables**, com a
   `TELEGRAM_SOURCE_SESSION` gerada localmente.
3. Defina `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS=0` e mantenha **1 réplica**.
4. Monte um **volume em `/app/.local`**, para manter o histórico e a sessão do
   WhatsApp entre deploys.
5. Para conectar o WhatsApp sem QR Code, defina `WHATSAPP_PAIRING_PHONE` e
   leia o código no log.
6. Opcional: gere um domínio público e acesse `/health`.

Mais detalhes:

- Cada push no branch conectado (ex.: `main`) gera um deploy automático.
- Mudar uma variável reinicia o serviço.
- A sessão do WhatsApp continua no volume, então o reinício não pede um novo
  pareamento.

Use um serviço que mantenha processos rodando continuamente (Railway, VPS
etc.). Plataformas serverless, como a Vercel, não servem para esta conexão
permanente.

## Regras do processamento

### Links aceitos

- Só são acessados links do Mercado Livre ou dos encurtadores da lista
  `SHORTENER_HOSTS` (`src/services/link.service.ts`). Qualquer outro link
  (Amazon, Shopee, Nike...) é ignorado **sem ser acessado**.
- Os redirecionamentos são seguidos um a um, revalidando o host em cada salto
  (até 5). O destino final precisa ser do Mercado Livre.
- Um link `meli.la` que não redireciona é ignorado, para não publicar a
  comissão de quem criou o link.
- Uma página de afiliado de outra pessoa (`/social/<afiliado>?ref=...`) é lida
  para identificar o produto principal. O bot publica o link desse produto com
  a sua tag. Se o produto não for identificado, a oferta é ignorada.

### Texto e foto

- **Texto publicado:** a mensagem original inteira, com o **seu link no lugar
  do link original**. Exemplo: `🛒 Compre aqui: <link da origem>` vira
  `🛒 Compre aqui: <seu link>`.
- **Os outros links saem:**
  - links com e sem `http`, incluindo `t.me/...` e `chat.whatsapp.com/...`;
  - a linha que sobra só com um rótulo (`Verde:`, `🔗 Link:`);
  - o emoji que só apontava para o link (`👉`).
- **Vários links do Mercado Livre na mesma mensagem:** sai uma oferta para
  cada link, e cada uma mostra só o próprio link.
- **Link que não aparece no texto** (botão ou link escondido atrás de uma
  palavra): o texto vai sem links e no fim vai `🛒 Acessar oferta: <link>`.
- **Limites do Telegram:**
  - com foto, a legenda tem até 1024 caracteres;
  - sem foto, o texto tem até 4096 caracteres;
  - se a mensagem com o link no meio não couber, a linha do link sai, o link
    vai para o fim e só o texto da origem é cortado (com `…`). O link nunca é
    cortado.
- **Foto recusada:** se o Telegram recusar a foto, a oferta sai só com o texto.
- **No WhatsApp:** a oferta vai com o texto de até 4096 caracteres, com ou sem
  foto.

### Repetição

- Um produto publicado não é republicado **no mesmo dia**, contado pelo
  calendário de Brasília (`America/Sao_Paulo`). A partir de 00:00 do dia
  seguinte, ele pode sair de novo.
- A chave usada para reconhecer o produto é:
  - o ID MLB, quando existe;
  - senão, a URL sem os parâmetros de rastreio.
- O mesmo produto vindo de grupos, origens ou encurtadores diferentes conta
  como repetido.
- A repetição é verificada antes de encurtar o link e baixar a foto.
- O histórico fica em `.local/posted-products.json`. Ele não é um banco de
  dados: para várias instâncias, migre para PostgreSQL ou Redis.

### Falhas

- **Telegram indisponível para publicar** (rede, 5xx, limite de envio, token
  ou permissão do bot): a leitura pausa com espera crescente (15 s até 5 min,
  ou o tempo pedido pelo Telegram). Nada é descartado.
- **FloodWait na leitura:** pausa pelo tempo indicado pelo Telegram.
- **Erro na própria mensagem:** até 10 tentativas, depois ela é descartada.
  Uma mensagem que o Telegram rejeita pelo conteúdo é descartada na hora, com
  registro no log.
- **Encurtador (is.gd) indisponível:** publica o link afiliado completo.

## Segurança

- Nunca versione o `.env` nem a pasta `.local/`.
- `TELEGRAM_SOURCE_SESSION` e `.local/whatsapp-session/` dão **acesso total**
  às contas. Não compartilhe.
- Nunca compartilhe `TELEGRAM_BOT_TOKEN` ou `TELEGRAM_API_HASH`.
- Se alguma credencial do Telegram vazar:
  1. revogue o token no BotFather;
  2. gere um novo API Hash em [my.telegram.org](https://my.telegram.org);
  3. gere uma nova sessão com `npm run session`.
- Se a sessão do WhatsApp vazar:
  1. desconecte o aparelho em **Dispositivos conectados**;
  2. apague `.local/whatsapp-session/`;
  3. conecte de novo.
- Os logs ocultam o token do bot. A sessão do Telegram só é impressa ao ser
  gerada num terminal interativo, nunca nos logs de produção.

## Palavras-chave

bot do Telegram, bot do WhatsApp, marketing de afiliados, links afiliados,
Mercado Livre, automação de ofertas, bot de cupons, Node.js, TypeScript.
