# Promoliza

Bot que lê promoções de grupos autorizados do Telegram usando a conta do usuário,
converte links do Mercado Livre para o formato de afiliado configurado e publica
as ofertas no grupo de destino usando um bot do Telegram.

## Configuração do leitor do Telegram

Além das credenciais do bot, configure no `.env`:

```env
TELEGRAM_API_ID=seu_api_id
TELEGRAM_API_HASH=seu_api_hash
TELEGRAM_SOURCE_PHONE=+5511999999999
TELEGRAM_SOURCE_CHATS=@grupo1,@canal2
TELEGRAM_SOURCE_SESSION=
```

`TELEGRAM_API_ID` e `TELEGRAM_API_HASH` são obtidos em
[my.telegram.org](https://my.telegram.org). A conta usada em
`TELEGRAM_SOURCE_PHONE` precisa estar autorizada nos grupos de origem.

Na primeira execução, informe o código recebido no Telegram e a senha 2FA, se
existir. O programa exibirá uma sessão; salve esse valor em
`TELEGRAM_SOURCE_SESSION` para não repetir o login.

O leitor aceita somente links finais dos domínios do Mercado Livre, resolve
redirecionamentos limitados e evita republicar o mesmo link por 30 dias.

## Execução

```bash
npm install
npm run dev
```
