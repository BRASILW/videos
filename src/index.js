require('dotenv').config();

const http = require('http');
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Client,
  Events, GatewayIntentBits, PermissionFlagsBits, REST, Routes,
  SlashCommandBuilder
} = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const aiChannelId = '1551729250615304304';
const spamHistory = new Map();
const processedAiMessages = new Set();

if (!token) {
  console.error('Defina DISCORD_TOKEN no ambiente antes de iniciar o bot.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Discord bot online');
}).listen(Number(process.env.PORT) || 3000, '0.0.0.0');

const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Verifica se o bot esta online.'),
  new SlashCommandBuilder().setName('clear').setDescription('Apaga mensagens recentes.')
    .addIntegerOption(option => option.setName('quantidade').setDescription('De 1 a 100').setMinValue(1).setMaxValue(100).setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder().setName('kick').setDescription('Expulsa um membro.')
    .addUserOption(option => option.setName('membro').setDescription('Membro').setRequired(true))
    .addStringOption(option => option.setName('motivo').setDescription('Motivo'))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
  new SlashCommandBuilder().setName('ban').setDescription('Bane um membro.')
    .addUserOption(option => option.setName('membro').setDescription('Membro').setRequired(true))
    .addStringOption(option => option.setName('motivo').setDescription('Motivo'))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  new SlashCommandBuilder().setName('poll').setDescription('Cria uma enquete.')
    .addStringOption(option => option.setName('pergunta').setDescription('Pergunta').setRequired(true)),
  new SlashCommandBuilder().setName('ticket').setDescription('Cria um canal privado de suporte.'),
  new SlashCommandBuilder().setName('close').setDescription('Fecha o ticket atual.'),
  new SlashCommandBuilder().setName('role').setDescription('Adiciona ou remove um cargo.')
    .addSubcommand(command => command.setName('add').setDescription('Adiciona cargo')
      .addUserOption(option => option.setName('membro').setDescription('Membro').setRequired(true))
      .addRoleOption(option => option.setName('cargo').setDescription('Cargo').setRequired(true)))
    .addSubcommand(command => command.setName('remove').setDescription('Remove cargo')
      .addUserOption(option => option.setName('membro').setDescription('Membro').setRequired(true))
      .addRoleOption(option => option.setName('cargo').setDescription('Cargo').setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  new SlashCommandBuilder().setName('ask').setDescription('Pergunta para a IA.')
    .addStringOption(option => option.setName('pergunta').setDescription('Pergunta').setRequired(true))
].map(command => command.toJSON());

async function safeReply(message, content) {
  try { return await message.reply(content); } catch (error) {
    if (![10008, 50035].includes(error.code)) console.error('Falha ao responder:', error.message);
    return null;
  }
}

async function askAI(prompt) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Responda em portugues brasileiro de forma clara, educada e objetiva.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 600
    }),
    signal: AbortSignal.timeout(30000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'A API recusou a solicitacao.');
  return data.choices?.[0]?.message?.content?.trim() || 'Nao consegui gerar uma resposta.';
}

async function registerCommands(userId) {
  const rest = new REST({ version: '10' }).setToken(token);
  const route = process.env.GUILD_ID ? Routes.applicationGuildCommands(userId, process.env.GUILD_ID) : Routes.applicationCommands(userId);
  await rest.put(route, { body: commands });
}

