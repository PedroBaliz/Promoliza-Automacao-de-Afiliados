# Promoliza

Bot que monitora canais e grupos do Telegram usando uma conta de usuário,
identifica links do Mercado Livre, converte esses links para afiliado e
republica as promoções em um grupo de destino usando um bot do Telegram.

## Funcionalidades

- Monitoramento contínuo de um ou mais grupos/canais do Telegram.
- Leitura de novas mensagens recebidas após a conexão do serviço.
- Extração de URLs presentes no texto das mensagens.
- Resolução de redirecionamentos limitados.
- Filtro para aceitar somente links dos domínios do Mercado Livre.
- Conversão do link para o formato de afiliado configurado.
- Remoção dos links da mensagem original antes da republicação.
- Encurtamento do link afiliado publicado no grupo de destino.
- Reenvio da mensagem para um grupo de destino.
- Prevenção de republicação do mesmo link por 30 dias.
- Persistência local do histórico de links publicados.
- Endpoint HTTP simples para verificar se a aplicação está ativa.
- Execução local, via Docker ou em um servidor 24 horas.

> O serviço não lê mensagens antigas anteriores ao início do monitoramento.
> A conta usada na sessão precisa conseguir visualizar os grupos ou canais de
> origem.

## Fluxo da aplicação

```text
Grupo/canal de origem
        |
        v
TelegramSourceService (conta de usuário)
        |
        v
Extração, resolução e encurtamento do link
        |
        v
Conversão para link de afiliado
        |
        v
DatabaseService verifica duplicidade
        |
        v
TelegramProvider publica com o bot
        |
        v
Grupo de destino
```

O monitoramento usa uma sessão de usuário do Telegram porque bots não
conseguem acessar todos os grupos e canais da mesma forma que uma conta
normal. A publicação é feita separadamente pelo token do bot.

## Arquitetura de pastas

```text
.
├── dist/                           # JavaScript compilado; gerado pelo build
├── node_modules/                   # Dependências instaladas; gerado pelo npm
├── src/
│   ├── config/
│   │   ├── env.config.ts            # Leitura e normalização das variáveis
│   │   └── tokens.json              # Configuração local de tokens
│   ├── providers/
│   │   └── telegram.provider.ts     # Publicação via Telegram Bot API
│   ├── services/
│   │   ├── database.service.ts      # Controle de duplicidade e persistência
│   │   ├── gemini.service.ts        # Geração das legendas com Gemini
│   │   ├── link.service.ts          # Extração, resolução e encurtamento de URLs
│   │   └── telegram-source.service.ts # Monitoramento via conta de usuário
│   ├── types/
│   │   └── index.ts                 # Tipos de produtos e mensagens
│   ├── utils/
│   │   └── affiliate.ts             # Construção do link afiliado
│   └── index.ts                     # Inicialização do HTTP e do monitoramento
├── state/                           # Diretório reservado para estado da aplicação
├── .dockerignore                    # Arquivos ignorados no contexto do Docker
├── .env                             # Variáveis locais e segredos; não versionar
├── .env.example                     # Modelo de variáveis de ambiente
├── .gitignore                       # Arquivos ignorados pelo Git
├── Dockerfile                       # Imagem de produção
├── docker-compose.yml               # Execução do serviço com Docker
├── package-lock.json                # Versões exatas das dependências
├── package.json                     # Scripts e dependências
└── tsconfig.json                    # Configuração do TypeScript
```

`dist/` e `node_modules/` aparecem depois da instalação e da compilação, mas
são diretórios gerados e não fazem parte do código-fonte principal. O arquivo
`.local/posted-products.json` é criado em tempo de execução para registrar
links já publicados; ele pode não existir antes da primeira oferta processada.

## Pré-requisitos

