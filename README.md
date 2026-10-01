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

Comandos slash disponiveis: `/ping`, `/clear`, `/kick`, `/mute`, `/ban`, `/poll`, `/ticket`, `/close`, `/role`, `/botstatus` e `/packimport`.

Comandos slash de musica: `/play`, `/pause`, `/resume`, `/skip`, `/stop`, `/queue`, `/volume` e `/shuffle`. Comandos de texto com prefixo `!`: `!help`, `!ping`, `!oi`, `!dm`, `!horascall`, `!call`, `!entrar`, `!sair`, `!priv`, `!regras2`, `!match`, `!metch`, `!clear`, `!kick`, `!mute`, `!ban`, `!play`, `!pause`, `!resume`, `!skip`, `!stop`, `!queue`, `!volume`, `!shuffle` e os comandos `!rank...`. Nos comandos que recebem um usuario, use uma mencao ou o ID numerico do Discord.

Os comandos de musica precisam de um servidor Lavalink v4.2+ separado do processo do bot. Configure `LAVALINK_HOST`, `LAVALINK_PORT`, `LAVALINK_PASSWORD` e `LAVALINK_SECURE` nas variaveis do Render e mantenha a senha igual a do servidor Lavalink. `LAVALINK_SEARCH_PREFIX` define o provedor de busca (padrao `ytsearch:`); links diretos funcionam quando o servidor tem o source/plugin correspondente configurado. Servidores Lavalink recentes podem precisar de plugin de fonte do YouTube para buscas e reproducao do YouTube. A fila aceita ate 100 faixas, limita uma playlist a 50 faixas e comeca com volume 70%. Sem um Lavalink conectado, os comandos explicam a configuracao pendente.

Administradores e gerentes do servidor podem alterar o perfil do bot com `/botstatus` ou `!botstatus <online|idle|dnd|invisible> <playing|watching|listening|competing|none> [texto]`. A atividade atual da musica substitui temporariamente o texto fixo do perfil e volta ao status configurado quando a fila termina. Configure `BOT_STATUS`, `BOT_ACTIVITY_TYPE` e `BOT_ACTIVITY_TEXT` para definir o padrao no Render. Mudancas feitas por comando sao salvas no PostgreSQL quando `DATABASE_URL` esta configurada; sem banco, sao salvas no arquivo local, que pode nao persistir entre reinicios ou deploys do Render.

Para importar um pack, anexe um ZIP a `!packimport` ou use `/packimport`. Coloque imagens em pastas de primeiro nivel `emojis/` e `stickers/`; nomes dos arquivos viram nomes das expressoes. O importador aceita ate 10 MiB por ZIP, 100 imagens e 512 KiB por imagem, processa um arquivo por vez e nunca apaga expressoes existentes. Emojis aceitam PNG/JPG/GIF; figurinhas aceitam PNG/APNG com 320x320 pixels. A criacao depende dos limites de expressoes do servidor e da permissao **Create Expressions** ou **Manage Expressions** para o bot e para quem executa o comando. Em mensagens prefixadas, anexe o ZIP na mesma mensagem de `!packimport`.

`!mute <usuario> <duracao> [motivo] [link de prova]` usa o timeout nativo do Discord, bloqueando mensagens e voz pelo tempo indicado. Duracoes aceitas incluem `30m`, `4h`, `2d` e `1w`, ate o limite de 28 dias. Tambem e possivel anexar a prova na mensagem do comando. `!ban <usuario> [motivo] [link de prova]` aceita prova opcional da mesma forma. Slash `/mute` e `/ban` tambem oferecem campos de link e anexo.

Todos os registros de mute, ban e expulsao sao enviados para `1555033295648198657` (ou para o valor de `MODERATION_LOG_CHANNEL_ID`) e usam embed vermelho. As entradas de novos membros sao publicadas em `1554638389351940177` (ou em `WELCOME_CHANNEL_ID`), tambem em vermelho, com mencao, ID, avatar, data de criacao da conta e convidador identificado pelo convite usado. Para identificar o convidador, o bot precisa da permissao **Manage Server**; sem ela, a entrada ainda e publicada, mas o convidador aparece como nao identificado. O bot tambem precisa de permissao para ver e enviar mensagens nos dois canais. Os comandos `!dm` apagam a mensagem do canal antes de enviar o PV, e enviam a confirmacao/erros por mensagem direta ao moderador. Para isso, o bot precisa de permissao para gerenciar mensagens no canal, e o moderador precisa aceitar mensagens diretas do bot.

Em canais do servidor, o bot responde automaticamente quando alguem o menciona ou responde a uma mensagem dele; ao responder, a mensagem anterior do bot e incluida como contexto. A integracao padrao suporta Gemini `gemini-2.5-flash` pela cota gratuita do Google AI Studio. Crie uma chave em https://aistudio.google.com/apikey e configure `GEMINI_API_KEY` nas variaveis de ambiente do Render. A chave nunca deve ser enviada ao GitHub. A cota gratuita tem limites, pode mudar, e os dados podem ser usados pelo Google para melhorar produtos conforme os termos do nivel gratuito; nao envie dados sensiveis.

`AI_PROVIDER=gemini` seleciona Gemini; `GEMINI_MODEL` pode mudar o modelo. Para manter OpenAI, configure `AI_PROVIDER=openai`, `OPENAI_API_KEY` e opcionalmente `OPENAI_MODEL`. Sem `AI_PROVIDER`, o bot escolhe Gemini quando encontra uma `GEMINI_API_KEY`; caso contrario tenta OpenAI. Se `AI_PROVIDER=openai` estiver definido, mas faltar uma chave OpenAI valida e houver uma chave Gemini valida, o bot usa Gemini automaticamente. No Render, configure `AI_PROVIDER=gemini` e `GEMINI_API_KEY` para ativar o plano gratuito.

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