client.once(Events.ClientReady, async readyClient => {
  try { await registerCommands(readyClient.user.id); } catch (error) { console.error('Nao foi possivel registrar comandos:', error.message); }
  console.log(`Bot conectado como ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isButton()) {
    if (interaction.customId === 'poll_yes' || interaction.customId === 'poll_no') return interaction.reply({ content: 'Voto registrado.', ephemeral: true });
    return;
  }
  if (!interaction.isChatInputCommand() || !interaction.guild) return;
  try {
    if (interaction.commandName === 'ping') return interaction.reply('Pong!');
    if (interaction.commandName === 'clear') {
      const deleted = await interaction.channel.bulkDelete(interaction.options.getInteger('quantidade'), true);
      return interaction.reply({ content: `${deleted.size} mensagens apagadas.`, ephemeral: true });
    }
    if (interaction.commandName === 'kick' || interaction.commandName === 'ban') {
      const member = interaction.options.getMember('membro');
      const reason = interaction.options.getString('motivo') || 'Sem motivo informado';
      if (!member?.moderatable) return interaction.reply({ content: 'Nao posso moderar esse membro.', ephemeral: true });
      if (interaction.commandName === 'kick') await member.kick(reason); else await member.ban({ reason });
      return interaction.reply(`Acao aplicada em ${member.user.tag}.`);
    }
    if (interaction.commandName === 'poll') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('poll_yes').setLabel('Sim').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('poll_no').setLabel('Nao').setStyle(ButtonStyle.Danger)
      );
      return interaction.reply({ content: `Enquete de ${interaction.user}:\n**${interaction.options.getString('pergunta')}**`, components: [row] });
    }
    if (interaction.commandName === 'ticket') {
      const name = `ticket-${interaction.user.id}`;
      const existing = interaction.guild.channels.cache.find(channel => channel.name === name);
      if (existing) return interaction.reply({ content: `Voce ja possui um ticket: ${existing}`, ephemeral: true });
      const channel = await interaction.guild.channels.create({ name, type: ChannelType.GuildText, permissionOverwrites: [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
      ] });
      return interaction.reply({ content: `Ticket criado: ${channel}`, ephemeral: true });
    }
    if (interaction.commandName === 'close') {
      if (!interaction.channel.name.startsWith('ticket-')) return interaction.reply({ content: 'Este comando so funciona em tickets.', ephemeral: true });
      await interaction.reply('Ticket sera fechado em 5 segundos.');
      return setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }
    if (interaction.commandName === 'role') {
      const member = interaction.options.getMember('membro');
      const role = interaction.options.getRole('cargo');
      if (!member || !role || role.managed) return interaction.reply({ content: 'Membro ou cargo invalido.', ephemeral: true });
      if (interaction.options.getSubcommand() === 'add') await member.roles.add(role); else await member.roles.remove(role);
      return interaction.reply('Cargo atualizado com sucesso.');
    }
    if (interaction.commandName === 'ask') {
      if (!process.env.OPENAI_API_KEY) return interaction.reply({ content: 'Configure OPENAI_API_KEY no Render.', ephemeral: true });
      await interaction.deferReply();
      return interaction.editReply(await askAI(interaction.options.getString('pergunta')));
    }
  } catch (error) {
    console.error('Erro no comando:', error.message);
    const reply = { content: 'Ocorreu um erro ao executar esse comando.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.editReply(reply).catch(() => {}); else await interaction.reply(reply).catch(() => {});
  }
});

client.on(Events.MessageCreate, async message => {
  if (message.author.bot || !message.guild) return;
  try {
    const now = Date.now();
    const history = (spamHistory.get(message.author.id) || []).filter(time => now - time < 10000);
    history.push(now);
    spamHistory.set(message.author.id, history);
    if (history.length >= 6 && message.member.moderatable) {
      await message.member.timeout(30000, 'Anti-spam').catch(() => {});
      spamHistory.delete(message.author.id);
    }
    if (message.content.trim().toLowerCase() === '!ping') return safeReply(message, 'Pong!');
    if (message.channel.id !== aiChannelId || processedAiMessages.has(message.id)) return;
    const mentionsBot = client.user && message.mentions.has(client.user.id);
    let repliesToBot = false;
    if (message.reference?.messageId) {
      const referencedMessage = await message.fetchReference().catch(() => null);
      repliesToBot = referencedMessage?.author?.id === client.user?.id;
    }
    if (!mentionsBot && !repliesToBot) return;
    processedAiMessages.add(message.id);
    setTimeout(() => processedAiMessages.delete(message.id), 60000);
    if (!process.env.OPENAI_API_KEY) return safeReply(message, 'A IA ainda nao foi configurada. Adicione OPENAI_API_KEY no Render.');
    const prompt = message.content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim() || 'Responda a esta mensagem.';
    return safeReply(message, (await askAI(prompt)).slice(0, 1900));
  } catch (error) { console.error('Erro ao processar mensagem:', error.message); }
});

client.on('error', error => console.error('Erro do cliente Discord:', error.message));
client.login(token).catch(error => {
  console.error('Nao foi possivel conectar ao Discord:', error.message);
  process.exit(1);
});