require("dotenv").config();

const http = require("node:http");
const {
  Client, GatewayIntentBits, Partials, REST, Routes,
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder,
  TextInputStyle, AttachmentBuilder, FileUploadBuilder, LabelBuilder,
  ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder,
  TextDisplayBuilder, StringSelectMenuBuilder, MessageFlags, PermissionFlagsBits
} = require("discord.js");
const Database = require("better-sqlite3");
const {
  entersState, joinVoiceChannel, VoiceConnectionStatus
} = require("@discordjs/voice");

const required = ["DISCORD_TOKEN", "GUILD_ID"];
const voiceChannelId = "1571359738682286161";
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Está faltando a variável ${key}. Configure-a no ambiente ou no arquivo .env local.`);
    process.exit(1);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const db = new Database(process.env.DATABASE_PATH || "influenciadores.sqlite");
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    author_id TEXT NOT NULL,
    discord_nick TEXT NOT NULL DEFAULT '',
    video_url TEXT NOT NULL,
    video_name TEXT NOT NULL,
    tiktok_url TEXT,
    instagram_url TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS likes (
    post_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (post_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT NOT NULL,
    setting_key TEXT NOT NULL,
    setting_value TEXT NOT NULL,
    PRIMARY KEY (guild_id, setting_key)
  );
  CREATE TABLE IF NOT EXISTS panel_messages (
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, message_id)
  );
  CREATE TABLE IF NOT EXISTS active_mutes (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    role_added_by_bot INTEGER NOT NULL,
    voice_mute_added_by_bot INTEGER,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS guild_invite_uses (
    guild_id TEXT NOT NULL,
    invite_code TEXT NOT NULL,
    uses INTEGER NOT NULL,
    PRIMARY KEY (guild_id, invite_code)
  );
`);

const activeMuteColumns = db.pragma("table_info(active_mutes)");
if (!activeMuteColumns.some(column => column.name === "voice_mute_added_by_bot")) {
  db.exec("ALTER TABLE active_mutes ADD COLUMN voice_mute_added_by_bot INTEGER");
}

const postColumns = db.pragma("table_info(posts)");
if (!postColumns.some(column => column.name === "discord_nick")) {
  db.exec("ALTER TABLE posts ADD COLUMN discord_nick TEXT NOT NULL DEFAULT ''");
}

const defaultPanelTitle = "Painel de Influenciadores";
const defaultPanelDescription =
  "Clique no botão para enviar sua publicação. Informe seus links do TikTok e Instagram e anexe o vídeo no formulário.";
const defaultPanelFooter = "Publique apenas vídeos que você tem autorização para divulgar.";
const defaultPanelColor = 0x000000;
const configRoleId = "1570091171848392825";
const muteRoleId = "1571368553926369361";
const muteLogChannelId = "1571282224660357182";
const maxMuteDurationMs = 28 * 24 * 60 * 60 * 1000;
const buttonStyles = {
  Primary: ButtonStyle.Primary,
  Secondary: ButtonStyle.Secondary,
  Success: ButtonStyle.Success,
  Danger: ButtonStyle.Danger
};

db.prepare(`
  UPDATE guild_settings SET setting_value = '000000'
  WHERE setting_key = 'panel_color' AND lower(setting_value) = '9b59b6'
`).run();

const commands = [
  new SlashCommandBuilder()
    .setName("painel")
    .setDescription("Envia o painel para publicar vídeos")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName("configurar-painel")
    .setDescription("Abre as configurações do painel"),
  new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Silencia um membro temporariamente sem removê-lo da call")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addStringOption(option => option
      .setName("membro")
      .setDescription("Menção ou ID do membro")
      .setRequired(true)
      .setMaxLength(30))
    .addStringOption(option => option
      .setName("tempo")
      .setDescription("Duração, por exemplo 1h ou 2d (máximo 28d)")
      .setRequired(true)
      .setMaxLength(4))
    .addStringOption(option => option
      .setName("motivo")
      .setDescription("Motivo do mute")
      .setRequired(true)
      .setMaxLength(512)),
  new SlashCommandBuilder()
    .setName("unmute")
    .setDescription("Remove o mute temporário de um membro")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addStringOption(option => option
      .setName("membro")
      .setDescription("Menção ou ID do membro")
      .setRequired(true)
      .setMaxLength(30))
    .addStringOption(option => option
      .setName("motivo")
      .setDescription("Motivo para remover o mute")
      .setRequired(false)
      .setMaxLength(512))
];

