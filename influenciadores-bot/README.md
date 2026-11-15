# Bot de Influenciadores para Discord

## O que ele faz
- `!painel`: envia o painel de publicação (somente administradores).
- Membros com o cargo de configuração podem editar o título, a descrição, banner, thumbnail, rodapé, canal de publicação e cor dos botões.
- Botão "Publicar vídeo": abre formulário com links opcionais do TikTok e Instagram e anexo obrigatório de vídeo.
- O bot publica o vídeo enviado no canal configurado e identifica quem enviou.
- O cartão tem vídeo dentro de um container preto, nick do Discord, botões para TikTok e Instagram e contagem de curtidas.
- O botão "Ver curtidas" abre uma lista paginada com menções, sem notificar as pessoas.
- Botões para curtir/descurtir, comentar e ver os 10 comentários mais recentes.
- Curtidas e comentários ficam salvos em SQLite (`influenciadores.sqlite`).
- `!emj emoji nome` ou `!emj figurinha nome tag` adiciona um arquivo anexado ao servidor (somente conteúdo próprio ou autorizado; requer **Gerenciar expressões**).

## Instalação
1. Instale Node.js 22 LTS ou 24 LTS.
2. Extraia o ZIP.
3. Crie um arquivo `.env` na pasta do projeto e preencha `DISCORD_TOKEN` e `GUILD_ID`. `POST_CHANNEL_ID` é opcional. O ID do aplicativo é obtido automaticamente do bot autenticado. Use somente um token recém-gerado; nunca compartilhe ou versione o arquivo `.env`.
4. No Discord Developer Portal, ative **Message Content Intent** em Bot > Privileged Gateway Intents.
5. Convide o bot com os escopos `bot` e `applications.commands`.
6. Permissões recomendadas: View Channels, Send Messages, Embed Links, Attach Files, Read Message History. Para `!emj`, o usuário e o bot também precisam de **Manage Expressions**.
7. No terminal, dentro da pasta, execute:
   ```bash
   npm install
   npm start
   ```
8. No servidor, um administrador usa `!painel` para enviar o painel.

## Configuração pelo Discord
- Um membro com o cargo `1570091171848392825` usa `/configurar-painel` ou `!painel configurar`.
- O menu permite editar título, descrição, rodapé, banner, thumbnail e canal de publicações.
- A cor dos botões pode ser azul, cinza, verde ou vermelho.
- As alterações são salvas por servidor no SQLite e aplicadas automaticamente aos painéis e publicações existentes; não é necessário executar `!painel` novamente.
- O destaque dos cartões de publicação e a cor padrão do painel são pretos.

## Deploy no Render
Este bot fica isolado em `influenciadores-bot/` para não substituir o aplicativo já existente na raiz do repositório `BRASILW/videos`. Para usar o plano gratuito, crie um **Web Service** ligado à branch do bot e configure **Root Directory** como `influenciadores-bot`, `npm install` como Build Command e `npm start` como Start Command. Selecione o plano **Free** e defina `DISCORD_TOKEN` e `GUILD_ID` nas variáveis de ambiente do Render. O ID do aplicativo é obtido automaticamente do bot autenticado. `POST_CHANNEL_ID` é opcional.

O serviço expõe `/health` para o Render. O plano gratuito não mantém o bot sempre online: ele pode dormir após 15 minutos sem tráfego HTTP, e o banco SQLite local pode ser perdido quando o serviço reinicia ou dorme. Não use esta configuração se precisar de disponibilidade contínua ou preservar curtidas e comentários. Nunca salve tokens em arquivos do repositório. Como o token anterior foi exposto, revogue-o no Discord Developer Portal e gere um novo.

## Importante
- O formulário do Discord coleta os links e o vídeo de uma vez; use MP4, MOV, WEBM ou M4V.
- O bot precisa ter acesso ao canal de publicações.
- Para `!emj`, anexe o arquivo ao comando: emoji aceita PNG/JPG/GIF até 256 KB; figurinha aceita PNG/APNG/JSON/GIF até 512 KB. Exemplo: `!emj figurinha ola wave`.
- Em hospedagens sem disco persistente, o banco SQLite pode ser perdido em novos deploys, reinicializações ou períodos de suspensão.
- Este é um projeto-base. Adicione moderação e limites de uso conforme as regras do seu servidor.
