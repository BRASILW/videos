require('dotenv').config();

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');
const {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel
} = require('@discordjs/voice');
const play = require('play-dl');

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Defina DISCORD_TOKEN no ambiente antes de iniciar o bot.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const spamHistory = new Map();
const musicQueues = new Map();

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
  new SlashCommandBuilder().setName('role').setDescription('Adiciona ou remove um cargo de um membro.')
    .addSubcommand(subcommand => subcommand.setName('add').setDescription('Adiciona cargo')
      .addUserOption(option => option.setName('membro').setDescription('Membro').setRequired(true))
      .addRoleOption(option => option.setName('cargo').setDescription('Cargo').setRequired(true)))
    .addSubcommand(subcommand => subcommand.setName('remove').setDescription('Remove cargo')
      .addUserOption(option => option.setName('membro').setDescription('Membro').setRequired(true))
      .addRoleOption(option => option.setName('cargo').setDescription('Cargo').setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  new SlashCommandBuilder().setName('ask').setDescription('Pergunta para a IA, se configurada.')
    .addStringOption(option => option.setName('pergunta').setDescription('Sua pergunta').setRequired(true)),
  new SlashCommandBuilder().setName('play').setDescription('Toca uma URL de audio no canal de voz.')
    .addStringOption(option => option.setName('url').setDescription('URL do YouTube ou fonte suportada').setRequired(true)),
  new SlashCommandBuilder().setName('skip').setDescription('Pula a musica atual.'),
  new SlashCommandBuilder().setName('stop').setDescription('Para a musica e sai do canal.')
].map(command => command.toJSON());

async function playNext(guildId) {
  const queue = musicQueues.get(guildId);
  if (!queue || queue.items.length === 0) {
    queue?.connection.destroy();
    musicQueues.delete(guildId);
    return;
  }
  const item = queue.items.shift();
  try {
    const stream = await play.stream(item.url, { quality: 2 });
    queue.player.play(createAudioResource(stream.stream, { inputType: stream.type }));
    await queue.textChannel.send(`Tocando: ${item.url}`);
  } catch (error) {
    await queue.textChannel.send(`Nao foi possivel tocar essa URL: ${error.message}`);
    await playNext(guildId);
  }
}

async function registerCommands(userId) {
  const rest = new REST({ version: '10' }).setToken(token);
  if (process.env.GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(userId, process.env.GUILD_ID), { body: commands });
    return;
  }
  const route = Routes.applicationCommands(userId);
  const existing = await rest.get(route);
  const preservedCommands = existing.filter(command => command.type !== 1);
  await rest.put(route, { body: [...commands, ...preservedCommands] });
}

client.once(Events.ClientReady, async readyClient => {
  try {
    await registerCommands(readyClient.user.id);
  } catch (error) {
    console.error('Nao foi possivel registrar os comandos slash:', error.message);
  }
  console.log(`Bot conectado como ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isButton()) {
    if (interaction.customId === 'poll_yes' || interaction.customId === 'poll_no') {
      return interaction.reply({ content: 'Voto registrado.', ephemeral: true });
    }
    return;
  }
  if (!interaction.isChatInputCommand() || !interaction.guild) return;

  try {
    if (interaction.commandName === 'ping') return interaction.reply('Pong!');

    if (interaction.commandName === 'clear') {
      const messages = await interaction.channel.bulkDelete(interaction.options.getInteger('quantidade'), true);
      return interaction.reply({ content: `${messages.size} mensagens apagadas.`, ephemeral: true });
    }

    if (['kick', 'ban'].includes(interaction.commandName)) {
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
      const channel = await interaction.guild.channels.create({
        name,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
        ]
      });
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
      if (!process.env.OPENAI_API_KEY) return interaction.reply({ content: 'Configure OPENAI_API_KEY para ativar a IA.', ephemeral: true });
      await interaction.deferReply();
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', messages: [{ role: 'user', content: interaction.options.getString('pergunta') }], max_tokens: 500 })
      });
      const data = await response.json();
      return interaction.editReply(data.choices?.[0]?.message?.content || 'A IA nao retornou resposta.');
    }

    if (['play', 'skip', 'stop'].includes(interaction.commandName)) {
      const voiceChannel = interaction.member.voice.channel;
      if (!voiceChannel) return interaction.reply({ content: 'Entre em um canal de voz primeiro.', ephemeral: true });
      let queue = musicQueues.get(interaction.guildId);
      if (!queue) {
        const connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId: interaction.guildId, adapterCreator: interaction.guild.voiceAdapterCreator });
        const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
        connection.subscribe(player);
        queue = { connection, player, items: [], textChannel: interaction.channel };
        musicQueues.set(interaction.guildId, queue);
        player.on(AudioPlayerStatus.Idle, () => playNext(interaction.guildId));
        connection.on(VoiceConnectionStatus.Disconnected, () => musicQueues.delete(interaction.guildId));
      }
      if (interaction.commandName === 'play') {
        queue.items.push({ url: interaction.options.getString('url') });
        if (queue.player.state.status === AudioPlayerStatus.Idle) await playNext(interaction.guildId);
        return interaction.reply('Musica adicionada a fila.');
      }
      if (interaction.commandName === 'skip') {
        queue.player.stop();
        return interaction.reply('Musica pulada.');
      }
      queue.items = [];
      queue.player.stop();
      queue.connection.destroy();
      musicQueues.delete(interaction.guildId);
      return interaction.reply('Musica parada.');
    }
  } catch (error) {
    console.error('Erro no comando:', error);
    const reply = { content: 'Ocorreu um erro ao executar esse comando.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.editReply(reply).catch(() => {}); else await interaction.reply(reply).catch(() => {});
  }
});

client.on(Events.MessageCreate, async message => {
  if (message.author.bot || !message.guild) return;
  const now = Date.now();
  const history = (spamHistory.get(message.author.id) || []).filter(time => now - time < 10000);
  history.push(now);
  spamHistory.set(message.author.id, history);
  if (history.length >= 6 && message.member.moderatable) {
    await message.member.timeout(30000, 'Anti-spam').catch(() => {});
    spamHistory.delete(message.author.id);
  }
  if (message.content.trim().toLowerCase() === '!ping') await message.reply('Pong!');
});

client.on(Events.MessageDelete, message => {
  if (!message.guild || message.author?.bot || !process.env.LOG_CHANNEL_ID) return;
  const channel = message.guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
  if (channel?.isTextBased()) channel.send(`Mensagem apagada em #${message.channel.name}.`).catch(() => {});
});

client.login(token).catch(error => {
  console.error('Nao foi possivel conectar ao Discord:', error.message);
  process.exit(1);
});