function parseMuteDuration(value) {
  const match = /^([1-9]\d*)([hd])$/i.exec(value.trim());
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const milliseconds = amount * (unit === "h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000);
  if (!Number.isSafeInteger(milliseconds) || milliseconds > maxMuteDurationMs) return null;

  return { milliseconds, label: `${amount}${unit}` };
}

function parseMemberId(value) {
  const trimmed = value.trim();
  const mention = trimmed.match(/^<@!?(\d+)>$/);
  if (mention) return mention[1];
  return /^\d{17,20}$/.test(trimmed) ? trimmed : null;
}

function createMuteLogEmbed({ guild, title, userId, moderatorId, reason, duration, expiresAt }) {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(title)
    .addFields(
      { name: "👤 Membro", value: `<@${userId}>`, inline: true },
      { name: "ID do membro", value: `\`${userId}\``, inline: true },
      { name: "⏳ Tempo", value: duration, inline: true },
      { name: "📝 Motivo", value: reason },
      { name: "🛡️ Moderador", value: `<@${moderatorId}>`, inline: true },
      { name: "ID do moderador", value: `\`${moderatorId}\``, inline: true }
    )
    .setFooter({ text: guild.name })
    .setTimestamp();

  if (expiresAt) {
    embed.addFields({
      name: "Vencimento",
      value: `<t:${Math.floor(expiresAt / 1000)}:F> • <t:${Math.floor(expiresAt / 1000)}:R>`
    });
  }

  return embed;
}

function createMuteDmEmbed({ guild, reason, duration, expiresAt }) {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("Você recebeu um silenciamento temporário")
    .setDescription(`Seu acesso foi silenciado no servidor **${guild.name}**. Você permanece na call, mas não poderá falar enquanto o mute estiver ativo.`)
    .addFields(
      { name: "Motivo", value: reason },
      { name: "Duração", value: duration },
      { name: "Vencimento", value: `<t:${Math.floor(expiresAt / 1000)}:F> • <t:${Math.floor(expiresAt / 1000)}:R>` }
    )
    .setTimestamp();
}

async function sendServerLog(guild, embed) {
  const channel = await guild.channels.fetch(muteLogChannelId);
  if (!channel?.isTextBased()) {
    throw new Error(`O canal de registro ${muteLogChannelId} não está acessível.`);
  }
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
}

function saveInviteSnapshot(guildId, invites) {
  const replaceSnapshot = db.transaction(() => {
    db.prepare("DELETE FROM guild_invite_uses WHERE guild_id = ?").run(guildId);
    const insert = db.prepare(`
      INSERT INTO guild_invite_uses (guild_id, invite_code, uses)
      VALUES (?, ?, ?)
    `);
    for (const invite of invites.values()) {
      insert.run(guildId, invite.code, invite.uses || 0);
    }
  });
  replaceSnapshot();
}

function saveSingleInviteUse(guildId, invite) {
  db.prepare(`
    INSERT INTO guild_invite_uses (guild_id, invite_code, uses)
    VALUES (?, ?, ?)
    ON CONFLICT(guild_id, invite_code) DO UPDATE SET uses = excluded.uses
  `).run(guildId, invite.code, invite.uses || 0);
}

async function initializeInviteSnapshots() {
  for (const guild of client.guilds.cache.values()) {
    try {
      const invites = await guild.invites.fetch();
      saveInviteSnapshot(guild.id, invites);
    } catch (error) {
      db.prepare("DELETE FROM guild_invite_uses WHERE guild_id = ?").run(guild.id);
      console.error(`Não foi possível carregar os convites do servidor ${guild.id}:`, error);
    }
  }
}

async function handleGuildMemberJoin(member) {
  let usedInvite = null;
  let inviter = null;
  try {
    await inviteSnapshotInitialization;
    const previousUses = new Map(
      db.prepare("SELECT invite_code, uses FROM guild_invite_uses WHERE guild_id = ?")
        .all(member.guild.id)
        .map(row => [row.invite_code, row.uses])
    );
    const currentInvites = await member.guild.invites.fetch();
    const increases = [...currentInvites.values()].filter(invite =>
      previousUses.has(invite.code) && (invite.uses || 0) > previousUses.get(invite.code)
    );
    if (increases.length === 1) {
      usedInvite = increases[0];
      inviter = usedInvite.inviter;
    }
    saveInviteSnapshot(member.guild.id, currentInvites);
  } catch (error) {
    db.prepare("DELETE FROM guild_invite_uses WHERE guild_id = ?").run(member.guild.id);
    console.error(`Não foi possível identificar o convite usado por ${member.id}:`, error);
  }

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("Novo membro entrou no servidor")
    .addFields(
      { name: "Membro", value: `<@${member.id}> (\`${member.id}\`)` },
      {
        name: "Convidado por",
        value: inviter ? `<@${inviter.id}> (\`${inviter.id}\`)` : "Não identificado",
        inline: true
      },
      {
        name: "Link usado",
        value: usedInvite ? `https://discord.gg/${usedInvite.code}` : "Não identificado",
        inline: true
      },
      {
        name: "Conta criada",
        value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:F>`,
        inline: false
      }
    )
    .setThumbnail(member.user.displayAvatarURL())
    .setTimestamp();

  try {
    await sendServerLog(member.guild, embed);
  } catch (error) {
    console.error(`Não foi possível registrar a entrada de ${member.id}:`, error);
  }
}

async function handleInviteCreated(invite) {
  if (!invite.guild) return;

  saveSingleInviteUse(invite.guild.id, invite);
  const inviterId = invite.inviter?.id;
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("Link de convite criado")
    .addFields(
      { name: "Criado por", value: inviterId ? `<@${inviterId}> (\`${inviterId}\`)` : "Não identificado", inline: true },
      { name: "Canal", value: invite.channelId ? `<#${invite.channelId}>` : "Não identificado", inline: true },
      { name: "Link", value: `https://discord.gg/${invite.code}` },
      { name: "Usos máximos", value: invite.maxUses ? String(invite.maxUses) : "Ilimitado", inline: true },
      {
        name: "Expira",
        value: invite.expiresTimestamp
          ? `<t:${Math.floor(invite.expiresTimestamp / 1000)}:F>`
          : "Nunca",
        inline: true
      }
    )
    .setTimestamp();

  try {
    await sendServerLog(invite.guild, embed);
  } catch (error) {
    console.error(`Não foi possível registrar a criação do convite ${invite.code}:`, error);
  }
}

let inviteSnapshotInitialization = Promise.resolve();
let inviteTrackingQueue = Promise.resolve();

async function getMuteRoleAndBotMember(guild) {
  const [role, botMember] = await Promise.all([
    guild.roles.fetch(muteRoleId),
    guild.members.fetchMe()
  ]);
  if (!role) throw new Error(`O cargo de mute ${muteRoleId} não existe neste servidor.`);
  if (!botMember.permissions.has(PermissionFlagsBits.MuteMembers)) {
    throw new Error("O bot precisa da permissão Silenciar Membros.");
  }
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error("O bot precisa da permissão Gerenciar Cargos.");
  }
  if (role.position >= botMember.roles.highest.position) {
    throw new Error("Mova o cargo do bot para cima do cargo de mute.");
  }
  return { role, botMember };
}

function canModerateMember(target, moderator, botMember, guild) {
  if (target.id === guild.ownerId || target.id === botMember.id) return false;
  if (target.roles.highest.comparePositionTo(botMember.roles.highest) >= 0) return false;
  return moderator.id === guild.ownerId ||
    target.roles.highest.comparePositionTo(moderator.roles.highest) < 0;
}

async function handleMuteCommand(interaction) {
  if (!interaction.inGuild() || !interaction.guild) {
    return interaction.reply({ content: "Este comando só pode ser usado no servidor.", ephemeral: true });
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
    return interaction.reply({ content: "Você precisa da permissão Moderar Membros.", ephemeral: true });
  }

  const duration = parseMuteDuration(interaction.options.getString("tempo", true));
  if (!duration) {
    return interaction.reply({
      content: "Informe o tempo como `1h` ou `2d`. O limite do Discord é 28 dias.",
      ephemeral: true
    });
  }

  const userId = parseMemberId(interaction.options.getString("membro", true));
  if (!userId) {
    return interaction.reply({ content: "Informe uma menção ou um ID de membro válido.", ephemeral: true });
  }
  const reason = interaction.options.getString("motivo", true).trim();
  if (!reason) {
    return interaction.reply({ content: "Informe o motivo do mute.", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  const guild = interaction.guild;
  try {
    const [target, moderator, { role, botMember }] = await Promise.all([
      guild.members.fetch(userId),
      guild.members.fetch(interaction.user.id),
      getMuteRoleAndBotMember(guild)
    ]);
    if (!canModerateMember(target, moderator, botMember, guild)) {
      return interaction.editReply("Não posso aplicar mute nesse membro por causa da hierarquia de cargos.");
    }

    const now = Date.now();
    const expiresAt = now + duration.milliseconds;
    const existingMute = db.prepare(
      "SELECT role_added_by_bot, voice_mute_added_by_bot FROM active_mutes WHERE guild_id = ? AND user_id = ?"
    ).get(guild.id, target.id);
    const hadMuteRole = target.roles.cache.has(role.id);
    const roleAddedByBot = existingMute
      ? Boolean(existingMute.role_added_by_bot)
      : !hadMuteRole;
    const hadServerMute = target.voice.serverMute;
    const previousTimeout = existingMute && existingMute.voice_mute_added_by_bot === null
      ? target.communicationDisabledUntilTimestamp
      : null;
    const shouldTrackServerMute = Boolean(target.voice.channelId &&
      (!hadServerMute || (previousTimeout && previousTimeout > Date.now())));
    const voiceMuteAddedByBot = existingMute
      ? Boolean(existingMute.voice_mute_added_by_bot) ||
        (!existingMute.voice_mute_added_by_bot && shouldTrackServerMute)
      : Boolean(target.voice.channelId && !hadServerMute);
    let voiceMuteApplied = false;
    let legacyTimeoutCleared = false;
    let roleAdded = false;

    try {
      if (!hadServerMute && target.voice.channelId) {
        await target.voice.setMute(true, reason);
        voiceMuteApplied = true;
      }
      if (previousTimeout && previousTimeout > Date.now()) {
        await target.timeout(null, "Convertendo mute temporário legado");
        legacyTimeoutCleared = true;
      }
      if (!hadMuteRole) {
        await target.roles.add(role, reason);
        roleAdded = true;
      }
      db.prepare(`
        INSERT INTO active_mutes (guild_id, user_id, role_id, reason, moderator_id, expires_at, role_added_by_bot, voice_mute_added_by_bot)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
          role_id = excluded.role_id,
          reason = excluded.reason,
          moderator_id = excluded.moderator_id,
          expires_at = excluded.expires_at,
          role_added_by_bot = excluded.role_added_by_bot,
          voice_mute_added_by_bot = excluded.voice_mute_added_by_bot
      `).run(
        guild.id,
        target.id,
        role.id,
        reason,
        moderator.id,
        expiresAt,
        roleAddedByBot ? 1 : 0,
        voiceMuteAddedByBot ? 1 : 0
      );
    } catch (error) {
      if (roleAdded) {
        await target.roles.remove(role, "Revertendo mute incompleto")
          .catch(rollbackError => console.error("Falha ao reverter o cargo de mute:", rollbackError));
      }
      if (voiceMuteApplied) {
        await target.voice.setMute(false, "Revertendo mute incompleto")
          .catch(rollbackError => console.error("Falha ao reverter o mute de voz:", rollbackError));
      }
      if (legacyTimeoutCleared && previousTimeout > Date.now()) {
        await target.timeout(previousTimeout - Date.now(), "Revertendo conversão de mute")
          .catch(rollbackError => console.error("Falha ao restaurar o timeout legado:", rollbackError));
      }
      throw error;
    }

    const logEmbed = createMuteLogEmbed({
      guild,
      title: "🔇 Membro silenciado sem desconectar da call",
      userId: target.id,
      moderatorId: moderator.id,
      reason,
      duration: duration.label,
      expiresAt
    });
    const warnings = [];
    try {
      await sendServerLog(guild, logEmbed);
    } catch (error) {
      console.error("Mute aplicado, mas não foi possível enviar o registro:", error);
      warnings.push("Não consegui enviar o registro; confira o acesso do bot ao canal de logs.");
    }
    try {
      await target.send({
        embeds: [createMuteDmEmbed({
          guild,
          reason,
          duration: duration.label,
          expiresAt
        })],
        allowedMentions: { parse: [] }
      });
    } catch (error) {
      console.error("Mute aplicado, mas não foi possível enviar o motivo por DM:", error);
      warnings.push("Não consegui enviar o PV da pessoa; ela pode estar com as DMs fechadas.");
    }

    return interaction.editReply(
      `🔇 <@${target.id}> foi silenciado por ${duration.label} e permanece na call. Motivo: ${reason}.${warnings.length ? ` ${warnings.join(" ")}` : ""}`
    );
  } catch (error) {
    console.error("Não foi possível aplicar o mute:", error);
    return interaction.editReply(`Não consegui aplicar o mute: ${error.message}`);
  }
}

async function handleUnmuteCommand(interaction) {
  if (!interaction.inGuild() || !interaction.guild) {
    return interaction.reply({ content: "Este comando só pode ser usado no servidor.", ephemeral: true });
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
    return interaction.reply({ content: "Você precisa da permissão Moderar Membros.", ephemeral: true });
  }

  const userId = parseMemberId(interaction.options.getString("membro", true));
  if (!userId) {
    return interaction.reply({ content: "Informe uma menção ou um ID de membro válido.", ephemeral: true });
  }
  const reason = interaction.options.getString("motivo")?.trim() || "Mute removido manualmente.";

  await interaction.deferReply({ ephemeral: true });
  const guild = interaction.guild;
  try {
    const [target, moderator, { role, botMember }] = await Promise.all([
      guild.members.fetch(userId),
      guild.members.fetch(interaction.user.id),
      getMuteRoleAndBotMember(guild)
    ]);
    if (!canModerateMember(target, moderator, botMember, guild)) {
      return interaction.editReply("Não posso remover o mute desse membro por causa da hierarquia de cargos.");
    }

    const muteRecord = db.prepare(
      "SELECT expires_at, voice_mute_added_by_bot FROM active_mutes WHERE guild_id = ? AND user_id = ?"
    ).get(guild.id, target.id);
    const hasServerMute = target.voice.serverMute;
    const hadMuteRole = target.roles.cache.has(role.id);
    if (!hasServerMute && !hadMuteRole && !muteRecord) {
      return interaction.editReply("Esse membro não tem um mute ativo.");
    }

    let roleRemoved = false;
    let voiceMuteCleared = false;
    let legacyTimeoutCleared = false;
    const previousTimeout = muteRecord && muteRecord.voice_mute_added_by_bot === null
      ? target.communicationDisabledUntilTimestamp
      : null;
    const hasLegacyTimeout = Boolean(previousTimeout && previousTimeout > Date.now());
    try {
      if (hadMuteRole) {
        await target.roles.remove(role, reason);
        roleRemoved = true;
      }
      const shouldClearServerMute = hasServerMute &&
        (!muteRecord || Boolean(muteRecord.voice_mute_added_by_bot) || hasLegacyTimeout);
      if (shouldClearServerMute) {
        await target.voice.setMute(false, reason);
        voiceMuteCleared = true;
      }
      if (hasLegacyTimeout) {
        await target.timeout(null, reason);
        legacyTimeoutCleared = true;
      }
      db.prepare("DELETE FROM active_mutes WHERE guild_id = ? AND user_id = ?")
        .run(guild.id, target.id);
    } catch (error) {
      if (roleRemoved) {
        await target.roles.add(role, "Revertendo unmute incompleto")
          .catch(rollbackError => console.error("Falha ao restaurar o cargo de mute:", rollbackError));
      }
      if (voiceMuteCleared) {
        await target.voice.setMute(true, "Revertendo unmute incompleto")
          .catch(rollbackError => console.error("Falha ao restaurar o mute de voz:", rollbackError));
      }
      if (legacyTimeoutCleared && previousTimeout > Date.now()) {
        await target.timeout(previousTimeout - Date.now(), "Revertendo unmute incompleto")
          .catch(rollbackError => console.error("Falha ao restaurar o timeout legado:", rollbackError));
      }
      throw error;
    }

    const logEmbed = createMuteLogEmbed({
      guild,
      title: "🔊 Mute removido",
      userId: target.id,
      moderatorId: moderator.id,
      reason,
      duration: muteRecord
        ? `Removido antes do vencimento (<t:${Math.floor(muteRecord.expires_at / 1000)}:R>)`
        : "Removido manualmente"
    });
    try {
      await sendServerLog(guild, logEmbed);
    } catch (error) {
      console.error("Unmute aplicado, mas não foi possível enviar o registro:", error);
      return interaction.editReply("Mute removido, mas não consegui enviar o registro no canal de logs.");
    }
    return interaction.editReply(`🔊 O mute de <@${target.id}> foi removido.`);
  } catch (error) {
    console.error("Não foi possível remover o mute:", error);
    return interaction.editReply(`Não consegui remover o mute: ${error.message}`);
  }
}

async function expireTimedMutes() {
  const expiredMutes = db.prepare(
    "SELECT guild_id, user_id, role_id, reason, moderator_id, expires_at, role_added_by_bot, voice_mute_added_by_bot FROM active_mutes WHERE expires_at <= ?"
  ).all(Date.now());

  for (const expiredMute of expiredMutes) {
    try {
      const currentMute = db.prepare(
        "SELECT guild_id, user_id, role_id, reason, moderator_id, expires_at, role_added_by_bot, voice_mute_added_by_bot FROM active_mutes WHERE guild_id = ? AND user_id = ?"
      ).get(expiredMute.guild_id, expiredMute.user_id);
      if (!currentMute || currentMute.expires_at > Date.now()) continue;

      const guild = await client.guilds.fetch(currentMute.guild_id);
      let member;
      try {
        member = await guild.members.fetch(currentMute.user_id);
      } catch (error) {
        if (error.code === 10007) {
          db.prepare("DELETE FROM active_mutes WHERE guild_id = ? AND user_id = ?")
            .run(currentMute.guild_id, currentMute.user_id);
          continue;
        }
        throw error;
      }

      const legacyTimeout = currentMute.voice_mute_added_by_bot === null &&
        member.communicationDisabledUntilTimestamp > Date.now();
      if ((currentMute.voice_mute_added_by_bot || legacyTimeout) && member.voice.serverMute) {
        await member.voice.setMute(false, "Mute temporário expirado");
      }
      if (legacyTimeout) {
        await member.timeout(null, "Mute temporário expirado");
      }
      if (member.roles.cache.has(currentMute.role_id)) {
        await member.roles.remove(currentMute.role_id, "Mute temporário expirado");
      }
      const deletion = db.prepare(
        "DELETE FROM active_mutes WHERE guild_id = ? AND user_id = ? AND expires_at = ?"
      ).run(currentMute.guild_id, currentMute.user_id, currentMute.expires_at);
      if (!deletion.changes) continue;

      try {
        await sendServerLog(guild, createMuteLogEmbed({
          guild,
          title: "✅ Mute temporário expirado",
          userId: currentMute.user_id,
          moderatorId: currentMute.moderator_id,
          reason: currentMute.reason,
          duration: "Expirado",
          expiresAt: currentMute.expires_at
        }));
      } catch (error) {
        console.error("Mute expirou, mas não foi possível enviar o registro:", error);
      }
    } catch (error) {
      console.error(
        `Não foi possível expirar o mute de ${expiredMute.user_id}:`,
        error
      );
    }
  }
}

function getGuildConfig(guildId) {
  const rows = db.prepare(
    "SELECT setting_key, setting_value FROM guild_settings WHERE guild_id = ?"
  ).all(guildId);
  const settings = Object.fromEntries(rows.map(row => [row.setting_key, row.setting_value]));
  const buttonStyle = settings.button_style || "Primary";
  return {
    postChannelId: settings.post_channel_id || process.env.POST_CHANNEL_ID,
    panelTitle: settings.panel_title === undefined ? defaultPanelTitle : settings.panel_title,
    panelDescription: settings.panel_description === undefined ? defaultPanelDescription : settings.panel_description,
    panelColor: settings.panel_color ? Number.parseInt(settings.panel_color, 16) : defaultPanelColor,
    panelBanner: settings.panel_banner || "",
    panelThumbnail: settings.panel_thumbnail || "",
    panelFooter: settings.panel_footer === undefined ? defaultPanelFooter : settings.panel_footer,
    buttonStyle: buttonStyles[buttonStyle] || ButtonStyle.Primary,
    buttonStyleName: buttonStyles[buttonStyle] ? buttonStyle : "Primary"
  };
}

function setGuildSetting(guildId, key, value) {
  db.prepare(`
    INSERT INTO guild_settings (guild_id, setting_key, setting_value)
    VALUES (?, ?, ?)
    ON CONFLICT (guild_id, setting_key) DO UPDATE SET setting_value = excluded.setting_value
  `).run(guildId, key, value);
}

function fitsDiscordEmbedTextLimit(title, description, footer) {
  return title.length + description.length + footer.length <= 6000;
}

function memberHasConfigRole(member) {
  if (!member) return false;
  const roles = member.roles;
  if (roles?.cache?.has) return roles.cache.has(configRoleId);
  return Array.isArray(roles) && roles.includes(configRoleId);
}

function registerPanelMessage(guildId, channelId, messageId) {
  db.prepare(`
    INSERT OR IGNORE INTO panel_messages (guild_id, channel_id, message_id)
    VALUES (?, ?, ?)
  `).run(guildId, channelId, messageId);
}

async function sendPanel(channel, guildId) {
  const sent = await channel.send(createPanelPayload(guildId));
  registerPanelMessage(guildId, channel.id, sent.id);
  return sent;
}

async function trackPanelsInChannel(channel, guildId) {
  if (!channel?.isTextBased() || !channel.messages) return;
  let messages;
  try {
    messages = await channel.messages.fetch({ limit: 100 });
  } catch (error) {
    console.error("Não foi possível localizar painéis antigos neste canal:", error);
    return;
  }
  for (const message of messages.values()) {
    const hasPublishButton = message.author.id === client.user.id &&
      message.components.some(row =>
        row.components.some(component => component.customId === "open_publish")
      );
    if (hasPublishButton) registerPanelMessage(guildId, channel.id, message.id);
  }
}

function createConfigDashboardPayload(guildId) {
  const config = getGuildConfig(guildId);
  const colorNames = {
    Primary: "Azul",
    Secondary: "Cinza",
    Success: "Verde",
    Danger: "Vermelho"
  };
  return {
    content: [
      "**Configurações do painel**",
      `Título: ${config.panelTitle || "(vazio)"} · Rodapé: ${config.panelFooter || "(vazio)"}`,
      `Botão: ${colorNames[config.buttonStyleName]}`
    ].join("\n"),
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("config:content").setLabel("Título, descrição e rodapé").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("config:images").setLabel("Banner e thumbnail").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("config:channel").setLabel("Canal de publicações").setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("config:button_style")
          .setPlaceholder("Escolha a cor dos botões")
          .addOptions(
            { label: "Azul", value: "Primary" },
            { label: "Cinza", value: "Secondary" },
            { label: "Verde", value: "Success" },
            { label: "Vermelho", value: "Danger" }
          )
      )
    ]
  };
}

function createSettingsTextInput(customId, label, value, maxLength, style = TextInputStyle.Short) {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setStyle(style)
    .setRequired(false)
    .setMaxLength(maxLength)
    .setPlaceholder("Deixe vazio para usar o padrão ou limpar este campo.");
  if (value) input.setValue(value.slice(0, maxLength));
  return new LabelBuilder().setLabel(label).setTextInputComponent(input);
}

function createSettingsModal(kind, guildId) {
  const config = getGuildConfig(guildId);
  const modal = new ModalBuilder();
  if (kind === "content") {
    modal.setCustomId("config_modal:content").setTitle("Texto do painel")
      .addLabelComponents(
        createSettingsTextInput("title", "Título", config.panelTitle, 256),
        createSettingsTextInput("description", "Descrição", config.panelDescription, 4000, TextInputStyle.Paragraph),
        createSettingsTextInput("footer", "Rodapé", config.panelFooter, 2048)
      );
  } else if (kind === "images") {
    modal.setCustomId("config_modal:images").setTitle("Imagens do painel")
      .addLabelComponents(
        createSettingsTextInput("banner", "URL do banner", config.panelBanner, 1000),
        createSettingsTextInput("thumbnail", "URL da thumbnail", config.panelThumbnail, 1000)
      );
  } else if (kind === "channel") {
    modal.setCustomId("config_modal:channel").setTitle("Canal de publicações")
      .addLabelComponents(
        createSettingsTextInput("channel", "Canal ou ID (vazio remove)", config.postChannelId || "", 100)
      );
  }
  return modal;
}

function createPanelPayload(guildId) {
  const config = getGuildConfig(guildId);
  const embed = new EmbedBuilder()
    .setColor(config.panelColor)
    .setTitle(config.panelTitle)
    .setDescription(config.panelDescription);
  if (config.panelBanner) embed.setImage(config.panelBanner);
  if (config.panelThumbnail) embed.setThumbnail(config.panelThumbnail);
  if (config.panelFooter) embed.setFooter({ text: config.panelFooter });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("open_publish")
      .setLabel("Publicar vídeo")
      .setStyle(config.buttonStyle)
  );
  return { embeds: [embed], components: [row] };
}

function isValidSocialUrl(value, host) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === host || url.hostname.endsWith("." + host));
  } catch {
    return false;
  }
}

function isValidHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isValidVideoAttachment(attachment) {
  return (attachment.contentType && attachment.contentType.startsWith("video/")) ||
    /\.(mp4|mov|webm|m4v)$/i.test(attachment.name || "");
}

async function handleEmojiCommand(message, args) {
  const [kind, name, ...tagParts] = args.trim().split(/\s+/);
  const isEmoji = kind?.toLowerCase() === "emoji";
  const isSticker = kind?.toLowerCase() === "figurinha";
  const usage = [
    "Anexe um arquivo que você criou ou tem autorização para usar:",
    "`!emj emoji nome` + PNG/JPG/GIF (até 256 KB)",
    "`!emj figurinha nome tag` + PNG/APNG/JSON/GIF (até 512 KB)"
  ].join("\n");

  if ((!isEmoji && !isSticker) || !name || (isSticker && !tagParts.length)) {
    await message.reply(usage);
    return;
  }
  if (!/^[a-zA-Z0-9_]{2,32}$/.test(name) || (isSticker && name.length > 30)) {
    await message.reply("O nome deve ter de 2 a 32 caracteres: letras, números e `_` (figurinhas: no máximo 30).");
    return;
  }
  if (isSticker && tagParts.join(" ").length > 200) {
    await message.reply("A tag da figurinha pode ter no máximo 200 caracteres.");
    return;
  }
  if (message.attachments.size !== 1) {
    await message.reply("Anexe exatamente um arquivo ao comando.");
    return;
  }

  const attachment = message.attachments.first();
  const extension = attachment.name.match(/\.[^.]+$/)?.[0].toLowerCase();
  const allowedExtensions = isEmoji
    ? [".png", ".jpg", ".jpeg", ".gif"]
    : [".png", ".apng", ".json", ".gif"];
  const maxBytes = isEmoji ? 256 * 1024 : 512 * 1024;
  if (!extension || !allowedExtensions.includes(extension)) {
    await message.reply(`Formato de arquivo não aceito. Formatos válidos: ${allowedExtensions.join(", ")}.`);
    return;
  }
  if (attachment.size > maxBytes) {
    await message.reply(`O arquivo excede o limite de ${isEmoji ? "256 KB" : "512 KB"}.`);
    return;
  }

  if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) {
    await message.reply("Você precisa da permissão **Gerenciar expressões** para usar este comando.");
    return;
  }

  try {
    const botMember = message.guild.members.me || await message.guild.members.fetchMe();
    if (!botMember.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) {
      await message.reply("O bot precisa da permissão **Gerenciar expressões** neste servidor.");
      return;
    }

    const assetUrl = new URL(attachment.url);
    if (assetUrl.protocol !== "https:" || assetUrl.hostname !== "cdn.discordapp.com") {
      await message.reply("O anexo precisa ser enviado diretamente nesta mensagem do Discord.");
      return;
    }

    const response = await fetch(assetUrl);
    if (!response.ok) throw new Error(`Download do anexo falhou com HTTP ${response.status}.`);
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      await message.reply(`O arquivo excede o limite de ${isEmoji ? "256 KB" : "512 KB"}.`);
      return;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      await message.reply(`O arquivo excede o limite de ${isEmoji ? "256 KB" : "512 KB"}.`);
      return;
    }

    if (isEmoji) {
      const created = await message.guild.emojis.create({
        attachment: buffer,
        name,
        reason: `Adicionado por ${message.author.id} via !emj`
      });
      await message.reply(`Emoji ${created} adicionado ao servidor.`);
      return;
    }

    const created = await message.guild.stickers.create({
      file: new AttachmentBuilder(buffer, { name: `${name}${extension}` }),
      name,
      tags: tagParts.join(" "),
      reason: `Adicionado por ${message.author.id} via !emj`
    });
    await message.reply(`Figurinha **${created.name}** adicionada ao servidor.`);
  } catch (error) {
    console.error("Erro ao adicionar emoji/figurinha:", error);
    await message.reply(
      "Não consegui adicionar o arquivo. Confira as permissões do bot, os limites do servidor e o formato/tamanho aceito."
    );
  }
}