- Node.js 20 ou superior para execução local.
- Docker Desktop e Docker Compose para execução em container.
- Uma conta do Telegram inscrita nos grupos/canais de origem.
- Um bot do Telegram criado pelo BotFather.
- API ID e API Hash obtidos em [my.telegram.org](https://my.telegram.org).
- Um grupo de destino onde o bot possa enviar mensagens.

## Configuração do ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
PORT=3000
NODE_ENV=production

ML_AFFILIATE_TAG=seu_tag_de_afiliado
GEMINI_API_KEY=sua_chave_da_api_do_gemini
GEMINI_MODEL=gemini-2.0-flash
# Opcional: personalize o comportamento das legendas
GEMINI_PROMPT=Escreva uma legenda curta e persuasiva em português do Brasil.

TELEGRAM_BOT_TOKEN=token_do_seu_bot
TELEGRAM_CHAT_ID=-1001234567890

TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=seu_api_hash
TELEGRAM_SOURCE_PHONE=+5511999999999
TELEGRAM_SOURCE_CHATS=@canal1,@grupo2
TELEGRAM_SOURCE_SESSION=
```

### Variáveis do Telegram

- `TELEGRAM_BOT_TOKEN`: token do bot que publica no grupo de destino.
- `TELEGRAM_CHAT_ID`: ID do grupo onde as promoções serão publicadas.
- `TELEGRAM_API_ID` e `TELEGRAM_API_HASH`: credenciais da API do Telegram.
- `TELEGRAM_SOURCE_PHONE`: telefone da conta usada para monitorar as origens.
- `TELEGRAM_SOURCE_CHATS`: grupos ou canais que serão monitorados.
- `TELEGRAM_SOURCE_SESSION`: sessão serializada da conta de monitoramento.

### Legendas com Gemini

As legendas são geradas pelo Gemini a partir do texto limpo da promoção. A
chave deve ficar somente no `.env` ou nas variáveis secretas do servidor:

- `GEMINI_API_KEY`: chave da API Gemini.
- `GEMINI_MODEL`: modelo usado na geração; por padrão, `gemini-2.0-flash`.
- `GEMINI_PROMPT`: instruções opcionais para definir seu estilo de autoria.

Se a chave não estiver configurada ou a API falhar, a aplicação registra o erro
e não publica a oferta com uma legenda não processada.

`TELEGRAM_SOURCE_CHATS` deve usar usernames públicos ou IDs numéricos, sempre
separados por vírgula. Não use o nome exibido do grupo, especialmente se ele
tiver espaços ou caracteres especiais:

```env
TELEGRAM_SOURCE_CHATS=@cuponsdomeli,@urubupromo,-1001234567890
```

O grupo de origem é o local que será rastreado. O grupo configurado em
`TELEGRAM_CHAT_ID` é o local onde o bot publicará as ofertas.

## Gerando a sessão do Telegram

Na primeira execução, deixe `TELEGRAM_SOURCE_SESSION` vazio e inicie a
aplicação:

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

O endpoint de verificação fica disponível em:

```text
http://localhost:3000
```

## Execução com Docker

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

Verifique o status:

```powershell
docker compose ps
```

A aplicação estará disponível em:

```text
http://localhost:3001
```

Acompanhe os logs:

```powershell
docker compose logs -f promoliza-bot
```

Uma inicialização bem-sucedida deve mostrar mensagens semelhantes a:

```text
[HTTP] Servidor Web ativo na porta 3000
[TelegramSource] Conectado.
```

Pare o serviço:

```powershell
docker compose down
```

O container usa `restart: unless-stopped`, portanto pode permanecer ativo e
ser reiniciado automaticamente se o processo cair. Para funcionamento 24
horas, o computador ou servidor que executa o Docker precisa permanecer ligado.

## Teste do fluxo

1. Confirme que a conta da sessão está no canal ou grupo de origem.
2. Confirme que o bot está no grupo de destino com permissão para enviar
   mensagens.
3. Execute `docker compose logs -f promoliza-bot`.
4. Aguarde uma nova publicação com um link do Mercado Livre.
5. Confirme que a mensagem foi publicada no grupo de destino.

Links que não pertencem aos domínios aceitos do Mercado Livre são ignorados.
Links já publicados dentro do período de retenção também não são enviados
novamente.

Antes da republicação, os links da mensagem original são removidos para evitar
que links de outros canais sejam enviados ao grupo de destino. O link afiliado
final é encurtado pelo serviço is.gd. Se o encurtador estiver indisponível, a
aplicação registra o erro e publica o link afiliado completo.

## Persistência e produção

O histórico de links enviados é salvo em:

```text
.local/posted-products.json
```

Esse diretório está no `.gitignore`. Em servidores ou plataformas como Railway,
monte um volume persistente em `/app/.local`; sem isso, um novo deploy pode
apagar o histórico e permitir republicações.

Para hospedar o processo continuamente, prefira uma VPS, Railway ou outro
serviço que mantenha processos de longa duração. Plataformas serverless, como
a Vercel, não são adequadas para a conexão permanente com o Telegram.

## Segurança

- Nunca versione o arquivo `.env`.
- Nunca compartilhe `TELEGRAM_SOURCE_SESSION`.
- Nunca compartilhe `TELEGRAM_BOT_TOKEN` ou `TELEGRAM_API_HASH`.
- Se alguma credencial for exposta, revogue o token no BotFather e gere uma
  nova sessão da conta do Telegram.
