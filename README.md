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

Comandos slash disponiveis: `/ping`, `/clear`, `/kick`, `/mute`, `/ban`, `/poll`, `/ticket`, `/close` e `/role`.

Comandos de texto com prefixo `!`: `!help`, `!ping`, `!oi`, `!dm`, `!horascall`, `!call`, `!entrar`, `!sair`, `!priv`, `!regras2`, `!match`, `!metch`, `!clear`, `!kick`, `!mute`, `!ban` e os comandos `!rank...`. Nos comandos que recebem um usuario, use uma mencao ou o ID numerico do Discord.

`!mute <usuario> <duracao> [motivo] [link de prova]` usa o timeout nativo do Discord, bloqueando mensagens e voz pelo tempo indicado. Duracoes aceitas incluem `30m`, `4h`, `2d` e `1w`, ate o limite de 28 dias. Tambem e possivel anexar a prova na mensagem do comando. `!ban <usuario> [motivo] [link de prova]` aceita prova opcional da mesma forma. Slash `/mute` e `/ban` tambem oferecem campos de link e anexo.

Configure `MUTE_LOG_CHANNEL_ID` e `BAN_LOG_CHANNEL_ID` para canais de registro diferentes. Sem esses IDs, o bot tenta encontrar `#mute` e `#ban`, e depois usa `LOG_CHANNEL_ID`. Os comandos `!dm` apagam a mensagem do canal antes de enviar o PV, e enviam a confirmacao/erros por mensagem direta ao moderador. Para isso, o bot precisa de permissao para gerenciar mensagens no canal, e o moderador precisa aceitar mensagens diretas do bot.

No canal `1551729250615304304`, o bot responde automaticamente quando alguem menciona o bot ou responde a uma mensagem dele. A integracao padrao agora suporta Gemini `gemini-2.5-flash` pela cota gratuita do Google AI Studio. Crie uma chave em https://aistudio.google.com/apikey e configure `GEMINI_API_KEY` nas variaveis de ambiente do Render. A chave nunca deve ser enviada ao GitHub. A cota gratuita tem limites, pode mudar, e os dados podem ser usados pelo Google para melhorar produtos conforme os termos do nivel gratuito; nao envie dados sensiveis.

`AI_PROVIDER=gemini` seleciona Gemini; `GEMINI_MODEL` pode mudar o modelo. Para manter OpenAI, configure `AI_PROVIDER=openai`, `OPENAI_API_KEY` e opcionalmente `OPENAI_MODEL`. Sem `AI_PROVIDER`, o bot escolhe Gemini quando encontra uma `GEMINI_API_KEY`; caso contrario tenta OpenAI.

A IA aceita conversa informal e palavroes comuns sem repreender os usuarios por isso. Nao e possivel prometer respostas totalmente sem filtros: o provedor pode bloquear certos conteudos, e o bot evita ataques discriminatorios, ameacas e incentivo a violencia.

O comando `/ask` usa o provedor de IA configurado. `LOG_CHANNEL_ID` ativa logs de mensagens apagadas e moderacao. O anti-spam aplica timeout de 30 segundos apos seis mensagens em dez segundos.

No Discord Developer Portal, ative **Message Content Intent**, **Server Members Intent** e conceda ao bot permissoes de gerenciamento, voz e canais conforme os comandos usados.

Para os comandos `/` aparecerem imediatamente, configure `GUILD_ID` com o ID do seu servidor. Sem essa variavel, os comandos sao globais e podem levar ate uma hora para aparecer.

## Executar com Docker

```powershell
docker build -t discord-bot .
docker run -d --name discord-bot --restart unless-stopped --env DISCORD_TOKEN=seu_token_novo discord-bot
```

Em uma VPS, instale Docker, copie o projeto, execute esses comandos e mantenha o servidor ligado. O token deve ser informado diretamente como variavel de ambiente.