function postButtons(postId, tiktokUrl, instagramUrl, buttonStyle = ButtonStyle.Primary) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`like:${postId}`)
      .setLabel(String(getLikeCount(postId)))
      .setEmoji({ id: "1571330274531213402", name: "1327037490477010984", animated: true })
      .setStyle(buttonStyle),
    new ButtonBuilder()
      .setCustomId(`comment:${postId}`)
      .setLabel("Comentar")
      .setEmoji({ id: "1571332054128402462", name: "7567" })
      .setStyle(buttonStyle),
    new ButtonBuilder()
      .setCustomId(`viewcomments:${postId}`)
      .setLabel("Ver comentários")
      .setEmoji({ id: "1571330785422606396", name: "Usurio" })
      .setStyle(buttonStyle),
    new ButtonBuilder()
      .setCustomId(`viewlikes:${postId}`)
      .setLabel("Ver curtidas")
      .setEmoji({ id: "1571330704434798776", name: "gray" })
      .setStyle(buttonStyle)
  );

  const rows = [row];
  const socials = [];
  if (instagramUrl) socials.push(new ButtonBuilder()
    .setLabel("Instagram").setEmoji("📸").setStyle(ButtonStyle.Link).setURL(instagramUrl));
  if (tiktokUrl) socials.push(new ButtonBuilder()
    .setLabel("TikTok").setEmoji({ id: "1571331659008315553", name: "6621_tiktok" })
    .setStyle(ButtonStyle.Link).setURL(tiktokUrl));
  if (socials.length) rows.push(new ActionRowBuilder().addComponents(...socials));
  return rows;
}

