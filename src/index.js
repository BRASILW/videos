require('dotenv').config();

const { Client, GatewayIntentBits, Events } = require('discord.js');

const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error('Defina DISCORD_TOKEN no arquivo .env antes de iniciar o bot.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.once(Events.ClientReady, readyClient => {
  console.log(`Bot conectado como ${readyClient.user.tag}`);
});

client.on(Events.MessageCreate, message => {
  if (message.author.bot) return;

  if (message.content.trim().toLowerCase() === '!ping') {
    message.reply('Pong!');
  }
});

client.login(token).catch(error => {
  console.error('Nao foi possivel conectar ao Discord:', error.message);
  process.exit(1);
});
