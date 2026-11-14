# Promoliza — Automação de Afiliados no Telegram e WhatsApp

Bot em TypeScript/Node.js que monitora canais e grupos do Telegram, identifica
links do Mercado Livre, converte esses links para links de afiliado e
republica as promoções em um grupo de destino do Telegram e, opcionalmente,
em um grupo do WhatsApp.

> **Automação de marketing de afiliados e ofertas do Mercado Livre no Telegram e no WhatsApp.**

O projeto combina uma conta de usuário do Telegram para monitoramento com um
bot do Telegram para publicação. A publicação no WhatsApp usa uma conta
conectada via [Baileys](https://github.com/WhiskeySockets/Baileys). É adequado
para automação de ofertas, cupons, promoções e distribuição de links de
afiliados.

## Funcionalidades

- Monitoramento contínuo de um ou mais grupos/canais do Telegram.
- Leitura de novas mensagens recebidas após a conexão do serviço.
- Extração de URLs do texto, de links embutidos, de botões e de links sem
  `http` (ex.: `meli.la/abc`).
- Acesso somente a links do Mercado Livre ou de encurtadores conhecidos; o
  host é revalidado a cada redirecionamento.
- Conversão do link para o formato de afiliado configurado, sempre removendo
  parâmetros de afiliado vindos da origem.
- Remoção dos links (com e sem `http`) e de rótulos órfãos, como `Link:`, do
  texto republicado.
- Encurtamento do link afiliado publicado.
- Republicação com a foto original; legendas cortadas para caber no limite do
  Telegram, com o link sempre no fim.
- Publicação opcional em um grupo do WhatsApp, sem nunca bloquear o Telegram.
- Prevenção de republicação do mesmo produto (ID MLB) por 30 dias.
- Persistência local do histórico de produtos publicados.
- Endpoint `/health` para monitorar se o Telegram está sendo lido.
- Execução local, via Docker ou em um servidor 24 horas.

> O serviço não lê mensagens antigas anteriores ao início do monitoramento.
> A conta usada na sessão precisa conseguir visualizar os grupos ou canais de
> origem.
>
> O bot processa as promoções conforme elas chegam. Ele não cria um timer
> próprio para limitar a quantidade de publicações; caso os grupos de origem já
> controlem a frequência, esse comportamento é preservado.

## Fluxo da aplicação

```text
Grupo/canal de origem
        |
        v
TelegramSourceService (conta de usuário)
        |
        v
Extração e resolução do link (só hosts permitidos)
        |
        v
Conversão para link de afiliado
        |
        v
DatabaseService verifica duplicidade (ID MLB)
        |
        v
Encurtamento do link (is.gd)
        |
        v
TelegramProvider publica com o bot ──> Grupo de destino (Telegram)
        |
        v
WhatsAppProvider (opcional) ──> Grupo de destino (WhatsApp)
```

O monitoramento usa uma sessão de usuário do Telegram porque bots não
conseguem acessar todos os grupos e canais da mesma forma que uma conta
normal. A publicação é feita separadamente pelo token do bot.

O Telegram é o canal principal: se o envio ao Telegram falhar, a mensagem é
tentada novamente no próximo ciclo. Uma falha no WhatsApp é apenas registrada
no log e não causa reenvio nem duplicação no Telegram.

## Arquitetura de pastas

```text
.
├── dist/                           # JavaScript compilado; gerado pelo build
├── node_modules/                   # Dependências instaladas; gerado pelo npm
├── src/
│   ├── config/
│   │   └── env.config.ts            # Leitura e normalização das variáveis
│   ├── providers/
│   │   ├── telegram.provider.ts     # Publicação via Telegram Bot API
│   │   └── whatsapp.provider.ts     # Publicação opcional via Baileys
│   ├── services/
│   │   ├── database.service.ts      # Controle de duplicidade e persistência
│   │   ├── link.service.ts          # Extração, resolução e encurtamento de URLs
│   │   └── telegram-source.service.ts # Monitoramento via conta de usuário
│   ├── utils/
│   │   ├── affiliate.ts             # Construção do link afiliado
│   │   ├── caption.ts               # Montagem e corte da legenda
│   │   ├── errors.ts                # Mensagens de erro sem segredos
│   │   └── timeout.ts               # Tempo limite para chamadas externas
│   └── index.ts                     # Inicialização do HTTP e do monitoramento
├── .dockerignore                    # Arquivos ignorados no contexto do Docker
├── .env                             # Variáveis locais e segredos; não versionar
├── .env.example                     # Modelo das variáveis de ambiente
├── .gitignore                       # Arquivos ignorados pelo Git
├── Dockerfile                       # Imagem de produção (multi-stage)
├── docker-compose.yml               # Execução do serviço com Docker
├── package-lock.json                # Versões exatas das dependências
├── package.json                     # Scripts e dependências
└── tsconfig.json                    # Configuração do TypeScript
```

`dist/` e `node_modules/` aparecem depois da instalação e da compilação, mas
são diretórios gerados e não fazem parte do código-fonte principal. O
diretório `.local/` é criado em tempo de execução e guarda:

- `.local/posted-products.json`: histórico de produtos já publicados.
- `.local/whatsapp-session/`: sessão do WhatsApp (apenas se habilitado).

## Início rápido

```powershell
npm ci
copy .env.example .env   # Windows; no Linux/macOS: cp .env.example .env
npm run dev
```

Antes de iniciar, preencha o `.env` e gere a sessão do Telegram conforme as
instruções abaixo.

## Pré-requisitos

- Node.js 22.12 ou superior para execução local.
- Docker Desktop e Docker Compose para execução em container.
- Uma conta do Telegram inscrita nos grupos/canais de origem.
- Um bot do Telegram criado pelo BotFather.
- API ID e API Hash obtidos em [my.telegram.org](https://my.telegram.org).
- Um grupo de destino onde o bot possa enviar mensagens.
- Opcional: uma conta do WhatsApp participante do grupo de destino.

## Configuração do ambiente

Copie o `.env.example` para `.env` na raiz do projeto e preencha os valores:

```env
PORT=3000
NODE_ENV=production

ML_AFFILIATE_TAG=matt:sua_matt_word:sua_matt_tool

TELEGRAM_BOT_TOKEN=token_do_seu_bot
TELEGRAM_CHAT_ID=-1001234567890

TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=seu_api_hash
TELEGRAM_SOURCE_PHONE=+5511999999999
TELEGRAM_SOURCE_CHATS=@canal1,@grupo2
TELEGRAM_SOURCE_SESSION=

WHATSAPP_GROUP_JID=
```

### Variáveis gerais

- `PORT`: porta do servidor HTTP. Padrão: `3000`.
- `NODE_ENV`: ambiente de execução. O Docker já define `production`.

### Afiliado do Mercado Livre

`ML_AFFILIATE_TAG` aceita dois formatos:

- `matt:<matt_word>:<matt_tool>`: adiciona `matt_word` e `matt_tool` ao link.
- Tag simples (ex.: `minha_tag`): adiciona o parâmetro `tag` ao link.

Os parâmetros de afiliado que vierem no link da origem (`matt_word`,
`matt_tool` e `tag`) são sempre removidos antes de aplicar a sua tag, para que
a comissão não vá para quem postou a oferta.

- Se o formato `matt:` estiver incompleto, a aplicação não inicia.
- Se a variável estiver vazia, a aplicação exibe um aviso e publica os links
  **sem afiliação**.

### Variáveis do Telegram

- `TELEGRAM_BOT_TOKEN`: token do bot que publica no grupo de destino.
- `TELEGRAM_CHAT_ID`: ID do grupo onde as promoções serão publicadas.
- `TELEGRAM_API_ID` e `TELEGRAM_API_HASH`: credenciais da API do Telegram.
- `TELEGRAM_SOURCE_PHONE`: telefone da conta usada para monitorar as origens.
- `TELEGRAM_SOURCE_CHATS`: grupos ou canais que serão monitorados.
- `TELEGRAM_SOURCE_SESSION`: sessão serializada da conta de monitoramento.

### Variáveis do WhatsApp

- `WHATSAPP_GROUP_JID`: JID do grupo de destino no WhatsApp, no formato
  `<id>@g.us`. Deixe vazio para desabilitar a publicação no WhatsApp.

### Texto original da promoção

O bot publica a mensagem original do grupo de origem, removendo os links
encontrados nela (inclusive links sem `http`, como `meli.la/x` e `t.me/...`) e
linhas que ficariam só com um rótulo, como `🔗 Link:`. Em seguida acrescenta o
link afiliado processado no fim.

Se a mensagem tiver foto, ela é reenviada com a legenda cortada para caber no
limite do Telegram (1024 caracteres com foto, 4096 só texto). O link afiliado
nunca é cortado. Se o Telegram recusar a foto, a oferta é enviada só com o
texto.

`TELEGRAM_SOURCE_CHATS` deve usar usernames públicos ou IDs numéricos, sempre
separados por vírgula. Não use o nome exibido do grupo, especialmente se ele
tiver espaços ou caracteres especiais:

```env
TELEGRAM_SOURCE_CHATS=@grupovizinhos,@promoml,-1001234567890
```

O grupo de origem é o local que será rastreado. O grupo configurado em
`TELEGRAM_CHAT_ID` é o local onde o bot publicará as ofertas.

## Gerando a sessão do Telegram

A sessão deve ser gerada no seu computador, em um terminal interativo. Deixe
`TELEGRAM_SOURCE_SESSION` vazio e inicie a aplicação:

```powershell
npm install
npm run dev
```

Informe no terminal:

1. O código recebido no Telegram.
2. A senha de autenticação em duas etapas, caso esteja configurada.

O programa exibirá uma sessão serializada. Copie o valor completo para
`TELEGRAM_SOURCE_SESSION` no arquivo `.env` e reinicie a aplicação.

Depois disso, a aplicação não deverá pedir o código novamente. Nunca publique
o conteúdo da sessão, o token do bot ou o API Hash em repositórios ou chats.

Sem `TELEGRAM_SOURCE_SESSION` e sem terminal interativo (por exemplo, no
Railway), a aplicação encerra com uma mensagem explicando que a sessão precisa
ser gerada com `npm run dev`.

## Publicação no WhatsApp (opcional)

A publicação no WhatsApp é habilitada apenas quando `WHATSAPP_GROUP_JID` está
preenchido:

```env
WHATSAPP_GROUP_JID=<id>@g.us
```

A conta do WhatsApp conectada precisa participar desse grupo.

### Login por QR Code

Na primeira execução, um QR Code é exibido no terminal (ou nos logs do
Docker). No celular, abra o WhatsApp → **Dispositivos conectados** →
**Conectar dispositivo** e escaneie o código. A sessão é salva em
`.local/whatsapp-session/` e reutilizada nas próximas execuções.

### Comportamento

- O WhatsApp conecta em paralelo e nunca bloqueia nem atrasa a leitura e a
  publicação no Telegram: os envios vão para uma fila própria (até 50
  pendentes; acima disso, a oferta é publicada só no Telegram).
- Em quedas de conexão, a reconexão é automática, com espera crescente de 2
  segundos até 5 minutos.
- A publicação no WhatsApp é desativada (o Telegram continua normalmente) e o
  motivo aparece no log nestes casos:
  - logout da sessão (401);
  - sessão substituída por outra instância (440), por exemplo local e Docker
    ao mesmo tempo;
  - conexão recusada pelo WhatsApp (403);
  - sessão incompatível (411).
- Para logout ou sessão incompatível, apague `.local/whatsapp-session/` e
  reinicie para gerar um novo QR Code. Para sessão substituída, deixe apenas
  uma instância rodando e reinicie.
- Se o WhatsApp não estiver conectado no momento do envio, a mensagem é
  ignorada no WhatsApp e registrada no log.

## Execução local

Instale as dependências:

```powershell
npm install
```

Compile o projeto:

```powershell
npm run build
```

Execute em desenvolvimento:

```powershell
npm run dev
```

Execute a versão compilada:

```powershell
npm start
```

Rode os testes:

```powershell
npm test
```

O endpoint de verificação fica disponível em:

```text
http://localhost:3000
```

## Health check

`GET /health` responde:

- `200` com `{"telegram":"ok"}` se o Telegram foi lido com sucesso nos
  últimos 3 minutos;
- `503` com `{"telegram":"indisponível"}` caso contrário (inclusive durante a
  inicialização).

O `Dockerfile` usa esse endpoint no `HEALTHCHECK`. Se a inicialização do
Telegram falhar, o processo encerra com código `1` para que o Docker ou o
Railway o reinicie.

## Execução com Docker

A imagem usa build multi-stage com `node:22-slim` e roda como o usuário
`node`, sem privilégios de root.

O `docker-compose.yml` publica a porta interna `3000` na porta `3001` do
computador:

```yaml
ports:
  - "3001:3000"
```

Inicie ou recrie o serviço:

```powershell
docker compose up --build -d
```

Verifique o status (a coluna de status mostra `healthy` quando o `/health`
responde 200):

```powershell
docker compose ps
```

A aplicação estará disponível em:

```text
http://localhost:3001
http://localhost:3001/health
```

Acompanhe os logs (é aqui que aparece o QR Code do WhatsApp):

```powershell
docker compose logs -f promoliza-bot
```

Uma inicialização bem-sucedida deve mostrar mensagens semelhantes a:

```text
[HTTP] Servidor Web ativo na porta 3000
[TelegramSource] Conectado.
[TelegramSource] Monitorando 2 chat(s) de origem.
```

Pare o serviço:

```powershell
docker compose down
```

O container usa `restart: unless-stopped`, portanto pode permanecer ativo e
ser reiniciado automaticamente se o processo cair. Os logs são rotacionados
(3 arquivos de até 10 MB). Para funcionamento 24 horas, o computador ou
servidor que executa o Docker precisa permanecer ligado.

O compose também habilita `stdin_open` e `tty`, o que permite fazer o login do
Telegram com `docker attach promoliza_app` caso `TELEGRAM_SOURCE_SESSION`
ainda esteja vazio. Ainda assim, prefira gerar a sessão localmente com
`npm run dev`.

### Volume de dados

O compose monta o volume nomeado `promoliza_data` em `/app/.local`, onde
ficam o histórico de produtos e a sessão do WhatsApp. Sem esse volume, recriar
o container permite republicar ofertas e pede o QR Code novamente.

`docker compose down` mantém o volume. Para apagá-lo (perdendo histórico e
sessão do WhatsApp):

```powershell
docker volume rm promoliza_data
```

## Teste do fluxo

1. Confirme que a conta da sessão está no canal ou grupo de origem.
2. Confirme que o bot está no grupo de destino com permissão para enviar
   mensagens.
3. Execute `docker compose logs -f promoliza-bot`.
4. Aguarde uma nova publicação com um link do Mercado Livre.
5. Confirme que a mensagem foi publicada no grupo de destino (e no WhatsApp,
   se habilitado).

Só são acessados links dos domínios do Mercado Livre ou de encurtadores
conhecidos (lista `SHORTENER_HOSTS` em `src/services/link.service.ts`).
Qualquer outro link é ignorado sem ser acessado, e o host é verificado
novamente a cada redirecionamento. O destino final precisa ser do Mercado
Livre. Para não manter a comissão de quem postou a oferta, também são
ignorados links `meli.la` que não redirecionam e vitrines de afiliado
(`/social/...`).

Se o Telegram estiver indisponível para publicar (rede, erro 5xx, limite de
envio, token ou permissão do bot), a leitura é pausada e retomada depois, com
espera crescente de até 5 minutos, sem descartar nenhuma oferta. Só uma
mensagem que o próprio Telegram rejeita pelo conteúdo é descartada (com
registro no log).

Produtos já publicados nos últimos 30 dias também não são enviados novamente.
A duplicidade é verificada pelo ID MLB do produto, antes de encurtar o link,
então o mesmo produto vindo de grupos ou encurtadores diferentes conta como
repetido.

Antes da republicação, os links da mensagem original são removidos para evitar
que links de outros canais sejam enviados ao grupo de destino. O link afiliado
final é encurtado pelo is.gd; se o encurtador estiver indisponível, publica o
link afiliado completo.

## Persistência e produção

O histórico de produtos enviados é salvo em:

```text
.local/posted-products.json
```

Esse diretório está no `.gitignore` e no `.dockerignore`. Em servidores ou
plataformas como Railway, monte um volume persistente em `/app/.local`; sem
isso, um novo deploy pode apagar o histórico (permitindo republicações) e a
sessão do WhatsApp.

O histórico local não é um banco de dados e a fila de processamento não é
persistente. Para um ambiente de produção com múltiplas instâncias ou
reinícios frequentes, migre o histórico e a fila para PostgreSQL ou Redis.

### Deploy no Railway

O projeto pode ser publicado como um serviço Docker no Railway:

1. Crie um projeto em [railway.com](https://railway.com) e escolha **Deploy
   from GitHub Repo**.
2. Selecione este repositório. O Railway detectará o `Dockerfile`.
3. Configure as variáveis do `.env` em **Variables**, incluindo
   `TELEGRAM_SOURCE_SESSION` já gerada localmente. Não versione o `.env`.
4. Gere um domínio público e acesse `/health` para verificar o serviço.
5. Configure um volume montado em `/app/.local` para manter o histórico e a
   sessão do WhatsApp entre reinícios.

O Railway fornece a variável `PORT` automaticamente. O serviço já escuta essa
porta, portanto não é necessário fixar `PORT=3000` no ambiente de produção.

Para hospedar o processo continuamente, prefira uma VPS, Railway ou outro
serviço que mantenha processos de longa duração. Plataformas serverless, como
a Vercel, não são a escolha adequada para esta conexão permanente com o
Telegram.

## Segurança

- Nunca versione o arquivo `.env`.
- Nunca compartilhe `TELEGRAM_SOURCE_SESSION`: ela dá acesso total à conta.
- Nunca compartilhe `TELEGRAM_BOT_TOKEN` ou `TELEGRAM_API_HASH`.
- Nunca compartilhe nem versione `.local/whatsapp-session/`: quem tiver esses
  arquivos pode enviar mensagens pela sua conta do WhatsApp.
- Se alguma credencial do Telegram for exposta, revogue o token no BotFather,
  gere um novo API Hash em [my.telegram.org](https://my.telegram.org) e crie
  uma nova sessão da conta do Telegram.
- Se a sessão do WhatsApp for exposta, desconecte o aparelho em WhatsApp →
  **Dispositivos conectados**, apague `.local/whatsapp-session/` e escaneie um
  novo QR Code.
- Os erros registrados no log ocultam o token do bot.

## Palavras-chave

bot do Telegram, bot do WhatsApp, marketing de afiliados, links afiliados,
Mercado Livre, automação de ofertas, bot de cupons, Node.js, TypeScript.