function getLikeCount(postId) {
  return db.prepare("SELECT COUNT(*) AS total FROM likes WHERE post_id = ?").get(postId).total;
}

function getCommentCount(postId) {
  return db.prepare("SELECT COUNT(*) AS total FROM comments WHERE post_id = ?").get(postId).total;
}

function getLikesPagePayload(postId, requestedPage = 0) {
  const likes = db.prepare(
    "SELECT user_id FROM likes WHERE post_id = ? ORDER BY rowid"
  ).all(postId);
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(likes.length / pageSize));
  const page = Math.min(Math.max(requestedPage, 0), pageCount - 1);
  const pageLikes = likes.slice(page * pageSize, (page + 1) * pageSize);
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`❤️ Quem curtiu (${likes.length})`)
    .setDescription(
      pageLikes.length
        ? pageLikes.map(like => `• <@${like.user_id}>`).join("\n")
        : "Ainda ninguém curtiu esta publicação."
    )
    .setFooter({
      text: pageCount > 1
        ? `Página ${page + 1} de ${pageCount}. As menções não enviam notificações.`
        : "As menções não enviam notificações."
    });

  const components = pageCount > 1
    ? [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`likespage:${postId}:${page - 1}`)
        .setLabel("Anterior")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`likespage:${postId}:${page + 1}`)
        .setLabel("Próxima")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === pageCount - 1)
    )]
    : [];

  return { embeds: [embed], components };
}

