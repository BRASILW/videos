# Discord Bot

Bot basico usando Node.js e discord.js.

## Configuracao

1. Instale o Node.js 18 ou superior.
2. Copie `.env.example` para `.env`.
3. No arquivo `.env`, defina `DISCORD_TOKEN` com um token novo gerado no Discord Developer Portal.
4. No portal, habilite o **Message Content Intent** em **Bot > Privileged Gateway Intents**.
5. Convide o bot para um servidor usando OAuth2 com os escopos `bot` e `applications.commands`, concedendo pelo menos `View Channel` e `Send Messages`.

## Executar

```powershell
npm install
npm start
```

O bot responde `Pong!` quando alguem envia `!ping`.

Nunca compartilhe o token e nunca o envie para o Git.

## Funcoes

Comandos slash disponiveis: `/ping`, `/clear`, `/kick`, `/ban`, `/poll`, `/ticket`, `/close`, `/role`, `/play`, `/skip` e `/stop`.

O comando `/ask` usa IA somente quando `OPENAI_API_KEY` estiver configurada. `LOG_CHANNEL_ID` ativa logs de mensagens apagadas e moderacao. O anti-spam aplica timeout de 30 segundos apos seis mensagens em dez segundos.

No Discord Developer Portal, ative **Message Content Intent**, **Server Members Intent** e conceda ao bot permissoes de gerenciamento, voz e canais conforme os comandos usados.

## Executar com Docker

```powershell
docker build -t discord-bot .
docker run -d --name discord-bot --restart unless-stopped --env DISCORD_TOKEN=seu_token_novo discord-bot
```

Em uma VPS, instale Docker, copie o projeto, execute esses comandos e mantenha o servidor ligado. O token deve ser informado diretamente como variavel de ambiente.