function createPostComponents(post, videoUrl) {
  const config = getGuildConfig(post.guild_id);
  const discordNick = (post.discord_nick || `<@${post.author_id}>`)
    .replace(/[\r\n]/g, " ")
    .replace(/@everyone|@here/g, "@​$&");
  const card = new ContainerBuilder()
    .setAccentColor(0x000000)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Influencer:** <@${post.author_id}>\n**Discord:** ${discordNick}`
      )
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(videoUrl)
      )
    )
    .addActionRowComponents(...postButtons(post.id, post.tiktok_url, post.instagram_url, config.buttonStyle));

  return [
    new TextDisplayBuilder().setContent(`Nova publicação de <@${post.author_id}>`),
    card
  ];
}

async function refreshPost(postId) {
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(postId);
  if (!post || !post.message_id) return;

  try {
    const channel = await client.channels.fetch(post.channel_id);
    if (!channel || !channel.isTextBased()) return;
    const message = await channel.messages.fetch(post.message_id);
    if (message.flags.has(MessageFlags.IsComponentsV2)) {
      const attachment = message.attachments.first();
      await message.edit({
        flags: MessageFlags.IsComponentsV2,
        components: createPostComponents(
          post,
          attachment ? `attachment://${attachment.name}` : post.video_url
        ),
        attachments: [...message.attachments.values()],
        allowedMentions: { parse: [] }
      });
    } else {
      const embed = EmbedBuilder.from(message.embeds[0])
        .setColor(getGuildConfig(post.guild_id).panelColor)
        .setFields(
          { name: "Curtidas", value: `❤️ ${getLikeCount(postId)}`, inline: true },
          { name: "Comentários", value: `💬 ${getCommentCount(postId)}`, inline: true }
        );
      await message.edit({
        embeds: [embed],
        components: postButtons(postId, post.tiktok_url, post.instagram_url, getGuildConfig(post.guild_id).buttonStyle)
      });
    }
  } catch (error) {
    console.error("Não foi possível atualizar a publicação:", error.message);
  }
}

async function refreshGuildConfiguration(guildId) {
  const panels = db.prepare(
    "SELECT channel_id, message_id FROM panel_messages WHERE guild_id = ?"
  ).all(guildId);

  for (const panel of panels) {
    try {
      const channel = await client.channels.fetch(panel.channel_id);
      if (!channel?.isTextBased()) throw new Error("Canal do painel indisponível.");
      const message = await channel.messages.fetch(panel.message_id);
      await message.edit(createPanelPayload(guildId));
    } catch (error) {
      console.error(`Não foi possível atualizar o painel ${panel.message_id}:`, error.message);
    }
  }

  const posts = db.prepare("SELECT id FROM posts WHERE guild_id = ?").all(guildId);
  for (const post of posts) await refreshPost(post.id);
}

client.once("ready", async () => {
  console.log(`Bot conectado como ${client.user.tag}`);
  inviteSnapshotInitialization = initializeInviteSnapshots().catch(error => {
    console.error("Não foi possível inicializar o rastreamento de convites:", error);
  });
  await inviteSnapshotInitialization;

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
      { body: commands.map(command => command.toJSON()) }
    );
    console.log("Comando /painel registrado.");
  } catch (error) {
    console.error("Erro ao registrar comandos:", error);
  }

  let voiceConnection;
  try {
    const channel = await client.channels.fetch(voiceChannelId);
    if (!channel?.isVoiceBased()) {
      throw new Error(`O canal ${voiceChannelId} não existe ou não é um canal de voz.`);
    }

    voiceConnection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: true
    });
    await entersState(voiceConnection, VoiceConnectionStatus.Ready, 30_000);
    console.log(`Conectado à call ${channel.name} (${channel.id}), sem áudio.`);
  } catch (error) {
    voiceConnection?.destroy();
    console.error(`Não foi possível entrar na call ${voiceChannelId}:`, error);
  }

  await expireTimedMutes();
  const muteExpiryTimer = setInterval(() => {
    expireTimedMutes().catch(error => console.error("Erro ao verificar mutes expirados:", error));
  }, 30_000);
  muteExpiryTimer.unref();

  const existingPosts = db.prepare("SELECT id FROM posts WHERE message_id IS NOT NULL").all();
  for (const post of existingPosts) await refreshPost(post.id);
  if (existingPosts.length) {
    console.log(`Botões atualizados em ${existingPosts.length} publicações.`);
  }
});

client.on("guildMemberAdd", member => {
  if (member.user.bot) return;
  inviteTrackingQueue = inviteTrackingQueue
    .then(() => handleGuildMemberJoin(member))
    .catch(error => console.error(`Erro ao registrar a entrada de ${member.id}:`, error));
});

client.on("inviteCreate", invite => {
  handleInviteCreated(invite).catch(error => {
    console.error(`Erro ao registrar a criação do convite ${invite.code}:`, error);
  });
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "mute") {
      return await handleMuteCommand(interaction);
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "unmute") {
      return await handleUnmuteCommand(interaction);
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "configurar-painel") {
      if (!interaction.inGuild() || !memberHasConfigRole(interaction.member)) {
        return interaction.reply({ content: "Somente membros com o cargo autorizado podem alterar as configurações.", ephemeral: true });
      }
      await trackPanelsInChannel(interaction.channel, interaction.guildId);
      return interaction.reply({ ...createConfigDashboardPayload(interaction.guildId), ephemeral: true });
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "painel") {
      if (!interaction.inGuild() ||
          !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: "Somente administradores podem usar este comando.", ephemeral: true });
      }

      await interaction.reply({ content: "Painel enviado.", ephemeral: true });
      await sendPanel(interaction.channel, interaction.guildId);
      return;
    }

    if (interaction.isButton() && interaction.customId === "open_publish") {
      if (interaction.inGuild()) {
        registerPanelMessage(interaction.guildId, interaction.channelId, interaction.message.id);
      }
      const modal = new ModalBuilder()
        .setCustomId("publish_modal")
        .setTitle("Enviar publicação");

      const tiktok = new TextInputBuilder()
        .setCustomId("tiktok")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(300)
        .setPlaceholder("https://www.tiktok.com/@usuario/video/...");

      const instagram = new TextInputBuilder()
        .setCustomId("instagram")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(300)
        .setPlaceholder("https://www.instagram.com/...");

      const video = new FileUploadBuilder()
        .setCustomId("video")
        .setRequired(true)
        .setMinValues(1)
        .setMaxValues(1)
        .setFileTypes("video", ".mp4", ".mov", ".webm", ".m4v");

      modal.addLabelComponents(
        new LabelBuilder()
          .setLabel("Link do TikTok (opcional)")
          .setTextInputComponent(tiktok),
        new LabelBuilder()
          .setLabel("Link do Instagram (opcional)")
          .setTextInputComponent(instagram),
        new LabelBuilder()
          .setLabel("Vídeo")
          .setDescription("Anexe um vídeo MP4, MOV, WEBM ou M4V.")
          .setFileUploadComponent(video)
      );
      await interaction.showModal(modal);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("config:")) {
      if (!interaction.inGuild() || !memberHasConfigRole(interaction.member)) {
        return interaction.reply({ content: "Somente membros com o cargo autorizado podem alterar as configurações.", ephemeral: true });
      }
      const kind = interaction.customId.slice("config:".length);
      if (!["content", "images", "channel"].includes(kind)) return;
      await interaction.showModal(createSettingsModal(kind, interaction.guildId));
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "config:button_style") {
      if (!interaction.inGuild() || !memberHasConfigRole(interaction.member)) {
        return interaction.reply({ content: "Somente membros com o cargo autorizado podem alterar as configurações.", ephemeral: true });
      }
      const style = interaction.values[0];
      if (!Object.prototype.hasOwnProperty.call(buttonStyles, style)) {
        return interaction.reply({ content: "A cor selecionada não é válida.", ephemeral: true });
      }
      await interaction.deferUpdate();
      setGuildSetting(interaction.guildId, "button_style", style);
      await refreshGuildConfiguration(interaction.guildId);
      await interaction.editReply(createConfigDashboardPayload(interaction.guildId));
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === "publish_modal") {
      const tiktokUrl = interaction.fields.getTextInputValue("tiktok").trim();
      const instagramUrl = interaction.fields.getTextInputValue("instagram").trim();

      if (!isValidSocialUrl(tiktokUrl, "tiktok.com")) {
        return interaction.reply({ content: "O link do TikTok não parece válido.", ephemeral: true });
      }
      if (!isValidSocialUrl(instagramUrl, "instagram.com")) {
        return interaction.reply({ content: "O link do Instagram não parece válido.", ephemeral: true });
      }

      const attachment = interaction.fields.getUploadedFiles("video")?.first();
      if (!attachment) {
        return interaction.reply({ content: "Anexe um vídeo antes de enviar o formulário.", ephemeral: true });
      }
      if (!isValidVideoAttachment(attachment)) {
        return interaction.reply({
          content: "O arquivo anexado não parece ser um vídeo. Use MP4, MOV, WEBM ou M4V.",
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });
      try {
        const postChannelId = getGuildConfig(interaction.guildId).postChannelId;
        if (!postChannelId) {
          await interaction.editReply(
            "Nenhum canal de publicações foi configurado. Peça a um administrador para usar `!painel configurar canal #canal`."
          );
          return;
        }

        const postChannel = await client.channels.fetch(postChannelId);
        if (!postChannel || !postChannel.isTextBased()) {
          await interaction.editReply("O canal de publicações configurado não foi encontrado.");
          return;
        }

        const videoResponse = await fetch(attachment.url);
        if (!videoResponse.ok) throw new Error("Não foi possível baixar o vídeo anexado.");
        const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
        const discordNick = interaction.member?.displayName ||
          interaction.member?.nick ||
          interaction.user.globalName ||
          interaction.user.username;

        const postInfo = db.prepare(`
          INSERT INTO posts (guild_id, channel_id, author_id, discord_nick, video_url, video_name, tiktok_url, instagram_url)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          interaction.guildId,
          postChannel.id,
          interaction.user.id,
          discordNick,
          attachment.url,
          attachment.name || "video.mp4",
          tiktokUrl,
          instagramUrl
        );

        const postId = Number(postInfo.lastInsertRowid);
        const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(postId);
        const videoName = attachment.name || "video.mp4";

        const sent = await postChannel.send({
          flags: MessageFlags.IsComponentsV2,
          components: createPostComponents(post, `attachment://${videoName}`),
          files: [new AttachmentBuilder(videoBuffer, { name: videoName })],
          allowedMentions: { users: [interaction.user.id] }
        });

        db.prepare("UPDATE posts SET message_id = ? WHERE id = ?").run(sent.id, postId);
        await interaction.editReply("Seu vídeo foi publicado com sucesso! 🎉");
      } catch (error) {
        console.error("Erro ao publicar vídeo:", error);
        await interaction.editReply(
          "Não consegui publicar o vídeo. Verifique as permissões e o limite de tamanho do Discord."
        );
      }
      return;
    }

    if (interaction.isButton()) {
      const [action, idText, pageText] = interaction.customId.split(":");
      const postId = Number(idText);
      if (!Number.isInteger(postId)) return;

      const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(postId);
      if (!post) {
        return interaction.reply({ content: "Essa publicação não foi encontrada.", ephemeral: true });
      }

      if (action === "viewlikes" || action === "likespage") {
        const page = action === "likespage" ? Number(pageText) : 0;
        if (!Number.isInteger(page) || page < 0) {
          return interaction.reply({ content: "Essa página de curtidas não é válida.", ephemeral: true });
        }

        const payload = {
          ...getLikesPagePayload(postId, page),
          allowedMentions: { parse: [] }
        };
        if (action === "likespage") {
          await interaction.update(payload);
        } else {
          await interaction.reply({ ...payload, ephemeral: true });
        }
        return;
      }

      if (action === "like") {
        const existing = db.prepare(
          "SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?"
        ).get(postId, interaction.user.id);

        if (existing) {
          db.prepare("DELETE FROM likes WHERE post_id = ? AND user_id = ?")
            .run(postId, interaction.user.id);
        } else {
          db.prepare("INSERT OR IGNORE INTO likes (post_id, user_id) VALUES (?, ?)")
            .run(postId, interaction.user.id);
        }

        await refreshPost(postId);
        await interaction.reply({
          content: existing ? "Você removeu sua curtida." : "Você curtiu esta publicação! ❤️",
          ephemeral: true
        });
        return;
      }

      if (action === "comment") {
        const modal = new ModalBuilder()
          .setCustomId(`comment_modal:${postId}`)
          .setTitle("Adicionar comentário");

        const input = new TextInputBuilder()
          .setCustomId("comment_text")
          .setLabel("Escreva seu comentário")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(800)
          .setPlaceholder("Digite seu comentário...");

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        return;
      }

      if (action === "viewcomments") {
        const comments = db.prepare(
          "SELECT user_id, content, created_at FROM comments WHERE post_id = ? ORDER BY id DESC LIMIT 10"
        ).all(postId).reverse();

        if (!comments.length) {
          return interaction.reply({ content: "Ainda não há comentários nesta publicação.", ephemeral: true });
        }

        const description = comments.map(c =>
          `**<@${c.user_id}>**\n${c.content.replace(/@everyone|@here/g, "@​$&")}`
        ).join("\n\n").slice(0, 4000);

        const embed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle(`💬 Comentários da publicação #${postId}`)
          .setDescription(description)
          .setFooter({ text: "Mostrando os 10 comentários mais recentes." });

        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("config_modal:")) {
      if (!interaction.inGuild() || !memberHasConfigRole(interaction.member)) {
        return interaction.reply({ content: "Somente membros com o cargo autorizado podem alterar as configurações.", ephemeral: true });
      }
      const kind = interaction.customId.slice("config_modal:".length);
      await interaction.deferReply({ ephemeral: true });

      if (kind === "content") {
        const title = interaction.fields.getTextInputValue("title").trim();
        const description = interaction.fields.getTextInputValue("description").trim();
        const footer = interaction.fields.getTextInputValue("footer").trim();
        const nextTitle = title || defaultPanelTitle;
        const nextDescription = description || defaultPanelDescription;
        if (!fitsDiscordEmbedTextLimit(nextTitle, nextDescription, footer)) {
          return interaction.editReply("O título, a descrição e o rodapé juntos não podem ultrapassar 6.000 caracteres.");
        }
        setGuildSetting(interaction.guildId, "panel_title", nextTitle);
        setGuildSetting(interaction.guildId, "panel_description", nextDescription);
        setGuildSetting(interaction.guildId, "panel_footer", footer);
      } else if (kind === "images") {
        const banner = interaction.fields.getTextInputValue("banner").trim();
        const thumbnail = interaction.fields.getTextInputValue("thumbnail").trim();
        if ((banner && !isValidHttpsUrl(banner)) || (thumbnail && !isValidHttpsUrl(thumbnail))) {
          return interaction.editReply("Banner e thumbnail precisam ser URLs HTTPS válidas.");
        }
        setGuildSetting(interaction.guildId, "panel_banner", banner);
        setGuildSetting(interaction.guildId, "panel_thumbnail", thumbnail);
      } else if (kind === "channel") {
        const value = interaction.fields.getTextInputValue("channel").trim();
        if (value) {
          const channelId = value.match(/^<#(\d+)>$/)?.[1] || value;
          if (!/^\d{17,20}$/.test(channelId)) {
            return interaction.editReply("Informe a menção ou o ID de um canal de texto válido.");
          }
          const channel = await interaction.guild.channels.fetch(channelId);
          if (!channel?.isTextBased()) {
            return interaction.editReply("O canal informado não existe ou não aceita mensagens.");
          }
          setGuildSetting(interaction.guildId, "post_channel_id", channel.id);
        } else {
          db.prepare("DELETE FROM guild_settings WHERE guild_id = ? AND setting_key = 'post_channel_id'")
            .run(interaction.guildId);
        }
      } else {
        return interaction.editReply("Essa opção de configuração não é válida.");
      }

      await refreshGuildConfiguration(interaction.guildId);
      await interaction.editReply("Configuração salva e aplicada às mensagens existentes.");
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("comment_modal:")) {
      const postId = Number(interaction.customId.split(":")[1]);
      const post = db.prepare("SELECT id FROM posts WHERE id = ?").get(postId);
      if (!post) {
        return interaction.reply({ content: "Essa publicação não foi encontrada.", ephemeral: true });
      }

      const content = interaction.fields.getTextInputValue("comment_text").trim();
      if (!content) {
        return interaction.reply({ content: "O comentário não pode ficar vazio.", ephemeral: true });
      }

      db.prepare("INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)")
        .run(postId, interaction.user.id, content);

      await refreshPost(postId);
      await interaction.reply({ content: "Comentário publicado! 💬", ephemeral: true });
      return;
    }
  } catch (error) {
    console.error("Erro ao processar interação:", error);
    const message = "Ocorreu um erro ao processar essa ação.";
    if (interaction.isRepliable()) {
      try {
        if (interaction.deferred) {
          await interaction.editReply(message);
        } else if (interaction.replied) {
          await interaction.followUp({ content: message, ephemeral: true });
        } else {
          await interaction.reply({ content: message, ephemeral: true });
        }
      } catch (replyError) {
        console.error("Não foi possível informar o erro ao usuário:", replyError);
      }
    }
  }
});

client.on("messageCreate", async message => {
  if (!message.guild || message.author.bot) return;

  const emojiCommand = message.content.match(/^!emj(?:\s+([\s\S]*))?$/i);
  if (emojiCommand) {
    await handleEmojiCommand(message, emojiCommand[1] || "");
    return;
  }

  const command = message.content.match(/^!painel(?:\s+([\s\S]*))?$/i);
  if (command) {
    const args = (command[1] || "").trim();
    const configMatch = args.match(/^configurar(?:\s+([\s\S]*))?$/i);
    if (configMatch) {
      if (!memberHasConfigRole(message.member)) {
        await message.reply("Somente membros com o cargo autorizado podem alterar as configurações.");
        return;
      }

      const setting = (configMatch[1] || "").trim();
      if (!setting) {
        await trackPanelsInChannel(message.channel, message.guild.id);
        try {
          await message.author.send(createConfigDashboardPayload(message.guild.id));
          await message.reply("Enviei o painel de configuração por mensagem direta.");
        } catch (error) {
          console.error("Não foi possível abrir o painel de configuração por mensagem direta:", error);
          await message.reply("Não consegui enviar sua configuração por mensagem direta. Ative as mensagens diretas do servidor e tente novamente.");
        }
        return;
      }

      const [name, ...valueParts] = setting.split(/\s+/);
      const value = valueParts.join(" ").trim();
      const settingNames = {
        canal: "post_channel_id",
        titulo: "panel_title",
        descricao: "panel_description",
        cor: "panel_color",
        banner: "panel_banner",
        thumbnail: "panel_thumbnail",
        rodape: "panel_footer",
        botao: "button_style"
      };
      const settingKey = name && Object.prototype.hasOwnProperty.call(settingNames, name.toLowerCase())
        ? settingNames[name.toLowerCase()]
        : null;

      if (!settingKey || !value) {
        await message.reply(
          "Use `!painel configurar` para abrir o menu visual ou configure `canal`, `titulo`, `descricao`, `cor`, `banner`, `thumbnail`, `rodape` e `botao`."
        );
        return;
      }

      const key = settingKey;
      if (key === "post_channel_id") {
        const channelId = value.match(/^<#(\d+)>$/)?.[1] || value;
        if (!/^\d{17,20}$/.test(channelId)) {
          await message.reply("Informe um canal de texto válido, por exemplo: `!painel configurar canal #publicações`.");
          return;
        }
        let channel;
        try {
          channel = await message.guild.channels.fetch(channelId);
        } catch (error) {
          console.error("Erro ao buscar canal de publicacoes:", error);
          await message.reply("Não foi possível acessar esse canal. Verifique o ID e as permissões do bot.");
          return;
        }
        if (!channel || !channel.isTextBased()) {
          await message.reply("O canal informado não existe ou não aceita mensagens.");
          return;
        }
        setGuildSetting(message.guild.id, key, channel.id);
        await refreshGuildConfiguration(message.guild.id);
        await message.reply(`Canal de publicações definido para <#${channel.id}>.`);
        return;
      }

      if (key === "panel_title" && value.length > 256) {
        await message.reply("O título pode ter no máximo 256 caracteres.");
        return;
      }
      if (key === "panel_description" && value.length > 4000) {
        await message.reply("A descrição pode ter no máximo 4000 caracteres.");
        return;
      }
      if (key === "panel_footer" && value.length > 2048) {
        await message.reply("O rodapé pode ter no máximo 2048 caracteres.");
        return;
      }
      if (key === "panel_color" && !/^#?[0-9a-f]{6}$/i.test(value)) {
        await message.reply("A cor deve estar no formato `#RRGGBB`, por exemplo `#000000`.");
        return;
      }
      if ((key === "panel_banner" || key === "panel_thumbnail") && !isValidHttpsUrl(value)) {
        await message.reply("Banner e thumbnail precisam ser URLs HTTPS válidas.");
        return;
      }
      if ((key === "panel_title" || key === "panel_description" || key === "panel_footer")) {
        const config = getGuildConfig(message.guild.id);
        const title = key === "panel_title" ? value : config.panelTitle;
        const description = key === "panel_description" ? value : config.panelDescription;
        const footer = key === "panel_footer" ? value : config.panelFooter;
        if (!fitsDiscordEmbedTextLimit(title, description, footer)) {
          await message.reply("O título, a descrição e o rodapé juntos não podem ultrapassar 6.000 caracteres.");
          return;
        }
      }
      if (key === "button_style") {
        const styleNames = {
          azul: "Primary",
          cinza: "Secondary",
          verde: "Success",
          vermelho: "Danger"
        };
        const style = styleNames[value.toLowerCase()] || value;
        if (!Object.prototype.hasOwnProperty.call(buttonStyles, style)) {
          await message.reply("Cor do botão inválida. Escolha `azul`, `cinza`, `verde` ou `vermelho`.");
          return;
        }
        setGuildSetting(message.guild.id, key, style);
        await refreshGuildConfiguration(message.guild.id);
        await message.reply("Configuração salva e aplicada às mensagens existentes.");
        return;
      }

      setGuildSetting(
        message.guild.id,
        key,
        key === "panel_color" ? value.replace(/^#/, "").toLowerCase() : value
      );
      await refreshGuildConfiguration(message.guild.id);
      await message.reply("Configuração salva e aplicada às mensagens existentes.");
      return;
    }

    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      await message.reply("Somente administradores podem enviar o painel.");
      return;
    }

    await sendPanel(message.channel, message.guild.id);
    return;
  }

});

if (process.env.PORT) {
  const healthServer = http.createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        status: "ok",
        discord: client.isReady() ? "ready" : "connecting"
      }));
      return;
    }

    response.writeHead(404);
    response.end();
  });

  healthServer.listen(Number(process.env.PORT), "0.0.0.0", () => {
    console.log(`Health endpoint listening on port ${process.env.PORT}`);
  });
}

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error("Discord login failed:", error);
  process.exit(1);
});
