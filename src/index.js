require('dotenv').config();

// Mantm o processo vivo em rejeições assíncronas conhecidas do sistema de voz.
process.on('unhandledRejection', (reason) => {
  const message = String(reason?.message || reason || '');
  if (message.includes('Shard 0 not found') || message.includes('Cannot perform IP discovery - socket closed')) {
    console.warn(`[Voice] Rejeição assóncrona de voz ignorada: ${message}`);
    return;
  }
  console.error('[unhandledRejection]', reason);
});

const dns = require('dns');

dns.setDefaultResultOrder('ipv4first');



const http = require('http');

const fs = require('fs');

const path = require('path');



const {

  ActionRowBuilder,

  ButtonBuilder,

  ButtonStyle,

  ChannelType,

  Client,

  Events,

  GatewayIntentBits,

  MessageFlags,

  Partials,

  ModalBuilder,

  PermissionFlagsBits,

  REST,

  Routes,

  SlashCommandBuilder,

  TextInputBuilder,

  TextInputStyle,

  EmbedBuilder,

  StringSelectMenuBuilder,

  StringSelectMenuOptionBuilder

} = require('discord.js');



const {

  joinVoiceChannel,

  VoiceConnectionStatus,

  entersState

} = require('@discordjs/voice');



let Pool = null;



try {

  ({ Pool } = require('pg'));

} catch {

  console.warn(

    '[DB] Pacote pg não instalado. Instale com: npm i pg'

  );

}



const token = process.env.DISCORD_TOKEN;



if (!token) {

  console.error(

    'ERRO CRÍTICO: Defina DISCORD_TOKEN no .env.'

  );

  process.exit(1);

}



const GUILD_ID = process.env.GUILD_ID || '';



const aiChannelId =

  process.env.AI_CHANNEL_ID ||

  '1551729250615304304';



const TARGET_MATCH_CHANNEL_ID =

  process.env.MATCH_CHANNEL_ID ||

  '1549490004185849920';



const VOICE_CHANNEL_ID =

  process.env.VOICE_CHANNEL_ID ||

  '1551460062642438235';



const MATCH_CONFIG_ROLE_ID =

  process.env.MATCH_CONFIG_ROLE_ID ||

  '1552018175736946690';



const MATCH_NOTIFY_ROLE_ID =

  process.env.MATCH_NOTIFY_ROLE_ID ||

  '1551216479150669867';



const MATCH_ROLE_ID =

  process.env.MATCH_ROLE_ID ||

  '1553132830500855939';



const VERIFY_ROLE_ID =

  process.env.VERIFY_ROLE_ID || '';



const TEMP_VOICE_CATEGORY_ID =

  process.env.TEMP_VOICE_CATEGORY_ID ||

  '1553642854138511431';



const COMMAND_ACCESS_ROLE_ID =

  '1552018175736946690';


// Canal que recebe as mensagens privadas enviadas ao bot.
const DM_LOG_CHANNEL_ID =
  process.env.DM_LOG_CHANNEL_ID ||
  '1551958147252490320';



const TEMP_VOICE_CREATE_CHANNEL_ID =

  process.env.TEMP_VOICE_CREATE_CHANNEL_ID || '';


const RULES_CHANNEL_ID =
  process.env.RULES_CHANNEL_ID ||
  '1553128220260573306';

const RULES_CONFIG_FILE =
  path.join(__dirname, 'rules-panel-config.json');

let rulesPanelConfig = {
  title: '= Regras do Servidor',
  description: 'Leia e siga as regras do servidor para manter a comunidade organizada e segura.',
  color: '#5865F2',
  banner: '',
  icon: '',
  footer: 'Leia com atenção antes de participar.',
  rulesText: '1= Respeite todos os membros.\n\n2= Não faía spam ou flood.\n\n3= Não divulgue servidores, links ou servios sem autorização.\n\n4= Use cada canal para sua finalidade.\n\n5= Siga as regras do Discord e as orientaíes da equipe.',
  messageId: ''
};

try {
  if (fs.existsSync(RULES_CONFIG_FILE)) {
    rulesPanelConfig = {
      ...rulesPanelConfig,
      ...JSON.parse(fs.readFileSync(RULES_CONFIG_FILE, 'utf8'))
    };
  }
} catch (e) {
  console.warn('[Rules] Erro ao carregar configuração:', e.message);
}

function saveRulesPanelConfig() {
  try {
    fs.writeFileSync(RULES_CONFIG_FILE, JSON.stringify(rulesPanelConfig, null, 2), 'utf8');
  } catch (e) {
    console.error('[Rules] Erro ao salvar configuração:', e.message);
  }
}

function isRulesPanelAdmin(member) {
  return Boolean(
    member?.permissions?.has(PermissionFlagsBits.Administrator) ||
    member?.roles?.cache?.has(COMMAND_ACCESS_ROLE_ID)
  );
}

function buildRulesPanelPayload() {
  const embed = createEmbed({
    title: rulesPanelConfig.title || '= Regras do Servidor',
    description: `${rulesPanelConfig.description || ''}\n\n${rulesPanelConfig.rulesText || 'Nenhuma regra configurada.'}`.slice(0, 4096),
    color: rulesPanelConfig.color || '#5865F2',
    footer: rulesPanelConfig.footer || undefined
  });

  if (rulesPanelConfig.banner) embed.setImage(rulesPanelConfig.banner);
  if (rulesPanelConfig.icon) embed.setThumbnail(rulesPanelConfig.icon);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('rules_admin_edit')
          .setLabel('Editar regras')
          .setEmoji('=')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('rules_admin_appearance')
          .setLabel('Alterar aparência')
          .setEmoji('<')
          .setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

async function refreshRulesPanel(guild) {
  if (!guild) return false;
  const channel = await guild.channels.fetch(RULES_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) {
    console.warn(`[Rules] Canal ${RULES_CHANNEL_ID} não encontrado ou não  de texto.`);
    return false;
  }

  const me = channel.guild.members.me || await channel.guild.members.fetchMe().catch(() => null);
  const permissions = me ? channel.permissionsFor(me) : null;
  if (permissions && !permissions.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.EmbedLinks])) {
    const missing = [
      [PermissionFlagsBits.ViewChannel, 'Ver canal'],
      [PermissionFlagsBits.SendMessages, 'Enviar mensagens'],
      [PermissionFlagsBits.ReadMessageHistory, 'Ver histórico de mensagens'],
      [PermissionFlagsBits.ManageMessages, 'Gerenciar mensagens'],
      [PermissionFlagsBits.EmbedLinks, 'Incorporar links']
    ].filter(([flag]) => !permissions.has(flag)).map(([, name]) => name);
    throw Object.assign(new Error(`Permissões ausentes: ${missing.join(', ')}`), { code: 50013, missing });
  }

  if (rulesPanelConfig.messageId) {
    const old = await channel.messages.fetch(rulesPanelConfig.messageId).catch(() => null);
    if (old) await old.delete();
  }

  const message = await channel.send(buildRulesPanelPayload());
  rulesPanelConfig.messageId = message.id;
  saveRulesPanelConfig();
  return true;
}

let rulesRefreshTimer = null;
function startRulesAutoRefresh() {
  if (rulesRefreshTimer) clearInterval(rulesRefreshTimer);

  const run = async () => {
    const guild = client.guilds.cache.find(g => g.channels.cache.has(RULES_CHANNEL_ID));
    if (!guild) return;
    try {
      await refreshRulesPanel(guild);
      console.log('[Rules] Mensagem de regras renovada.');
    } catch (e) {
      console.warn('[Rules] Erro ao renovar painel:', e.message);
    }
  };

  run();
  rulesRefreshTimer = setInterval(run, 5 * 60 * 1000);
}

async function handleRulesButton(interaction) {
  if (!isRulesPanelAdmin(interaction.member)) {
    return interaction.reply({ content: 'L Apenas administradores ou membros autorizados podem configurar as regras.', flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'rules_admin_edit') {
    const modal = new ModalBuilder().setCustomId('rules_edit_modal').setTitle('= Editar regras');

    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('Título')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(256)
      .setValue(String(rulesPanelConfig.title || '').slice(0, 256));

    const descriptionInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('Descrição')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(1000)
      .setValue(String(rulesPanelConfig.description || '').slice(0, 1000));

    const rulesInput = new TextInputBuilder()
      .setCustomId('rulesText')
      .setLabel('Texto das regras')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(3800)
      .setValue(String(rulesPanelConfig.rulesText || '').slice(0, 3800));

    modal.addComponents(
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(descriptionInput),
      new ActionRowBuilder().addComponents(rulesInput)
    );
    return interaction.showModal(modal);
  }

  if (interaction.customId === 'rules_admin_appearance') {
    const menu = new StringSelectMenuBuilder()
      .setCustomId('rules_appearance_select')
      .setPlaceholder('< Escolha o que deseja alterar')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('Título').setDescription('Altera o ttulo do embed.').setEmoji('').setValue('title'),
        new StringSelectMenuOptionBuilder().setLabel('Descrição').setDescription('Altera a descrição do embed.').setEmoji('=').setValue('description'),
        new StringSelectMenuOptionBuilder().setLabel('Cor').setDescription('Altera a cor hexadecimal.').setEmoji('<').setValue('color'),
        new StringSelectMenuOptionBuilder().setLabel('Banner').setDescription('Altera a imagem principal.').setEmoji('=').setValue('banner'),
        new StringSelectMenuOptionBuilder().setLabel('ícone / Thumbnail').setDescription('Altera a thumbnail.').setEmoji('=').setValue('icon'),
        new StringSelectMenuOptionBuilder().setLabel('Rodapé').setDescription('Altera o texto do rodap.').setEmoji('Y"O').setValue('footer')
      );
    return interaction.reply({ content: '< Escolha a aparência que deseja alterar:', components: [new ActionRowBuilder().addComponents(menu)], flags: MessageFlags.Ephemeral });
  }
}

async function handleRulesAppearanceSelect(interaction) {
  if (!isRulesPanelAdmin(interaction.member)) return interaction.reply({ content: 'L Você não possui permissão para configurar as regras.', flags: MessageFlags.Ephemeral });
  const option = interaction.values[0];
  const labels = { title:'Título', description:'Descrição', color:'Cor hexadecimal', banner:'URL do banner', icon:'URL do ícone/thumbnail', footer:'Rodapé' };
  const placeholders = { title:'= Regras do Servidor', description:'Leia as regras...', color:'#5865F2', banner:'https://...', icon:'https://...', footer:'Leia com atenção.' };
  const modal = new ModalBuilder().setCustomId(`rules_config_modal:${option}`).setTitle(`< ${labels[option]}`);
  const input = new TextInputBuilder().setCustomId('value').setLabel(labels[option]).setPlaceholder(placeholders[option]).setRequired(false).setStyle(option === 'description' || option === 'footer' ? TextInputStyle.Paragraph : TextInputStyle.Short).setMaxLength(1000);
  const current = String(rulesPanelConfig[option] || '');
  if (current) input.setValue(current.slice(0, 1000));
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

async function handleRulesModal(interaction) {
  if (!isRulesPanelAdmin(interaction.member)) {
    return interaction.reply({ content: 'L Você não possui permissão para configurar as regras.', flags: MessageFlags.Ephemeral });
  }

  // Toda atualização que pode apagar/enviar a mensagem precisa reconhecer a interação antes.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (interaction.customId === 'rules_edit_modal') {
      const title = interaction.fields.getTextInputValue('title').trim();
      const description = interaction.fields.getTextInputValue('description').trim();
      const rulesText = interaction.fields.getTextInputValue('rulesText').trim();

      rulesPanelConfig.title = title || '= Regras do Servidor';
      rulesPanelConfig.description = description;
      rulesPanelConfig.rulesText = rulesText;
      saveRulesPanelConfig();
      await refreshRulesPanel(interaction.guild);
      return interaction.editReply({ content: '. Título, descrição e texto das regras atualizados.' });
    }

    const option = interaction.customId.split(':')[1];
    const value = interaction.fields.getTextInputValue('value').trim();
    if (option === 'color' && value && !/^#[0-9A-Fa-f]{6}$/.test(value)) {
      return interaction.editReply({ content: 'L A cor deve estar no formato `#5865F2`.' });
    }
    if ((option === 'banner' || option === 'icon') && value && !/^https?:\/\//i.test(value)) {
      return interaction.editReply({ content: 'L Informe uma URL começando com `http://` ou `https://`.' });
    }

    rulesPanelConfig[option] = value;
    saveRulesPanelConfig();
    await refreshRulesPanel(interaction.guild);
    return interaction.editReply({ content: `. ${option} atualizado e o painel foi renovado.` });
  } catch (error) {
    console.error('[Rules] Erro ao atualizar configuração:', error);
    return interaction.editReply({ content: error?.code === 50013
      ? 'L O bot não tem permissão para apagar/enviar a mensagem no canal de regras. Dê **Gerenciar mensagens**, **Enviar mensagens**, **Ver histórico de mensagens** e **Incorporar links** no canal.'
      : 'L Não foi possível atualizar as regras. Verifique as permissões do bot e tente novamente.' });
  }
}




// ==================== REGRAS 2 ====================
const RULES2_CHANNEL_ID = '1553953899180728372';
const RULES2_CONFIG_FILE = path.join(__dirname, 'rules-panel-config-2.json');

let rules2Config = {
  title: '= Regras do Servidor',
  description: 'Leia e siga as regras do servidor para manter a comunidade organizada e segura.',
  color: '#5865F2',
  banner: '',
  icon: '',
  footer: 'Leia com atenção antes de participar.',
  rulesText: '1= Respeite todos os membros.\n\n2= Não faía spam ou flood.\n\n3= Não divulgue servidores, links ou servios sem autorização.\n\n4= Use cada canal para sua finalidade.\n\n5= Siga as regras do Discord e as orientaíes da equipe.',
  messageId: ''
};

try {
  if (fs.existsSync(RULES2_CONFIG_FILE)) {
    rules2Config = { ...rules2Config, ...JSON.parse(fs.readFileSync(RULES2_CONFIG_FILE, 'utf8')) };
  }
} catch (e) {
  console.warn('[Rules2] Erro ao carregar configuração:', e.message);
}

function saveRules2Config() {
  try { fs.writeFileSync(RULES2_CONFIG_FILE, JSON.stringify(rules2Config, null, 2), 'utf8'); }
  catch (e) { console.error('[Rules2] Erro ao salvar configuração:', e.message); }
}

function buildRules2Payload() {
  const embed = createEmbed({
    title: rules2Config.title || '= Regras do Servidor',
    description: `${rules2Config.description || ''}\n\n${rules2Config.rulesText || 'Nenhuma regra configurada.'}`.slice(0, 4096),
    color: rules2Config.color || '#5865F2',
    footer: rules2Config.footer || undefined
  });
  if (rules2Config.banner) embed.setImage(rules2Config.banner);
  if (rules2Config.icon) embed.setThumbnail(rules2Config.icon);
  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('rules2_admin_edit').setLabel('Editar regras').setEmoji('=').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('rules2_admin_appearance').setLabel('Alterar aparência').setEmoji('<').setStyle(ButtonStyle.Secondary)
    )]
  };
}

async function refreshRules2Panel(guild) {
  if (!guild) return false;
  const channel = await guild.channels.fetch(RULES2_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) throw new Error(`Canal ${RULES2_CHANNEL_ID} não encontrado ou não  de texto.`);
  const me = channel.guild.members.me || await channel.guild.members.fetchMe().catch(() => null);
  const permissions = me ? channel.permissionsFor(me) : null;
  if (permissions && !permissions.has([
    PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.EmbedLinks
  ])) throw Object.assign(new Error('Permissões insuficientes no canal de regras 2.'), {code:50013});
  if (rules2Config.messageId) {
    const old = await channel.messages.fetch(rules2Config.messageId).catch(() => null);
    if (old) await old.delete().catch(() => {});
  }
  const msg = await channel.send(buildRules2Payload());
  rules2Config.messageId = msg.id;
  saveRules2Config();
  return true;
}

async function startRules2AutoRefresh() {
  const run = async () => {
    const guild = client.guilds.cache.find(g => g.channels.cache.has(RULES2_CHANNEL_ID));
    if (!guild) return;
    try {
      await refreshRules2Panel(guild);
      console.log('[Rules2] Mensagem de regras renovada.');
    } catch (e) {
      console.warn('[Rules2] Erro ao renovar painel:', e.message);
    }
  };
  await run();
  if (globalThis.__rules2Timer) clearInterval(globalThis.__rules2Timer);
  globalThis.__rules2Timer = setInterval(run, 5 * 60 * 1000);
}

async function handleRules2Button(interaction) {
  if (!isRulesPanelAdmin(interaction.member))
    return interaction.reply({content:'L Apenas administradores ou membros autorizados podem configurar as regras.', flags:MessageFlags.Ephemeral});

  if (interaction.customId === 'rules2_admin_edit') {
    const modal = new ModalBuilder().setCustomId('rules2_edit_modal').setTitle('= Editar regras 2');
    const title = new TextInputBuilder().setCustomId('title').setLabel('Título').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256).setValue(String(rules2Config.title||'').slice(0,256));
    const desc = new TextInputBuilder().setCustomId('description').setLabel('Descrição').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000).setValue(String(rules2Config.description||'').slice(0,1000));
    const text = new TextInputBuilder().setCustomId('rulesText').setLabel('Texto das regras').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(3800).setValue(String(rules2Config.rulesText||'').slice(0,3800));
    modal.addComponents(new ActionRowBuilder().addComponents(title),new ActionRowBuilder().addComponents(desc),new ActionRowBuilder().addComponents(text));
    return interaction.showModal(modal);
  }

  const menu = new StringSelectMenuBuilder().setCustomId('rules2_appearance_select').setPlaceholder('< Escolha o que deseja alterar').addOptions(
    new StringSelectMenuOptionBuilder().setLabel('Título').setDescription('Altera o ttulo do embed.').setEmoji('').setValue('title'),
    new StringSelectMenuOptionBuilder().setLabel('Descrição').setDescription('Altera a descrição do embed.').setEmoji('=').setValue('description'),
    new StringSelectMenuOptionBuilder().setLabel('Cor').setDescription('Altera a cor hexadecimal.').setEmoji('<').setValue('color'),
    new StringSelectMenuOptionBuilder().setLabel('Banner').setDescription('Altera a imagem principal.').setEmoji('=').setValue('banner'),
    new StringSelectMenuOptionBuilder().setLabel('ícone / Thumbnail').setDescription('Altera a thumbnail.').setEmoji('=').setValue('icon'),
    new StringSelectMenuOptionBuilder().setLabel('Rodapé').setDescription('Altera o texto do rodap.').setEmoji('Y"O').setValue('footer')
  );
  return interaction.reply({content:'< Escolha a aparência que deseja alterar:',components:[new ActionRowBuilder().addComponents(menu)],flags:MessageFlags.Ephemeral});
}

async function handleRules2Appearance(interaction) {
  if (!isRulesPanelAdmin(interaction.member)) return interaction.reply({content:'L Você não possui permissão.',flags:MessageFlags.Ephemeral});
  const option=interaction.values[0];
  const labels={title:'Título',description:'Descrição',color:'Cor hexadecimal',banner:'URL do banner',icon:'URL do ícone/thumbnail',footer:'Rodapé'};
  const placeholders={title:'= Regras do Servidor',description:'Leia as regras...',color:'#5865F2',banner:'https://...',icon:'https://...',footer:'Leia com atenção.'};
  const modal=new ModalBuilder().setCustomId(`rules2_config_modal:${option}`).setTitle(`< ${labels[option]}`);
  const input=new TextInputBuilder().setCustomId('value').setLabel(labels[option]).setPlaceholder(placeholders[option]).setRequired(false).setStyle(option==='description'||option==='footer'?TextInputStyle.Paragraph:TextInputStyle.Short).setMaxLength(1000);
  const current=String(rules2Config[option]||''); if(current) input.setValue(current.slice(0,1000));
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

async function handleRules2Modal(interaction) {
  if (!isRulesPanelAdmin(interaction.member)) return interaction.reply({content:'L Você não possui permissão.',flags:MessageFlags.Ephemeral});
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  try {
    if (interaction.customId==='rules2_edit_modal') {
      rules2Config.title=interaction.fields.getTextInputValue('title').trim()||'= Regras do Servidor';
      rules2Config.description=interaction.fields.getTextInputValue('description').trim();
      rules2Config.rulesText=interaction.fields.getTextInputValue('rulesText').trim();
      saveRules2Config(); await refreshRules2Panel(interaction.guild);
      return interaction.editReply({content:'. Regras 2 atualizadas.'});
    }
    const option=interaction.customId.split(':')[1];
    const value=interaction.fields.getTextInputValue('value').trim();
    if(option==='color' && value && !/^#[0-9A-Fa-f]{6}$/.test(value)) return interaction.editReply({content:'L A cor deve estar no formato `#5865F2`.'});
    if((option==='banner'||option==='icon') && value && !/^https?:\/\//i.test(value)) return interaction.editReply({content:'L Informe uma URL começando com `http://` ou `https://`.'});
    rules2Config[option]=value; saveRules2Config(); await refreshRules2Panel(interaction.guild);
    return interaction.editReply({content:`. ${option} atualizado no painel 2.`});
  } catch(e) {
    console.error('[Rules2] Erro:',e);
    return interaction.editReply({content:'L Não foi possível atualizar o painel 2. Verifique as permissões do bot no canal.'});
  }
}
// ==================== FIM REGRAS 2 ====================

const STAFF_ALERT_CHANNEL_ID =

  process.env.STAFF_ALERT_CHANNEL_ID || '';



const LOG_CHANNEL_ID =

  process.env.LOG_CHANNEL_ID || '';

const MUTE_LOG_CHANNEL_ID =
  process.env.MUTE_LOG_CHANNEL_ID || '';

const BAN_LOG_CHANNEL_ID =
  process.env.BAN_LOG_CHANNEL_ID || '';



const DASHBOARD_KEY =

  process.env.DASHBOARD_KEY || '';



const port =

  Number(process.env.PORT) || 3000;



const MATCH_CONFIG_FILE =

  path.join(__dirname, 'match-config.json');



let matchConfig = {

  title: '= Central de Match & Conexes',

  description:

    'Escolha uma categoria para criar seu perfil de Match.',

  color: '#ff2a6d',

  banner: '',

  icon: '',

  panelChannelId: '',

  panelMessageId: ''

};



try {

  if (fs.existsSync(MATCH_CONFIG_FILE)) {

    matchConfig = {

      ...matchConfig,

      ...JSON.parse(

        fs.readFileSync(

          MATCH_CONFIG_FILE,

          'utf8'

        )

      )

    };

  }

} catch (e) {

  console.warn(

    '[Match] Erro ao carregar configuração:',

    e.message

  );

}



function saveMatchConfig() {

  try {

    fs.writeFileSync(

      MATCH_CONFIG_FILE,

      JSON.stringify(

        matchConfig,

        null,

        2

      ),

      'utf8'

    );

  } catch (e) {

    console.error(

      '[Match] Erro ao salvar:',

      e.message

    );

  }

}





const TEMP_VOICE_CONFIG_FILE =

  path.join(__dirname, 'temp-voice-config.json');



let tempVoiceConfig = {
  title: 'Salas de Voz Temporárias',
  description:
    'Clique no menu abaixo para criar e administrar sua sala de voz.\n\nAs salas vazias são excluídas automaticamente conforme o tempo configurado.',
  color: '#5865F2',
  banner: '',
  icon: '',
  footer: 'Call Priv - Configuração dinâmica',
  defaultName: '🔊 {user}',
  categoryId: TEMP_VOICE_CATEGORY_ID || '',
  deleteAfterMinutes: 5,
  userLimit: 0,
  authorizedRoleId: COMMAND_ACCESS_ROLE_ID || '',
  options: {
    create: true, rename: true, lock: true, unlock: true,
    limit: true, kick: true, transfer: true, delete: true
  },
  panelChannelId: '',
  panelMessageId: ''
};

try {

  if (fs.existsSync(TEMP_VOICE_CONFIG_FILE)) {

    tempVoiceConfig = {

      ...tempVoiceConfig,

      ...JSON.parse(

        fs.readFileSync(

          TEMP_VOICE_CONFIG_FILE,

          'utf8'

        )

      )

    };

  }

} catch (e) {

  console.warn(

    '[TempVoice] Erro ao carregar configuração:',

    e.message

  );

}



normalizeTempVoiceConfig();

function saveTempVoiceConfig() {

  try {

    fs.writeFileSync(

      TEMP_VOICE_CONFIG_FILE,

      JSON.stringify(

        tempVoiceConfig,

        null,

        2

      ),

      'utf8'

    );

  } catch (e) {

    console.error(

      '[TempVoice] Erro ao salvar configuração:',

      e.message

    );

  }

}



function isTempVoicePanelAdmin(member) {
  const roleId =
    tempVoiceConfig.authorizedRoleId ||
    COMMAND_ACCESS_ROLE_ID;

  return Boolean(
    member?.roles?.cache?.has(roleId) ||
    member?.permissions?.has(PermissionFlagsBits.Administrator)
  );
}

function getTempVoiceOptionLabel(option) {
  const labels = {
    create: 'Criar minha sala', rename: 'Renomear sala', lock: 'Bloquear sala',
    unlock: 'Desbloquear sala', limit: 'Alterar limite', kick: 'Expulsar membro',
    transfer: 'Transferir posse', delete: 'Excluir sala'
  };
  return labels[option] || option;
}

function getTempVoiceOptionDescription(option) {
  const descriptions = {
    create: 'Cria uma sala e permite apenas uma sala por membro.',
    rename: 'Altera o nome da sua sala.', lock: 'Impede novas pessoas de entrarem.',
    unlock: 'Permite novamente a entrada.', limit: 'Define o limite de pessoas na sala.',
    kick: 'Escolhe um membro para remover da sala.',
    transfer: 'Escolhe outro membro como dono da sala.', delete: 'Exclui imediatamente sua sala temporária.'
  };
  return descriptions[option] || '';
}

function normalizeTempVoiceConfig() {
  tempVoiceConfig.color = normalizeHexColor(tempVoiceConfig.color);
  tempVoiceConfig.deleteAfterMinutes = Math.max(1, Math.min(10080, Number(tempVoiceConfig.deleteAfterMinutes) || 5));
  tempVoiceConfig.userLimit = Math.max(0, Math.min(99, Number(tempVoiceConfig.userLimit) || 0));
  tempVoiceConfig.options = {
    create: true, rename: true, lock: true, unlock: true,
    limit: true, kick: true, transfer: true, delete: true,
    ...(tempVoiceConfig.options || {})
  };
  tempVoiceConfig.options.create = true;
}

function resetTempVoiceConfig() {
  const panelChannelId = tempVoiceConfig.panelChannelId || '';
  const panelMessageId = tempVoiceConfig.panelMessageId || '';
  tempVoiceConfig = {
    title: 'Salas de Voz Temporárias',
    description: 'Clique no menu abaixo para criar e administrar sua sala de voz.\n\nAs salas vazias são excluídas automaticamente conforme o tempo configurado.',
    color: '#5865F2', banner: '', icon: '', footer: 'Call Priv - Configuração dinâmica',
    defaultName: '🔊 {user}', categoryId: TEMP_VOICE_CATEGORY_ID || '',
    deleteAfterMinutes: 5, userLimit: 0,
    authorizedRoleId: COMMAND_ACCESS_ROLE_ID || '',
    options: { create: true, rename: true, lock: true, unlock: true, limit: true, kick: true, transfer: true, delete: true },
    panelChannelId, panelMessageId
  };
}



let formulario;



try {

  formulario = require('./formulario');

} catch (e) {

  console.warn(

    '[Formulario] Módulo não carregado:',

    e.message

  );

}



let dmCommand;



try {

  dmCommand = require('./commands/dm');

} catch (e) {

  console.warn(

    '[DM] Módulo não carregado:',

    e.message

  );

}



const client = new Client({

  intents: [

    GatewayIntentBits.Guilds,

    GatewayIntentBits.GuildMembers,

    GatewayIntentBits.GuildMessages,

    GatewayIntentBits.MessageContent,

    GatewayIntentBits.GuildVoiceStates,

    GatewayIntentBits.DirectMessages

  ],

  partials: [Partials.Channel]

});



const spamHistory = new Map();



const processedAiMessages =

  new Set();



const pendingVerification =

  new Map();



const tempRooms =

  new Map();

const TEMP_VOICE_ROOMS_FILE =
  path.join(__dirname, 'temp-voice-rooms.json');

function saveTempRooms() {
  try {
    const rooms = [...tempRooms.entries()].map(([channelId, data]) => ({
      channelId,
      guildId: data.guildId,
      ownerId: data.ownerId,
      createdAt: data.createdAt || Date.now()
    }));

    fs.writeFileSync(
      TEMP_VOICE_ROOMS_FILE,
      JSON.stringify(rooms, null, 2),
      'utf8'
    );
  } catch (e) {
    console.warn('[TempVoice] Erro ao salvar donos das salas:', e.message);
  }
}

function loadTempRooms() {
  try {
    if (!fs.existsSync(TEMP_VOICE_ROOMS_FILE)) return;

    const rooms = JSON.parse(
      fs.readFileSync(TEMP_VOICE_ROOMS_FILE, 'utf8')
    );

    if (!Array.isArray(rooms)) return;

    for (const room of rooms) {
      if (!room?.channelId || !room?.guildId || !room?.ownerId) continue;

      tempRooms.set(room.channelId, {
        guildId: room.guildId,
        ownerId: room.ownerId,
        createdAt: Number(room.createdAt) || Date.now(),
        emptyTimer: null
      });
    }
  } catch (e) {
    console.warn('[TempVoice] Erro ao carregar donos das salas:', e.message);
  }
}

loadTempRooms();



const aiAttentionCooldown =

  new Map();



const voiceSessions =

  new Map();



const voiceHoursLocal =

  new Map();



const liveRankPanels =

  new Map();



const RANK_CALL_CHANNEL_ID =

  '1553979838698885200';



const RANK_CALL_CONFIG_FILE =

  path.join(

    __dirname,

    'rank-call-config.json'

  );

const RANK_CALL_STREAKS_FILE =

  path.join(

    __dirname,

    'rank-call-streaks.json'

  );

const RANK_CALL_BACKUP_DIR =

  path.join(

    __dirname,

    '..',

    'rankcall-backups'

  );

const RANK_CALL_TIMEZONE =

  process.env.RANKCALL_TIMEZONE ||

    'America/Sao_Paulo';

const RANK_CALL_STREAK_EMOJI = '<a:fogo:1554010995993608272>';
const RANK_CALL_STREAK_MINUTES = 30;
const RANK_CALL_STREAK_MIN_SECONDS = RANK_CALL_STREAK_MINUTES * 60;



const VOICE_HOURS_FILE =

  path.join(

    __dirname,

    'voice-hours.json'

  );


const VOICE_LIVE_SESSIONS_FILE =

  path.join(

    __dirname,

    'voice-live-sessions.json'

  );



const AFK_USERS_FILE =

  path.join(

    __dirname,

    'afk-users.json'

  );

const AFK_VOICE_CHANNEL_ID = '1551460062642438235';
const AFK_NICK_PREFIX = 'AFK | ';
const AFK_WARNING_DELETE_MS = 60 * 1000;
const AFK_MOVE_CONFIRM_TIMEOUT_MS = 60 * 1000;
const AFK_MOVE_CONFIRM_PREFIX = 'afk_move_confirm:';
const pendingAfkMoveConfirmations = new Map();
const afkUsers = new Map();

const DEFAULT_RANK_CALL_CONFIG = {
  channelId: RANK_CALL_CHANNEL_ID,
  messageId: null,
  page: 0,
  title: 'Ranking de Macacos <:pureza_a:1553959213045121104>',
  description: 'Acompanhe em tempo real as horas acumuladas em call.',
  color: '#000000',
  icon: '',
  banner: '',
  streakPage: 0
};

let rankCallConfig = { ...DEFAULT_RANK_CALL_CONFIG };

const rankCallStreaks = new Map();
let rankCallBackupTimer = null;



function loadRankCallConfig() {
  try {
    if (!fs.existsSync(RANK_CALL_CONFIG_FILE)) return;
    const data = JSON.parse(fs.readFileSync(RANK_CALL_CONFIG_FILE, 'utf8'));
    rankCallConfig = {
      ...DEFAULT_RANK_CALL_CONFIG,
      ...data,
      color: normalizeHexColor(data?.color || DEFAULT_RANK_CALL_CONFIG.color)
    };
  } catch (e) {
    console.warn('[RankCall] Erro ao carregar configuração:', e.message);
  }
}

function saveRankCallConfig() {
  try {
    fs.writeFileSync(RANK_CALL_CONFIG_FILE, JSON.stringify(rankCallConfig, null, 2), 'utf8');
  } catch (e) {
    console.warn('[RankCall] Erro ao salvar configuração:', e.message);
  }
}

function loadVoiceHoursLocal() {
  try {
    if (!fs.existsSync(VOICE_HOURS_FILE)) return;
    const data = JSON.parse(fs.readFileSync(VOICE_HOURS_FILE, 'utf8'));
    for (const [key, value] of Object.entries(data || {})) {
      const seconds = Number(value);
      if (key.includes(':') && Number.isFinite(seconds) && seconds >= 0) {
        voiceHoursLocal.set(key, Math.floor(seconds));
      }
    }
  } catch (e) {
    console.warn('[RankCall] Erro ao carregar horas locais:', e.message);
  }
}

function saveVoiceHoursLocal() {
  try {
    fs.writeFileSync(VOICE_HOURS_FILE, JSON.stringify(Object.fromEntries(voiceHoursLocal), null, 2), 'utf8');
    return true;
  } catch (e) {
    console.warn('[RankCall] Erro ao salvar horas locais:', e.message);
    return false;
  }
}

function loadVoiceSessionsLocal() {
  try {
    if (!fs.existsSync(VOICE_LIVE_SESSIONS_FILE)) return;
    const data = JSON.parse(fs.readFileSync(VOICE_LIVE_SESSIONS_FILE, 'utf8'));
    for (const [key, value] of Object.entries(data || {})) {
      const startedAt = Number(value);
      if (Number.isFinite(startedAt) && startedAt > 0) {
        voiceSessions.set(key, startedAt);
      }
    }
  } catch (e) {
    console.warn('[RankCall] Erro ao carregar sessões ativas:', e.message);
  }
}

function saveVoiceSessionsLocal() {
  try {
    fs.writeFileSync(VOICE_LIVE_SESSIONS_FILE, JSON.stringify(Object.fromEntries(voiceSessions), null, 2), 'utf8');
  } catch (e) {
    console.warn('[RankCall] Erro ao salvar sessões ativas:', e.message);
  }
}

function loadAfkUsers() {
  try {
    if (!fs.existsSync(AFK_USERS_FILE)) return;
    const data = JSON.parse(fs.readFileSync(AFK_USERS_FILE, 'utf8'));
    for (const [key, raw] of Object.entries(data || {})) {
      if (!key.includes(':') || !raw || typeof raw !== 'object') continue;
      const [fallbackGuildId, fallbackUserId] = key.split(':');
      const guildId = String(raw.guildId || fallbackGuildId || '');
      const userId = String(raw.userId || fallbackUserId || '');
      if (!guildId || !userId) continue;
      afkUsers.set(`${guildId}:${userId}`, {
        guildId,
        userId,
        originalNickname: raw.originalNickname ?? null,
        activatedAt: Number(raw.activatedAt) || Date.now()
      });
    }
    if (afkUsers.size) console.log(`[AFK] ${afkUsers.size} usuário(s) AFK carregado(s).`);
  } catch (e) {
    console.warn('[AFK] Erro ao carregar usuários AFK:', e.message);
  }
}

function saveAfkUsers() {
  try {
    fs.writeFileSync(AFK_USERS_FILE, JSON.stringify(Object.fromEntries(afkUsers), null, 2), 'utf8');
  } catch (e) {
    console.warn('[AFK] Erro ao salvar usuários AFK:', e.message);
  }
}

function getAfkKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function getAfkRecord(guildId, userId) {
  return afkUsers.get(getAfkKey(guildId, userId)) || null;
}

function formatAfkNickname(originalNickname, username) {
  const original = String(originalNickname || username || 'Usuário').replace(/^AFK\s*\|\s*/i, '').trim();
  const value = `${AFK_NICK_PREFIX}${original}`;
  return value.length > 32 ? value.slice(0, 32) : value;
}

function getRolesOfAfkUser(guild, userId) {
  const member = guild.members.cache.get(userId);
  if (!member) return [];
  return member.roles.cache
    .filter(role => role.id !== guild.id)
    .map(role => role.id);
}

function findAfkMention(message) {
  const guildId = message.guild?.id;
  if (!guildId) return null;

  for (const record of afkUsers.values()) {
    if (record.guildId !== guildId || record.userId === message.author?.id) continue;

    if (message.mentions.users.has(record.userId)) {
      return record;
    }

    const roleIds = getRolesOfAfkUser(message.guild, record.userId);
    if (roleIds.some(roleId => message.mentions.roles.has(roleId))) {
      return record;
    }
  }

  return null;
}

async function warnAboutAfkMention(message) {
  const warning = await message.channel.send('o cego não ta vendo o nome da pessoa não? o nome ta afk burro,').catch(() => null);
  setTimeout(() => {
    message.delete().catch(() => {});
    warning?.delete().catch(() => {});
  }, AFK_WARNING_DELETE_MS);
}

const processedAfkMessages = new Set();
async function handleAfkPrefixCommand(message) {
  if (!message?.id) {
    return false;
  }

  // Impede que a mesma mensagem seja processada duas vezes
  if (processedAfkMessages.has(message.id)) {
    return true;
  }

  processedAfkMessages.add(message.id);

  // Remove o ID da memória depois de 30 segundos
  setTimeout(() => {
    processedAfkMessages.delete(message.id);
  }, 30000);

  const raw = String(message.content || '').trim();

  const match = raw.match(/^!(afk|unafk)(?:\s|$)/i);

  if (!match) {
    processedAfkMessages.delete(message.id);
    return false;
  }

  const command = match[1].toLowerCase();

  // Apaga o comando !afk / !unafk
  await message.delete().catch(() => {});

  if (!message.guild) {
    return true;
  }

  const guild = message.guild;

  const member =
    message.member ||
    await guild.members
      .fetch(message.author.id)
      .catch(() => null);

  if (!member) {
    return true;
  }

  const key = getAfkKey(
    guild.id,
    member.id
  );

  /*
   * =========================================================
   * ENTRAR NO AFK
   * =========================================================
   */

  if (command === 'afk') {
    if (afkUsers.has(key)) {
      await message.channel
        .send(
          `<a:luacancun2:1554021665934155796> <@${member.id}> já está no mundo AFK e não pode ser perturbado.`
        )
        .catch(() => {});

      return true;
    }

    const originalNickname =
      member.nickname ?? null;

    afkUsers.set(key, {
      guildId: guild.id,
      userId: member.id,
      originalNickname,
      activatedAt: Date.now()
    });

    saveAfkUsers();

    /*
     * Tenta colocar [AFK] no apelido.
     *
     * Se o bot não tiver permissão, o AFK continua
     * funcionando normalmente.
     */
    await member
      .setNickname(
        formatAfkNickname(
          originalNickname,
          member.user.username
        ),
        'Entrou no modo AFK'
      )
      .catch(error => {
        console.warn(
          '[AFK] Não foi possível alterar o apelido:',
          error.message
        );
      });

    /*
     * Procura a call AFK configurada.
     */
    const afkChannel =
      guild.channels.cache.get(
        AFK_VOICE_CHANNEL_ID
      ) ||
      await guild.channels
        .fetch(AFK_VOICE_CHANNEL_ID)
        .catch(() => null);

    const currentVoiceChannelId =
      member.voice?.channelId || null;

    /*
     * =========================================================
     * MENSAGEM ÚNICA
     * =========================================================
     *
     * NÃO envia mais DM.
     */

    await message.channel
      .send(
        `<a:luacancun2:1554021665934155796> <@${member.id}> entrou no mundo AFK e não pode ser perturbado.`
      )
      .catch(() => {});

    /*
     * Se já estiver em outra call, não tenta enviar DM
     * nem abrir confirmação.
     */
    if (
      currentVoiceChannelId &&
      currentVoiceChannelId !== AFK_VOICE_CHANNEL_ID &&
      afkChannel?.isVoiceBased?.()
    ) {
      console.log(
        `[AFK] ${member.user.tag} entrou em AFK e permaneceu na call atual.`
      );
    }

    return true;
  }

  /*
   * =========================================================
   * SAIR DO AFK
   * =========================================================
   */

  const record = afkUsers.get(key);

  if (!record) {
    await message.channel
      .send(
        `<a:luacancun2:1554021665934155796> <@${member.id}>, você não está no modo AFK.`
      )
      .catch(() => {});

    return true;
  }

  /*
   * Remove imediatamente da lista para impedir
   * processamento duplicado.
   */
  afkUsers.delete(key);

  saveAfkUsers();

  /*
   * Restaura o apelido original.
   */
  await member
    .setNickname(
      record.originalNickname ?? null,
      'Saiu do modo AFK'
    )
    .catch(error => {
      console.warn(
        '[AFK] Não foi possível restaurar o apelido:',
        error.message
      );
    });

  /*
   * Mensagem única de saída.
   */
  await message.channel
    .send(
      `<a:luacancun2:1554021665934155796> <@${member.id}> saiu do mundo AFK.`
    )
    .catch(() => {});

  return true;
}

async function handleAfkMoveConfirmation(interaction) {
  if (!interaction.isButton()) return false;
  const match = interaction.customId.match(/^afk_move_confirm:(\d+):(\d+):(yes|no)$/);
  if (!match) return false;

  const [, guildId, userId, choice] = match;
  const confirmId = `${AFK_MOVE_CONFIRM_PREFIX}${guildId}:${userId}`;
  const pending = pendingAfkMoveConfirmations.get(confirmId);

  if (!pending || pending.messageId !== interaction.message.id) {
    await interaction.reply({
      content: ' Essa confirmaío já expirou.'
    }).catch(() => {});
    return true;
  }

  if (interaction.user.id !== userId) {
    await interaction.reply({
      content: 'L Somente a pessoa que ativou o AFK pode responder essa confirmaío.'
    }).catch(() => {});
    return true;
  }

  clearTimeout(pending.timer);
  pendingAfkMoveConfirmations.delete(confirmId);

  const guild = interaction.guild || client.guilds.cache.get(guildId);
  const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
  if (!guild || !member) {
    await interaction.update({
      content: ' Não consegui localizar o servidor ou o membro.',
      components: []
    }).catch(() => {});
    return true;
  }

  if (choice === 'yes') {
    const afkChannel = guild.channels.cache.get(AFK_VOICE_CHANNEL_ID)
      || await guild.channels.fetch(AFK_VOICE_CHANNEL_ID).catch(() => null);

    if (!afkChannel?.isVoiceBased?.()) {
      await interaction.update({
        content: `L Não encontrei o canal AFK <#${AFK_VOICE_CHANNEL_ID}>. Você permaneceu na call atual.`,
        components: []
      }).catch(() => {});
      return true;
    }

    try {
      await member.voice.setChannel(afkChannel, 'Confirmaío de entrada no modo AFK');
      await interaction.update({
        content: `<a:luacancun2:1554021665934155796> Você entrou no mundo AFK e foi movido para <#${AFK_VOICE_CHANNEL_ID}>. Não pode ser perturbado.`,
        components: []
      }).catch(() => {});
    } catch (error) {
      console.warn('[AFK] Não foi possível mover aps confirmaío:', error.message);
      await interaction.update({
        content: `L Não consegui mover <@${member.id}> para <#${AFK_VOICE_CHANNEL_ID}>. Verifique a permissão **Mover Membros**.`,
        components: []
      }).catch(() => {});
    }
    return true;
  }

  await interaction.update({
    content: `<a:luacancun2:1554021665934155796> Você entrou no mundo AFK e escolheu permanecer na call atual. Não pode ser perturbado.`,
    components: []
  }).catch(() => {});
  return true;
}

async function restoreAfkUsersOnReady() {
  for (const record of afkUsers.values()) {
    const guild = client.guilds.cache.get(record.guildId);
    if (!guild) continue;
    const member = await guild.members.fetch(record.userId).catch(() => null);
    if (!member) continue;
    const expected = formatAfkNickname(record.originalNickname, member.user.username);
    if (member.nickname !== expected) {
      await member.setNickname(expected, 'Restaurando modo AFK').catch(() => {});
    }
  }
}

function normalizeRankCallStreakData(raw = {}) {
  const dates = Array.isArray(raw?.dates)
    ? [...new Set(raw.dates.map(value => String(value).trim()).filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value)))].sort()
    : [];
  const dailySeconds = {};
  if (raw?.dailySeconds && typeof raw.dailySeconds === 'object') {
    for (const [dateKey, value] of Object.entries(raw.dailySeconds)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
      const seconds = Math.max(0, Math.floor(Number(value) || 0));
      if (seconds > 0) dailySeconds[dateKey] = seconds;
    }
  }
  for (const dateKey of dates) {
    if (!Object.prototype.hasOwnProperty.call(dailySeconds, dateKey)) dailySeconds[dateKey] = RANK_CALL_STREAK_MIN_SECONDS;
  }
  const historicalStats = calculateRankCallCurrentStreak(dates);
  const lastQualifiedDate = String(raw?.lastQualifiedDate || raw?.lastActiveDate || dates[dates.length - 1] || '');
  return {
    dates, dailySeconds,
    currentStreak: Math.max(0, Math.floor(Number(raw?.currentStreak) || historicalStats.currentStreak || 0)),
    bestStreak: Math.max(Number(raw?.bestStreak) || 0, historicalStats.bestStreak || 0),
    lastActiveDate: String(raw?.lastActiveDate || lastQualifiedDate),
    lastQualifiedDate,
    missedDayNotified: String(raw?.missedDayNotified || '')
  };
}

function loadRankCallStreaks() {
  try {
    if (!fs.existsSync(RANK_CALL_STREAKS_FILE)) return;
    const data = JSON.parse(fs.readFileSync(RANK_CALL_STREAKS_FILE, 'utf8'));
    for (const [key, raw] of Object.entries(data || {})) rankCallStreaks.set(key, normalizeRankCallStreakData(raw));
  } catch (e) {
    console.warn('[RankCall] Erro ao carregar sequências:', e.message);
  }
}

function saveRankCallStreaks() {
  try {
    fs.writeFileSync(
      RANK_CALL_STREAKS_FILE,
      JSON.stringify(
        Object.fromEntries(rankCallStreaks),
        null,
        2
      ),
      'utf8'
    );

    if (dbReady && db) {
      for (const [key, record] of rankCallStreaks.entries()) {
        const parts = String(key).split(':');
        const guildId = parts.shift();
        const userId = parts.join(':');

        if (!guildId || !userId || !record) {
          continue;
        }

        void persistRankCallStreakToDatabase(
          guildId,
          userId,
          record
        );
      }
    }
  } catch (e) {
    console.warn(
      '[RankCall] Erro ao salvar sequências:',
      e.message
    );
  }
}
function getRankCallDateKey(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: RANK_CALL_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp));
  return `${parts.find(part => part.type === 'year')?.value || '0000'}-${parts.find(part => part.type === 'month')?.value || '01'}-${parts.find(part => part.type === 'day')?.value || '01'}`;
}

function getRankCallTimezoneOffsetMs(timestamp) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: RANK_CALL_TIMEZONE, timeZoneName: 'longOffset' }).formatToParts(new Date(timestamp));
    const zone = parts.find(part => part.type === 'timeZoneName')?.value || 'GMT';
    const match = zone.match(/^GMT([+-])(\d{2})(?::?(\d{2}))?$/);
    if (!match) return 0;
    const amount = (Number(match[2] || 0) * 60 + Number(match[3] || 0)) * 60 * 1000;
    return match[1] === '-' ? -amount : amount;
  } catch { return 0; }
}

function getRankCallDayStart(dateKey) {
  const baseUtc = Date.parse(`${dateKey}T00:00:00.000Z`);
  if (!Number.isFinite(baseUtc)) return NaN;
  let guess = baseUtc;
  for (let i = 0; i < 4; i += 1) {
    const next = baseUtc - getRankCallTimezoneOffsetMs(guess);
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

function shiftRankCallDate(dateKey, deltaDays) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

function calculateRankCallCurrentStreak(dates) {
  const uniqueDates = [...new Set((dates || []).filter(value => /^\d{4}-\d{2}-\d{2}$/.test(String(value))).map(String))].sort();
  if (!uniqueDates.length) return { currentStreak: 0, bestStreak: 0, lastActiveDate: '' };
  let bestStreak = 1, run = 1;
  for (let i = 1; i < uniqueDates.length; i += 1) {
    if (shiftRankCallDate(uniqueDates[i - 1], 1) === uniqueDates[i]) run += 1; else run = 1;
    bestStreak = Math.max(bestStreak, run);
  }
  const lastActiveDate = uniqueDates[uniqueDates.length - 1];
  const today = getRankCallDateKey();
  const yesterday = shiftRankCallDate(today, -1);
  if (lastActiveDate !== today && lastActiveDate !== yesterday) return { currentStreak: 0, bestStreak, lastActiveDate };
  let currentStreak = 1, cursor = lastActiveDate;
  for (let i = uniqueDates.length - 2; i >= 0; i -= 1) {
    const previous = shiftRankCallDate(cursor, -1);
    if (uniqueDates[i] === previous) { currentStreak += 1; cursor = uniqueDates[i]; } else break;
  }
  return { currentStreak, bestStreak, lastActiveDate };
}

function getOrCreateRankCallStreak(guildId, userId) {
  const key = `${guildId}:${userId}`;
  if (!rankCallStreaks.has(key)) rankCallStreaks.set(key, { dates: [], dailySeconds: {}, currentStreak: 0, bestStreak: 0, lastActiveDate: '', lastQualifiedDate: '', missedDayNotified: '' });
  return rankCallStreaks.get(key);
}

function calculateRankCallStreakEndingAt(dates, endDate) {
  const set = new Set(dates || []);
  if (!set.has(endDate)) return 0;
  let streak = 0, cursor = endDate;
  while (set.has(cursor)) { streak += 1; cursor = shiftRankCallDate(cursor, -1); }
  return streak;
}

function addRankCallQualifiedDate(record, dateKey) {
  if (record.dates.includes(dateKey)) return false;
  record.dates.push(dateKey);
  record.dates.sort();
  record.currentStreak = calculateRankCallStreakEndingAt(record.dates, dateKey);
  record.bestStreak = Math.max(Number(record.bestStreak) || 0, record.currentStreak);
  record.lastActiveDate = dateKey;
  record.lastQualifiedDate = dateKey;
  record.missedDayNotified = '';
  return true;
}

function addRankCallDailySeconds(guildId, userId, dateKey, seconds) {
  const amount = Math.max(0, Math.floor(Number(seconds) || 0));
  if (amount <= 0) return false;

  const record = getOrCreateRankCallStreak(guildId, userId);
  const before = Math.max(
    0,
    Math.floor(Number(record.dailySeconds[dateKey]) || 0)
  );

  const MAX_DAILY_SECONDS = 24 * 60 * 60;
  const available = Math.max(
    0,
    MAX_DAILY_SECONDS - before
  );

  const appliedAmount = Math.min(
    amount,
    available
  );

  if (appliedAmount <= 0) {
    return false;
  }

  const after = before + appliedAmount;

  record.dailySeconds[dateKey] = after;

  let qualified = false;

  if (
    before < RANK_CALL_STREAK_MIN_SECONDS &&
    after >= RANK_CALL_STREAK_MIN_SECONDS
  ) {
    qualified = addRankCallQualifiedDate(record, dateKey);
  }

  if (dbReady && db) {
    void persistRankCallDailyToDatabase(
      guildId,
      userId,
      dateKey,
      appliedAmount
    );
  }

  return qualified || after !== before;
}
function addRankCallDailySecondsForInterval(guildId, userId, startMs, endMs) {
  const start = Number(startMs), end = Number(endMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
  let cursor = start, changed = false;
  while (cursor < end) {
    const dateKey = getRankCallDateKey(cursor);
    const nextDayStart = getRankCallDayStart(shiftRankCallDate(dateKey, 1));
    const segmentEnd = Number.isFinite(nextDayStart) && nextDayStart > cursor ? Math.min(end, nextDayStart) : end;
    const seconds = Math.floor((segmentEnd - cursor) / 1000);
    if (seconds > 0 && addRankCallDailySeconds(guildId, userId, dateKey, seconds)) changed = true;
    if (segmentEnd <= cursor) break;
    cursor = segmentEnd;
  }
  return changed;
}

async function notifyRankCallStreakBroken(guildId, userId, missedDate, oldStreak) {
  if (oldStreak <= 0) return;
  try {
    const user = await client.users.fetch(userId);
    const guild = client.guilds.cache.get(guildId);
    const prettyDate = new Intl.DateTimeFormat('pt-BR', { timeZone: RANK_CALL_TIMEZONE, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${missedDate}T12:00:00.000Z`));
    await user.send(`${RANK_CALL_STREAK_EMOJI} **Sua sequncia do RankCall foi perdida.**\n\nVocê tinha uma sequncia de **${oldStreak} ${oldStreak === 1 ? 'dia' : 'dias'}**${guild ? ` no servidor **${guild.name}**` : ''}.\nNo dia **${prettyDate}**, você não completou os **30 minutos mínimos em call**.\n\nEntre em qualquer canal de voz e fique pelo menos **30 minutos** no dia para começar uma nova sequncia.`);
  } catch (error) {
    console.warn('[RankCall] Não foi possível enviar DM de sequncia:', error.message);
  }
}

async function evaluateRankCallStreaks(now = Date.now()) {
  const today = getRankCallDateKey(now);
  const yesterday = shiftRankCallDate(today, -1);
  let changed = false;

  for (const [key, record] of rankCallStreaks) {
    const [guildId, userId] = key.split(':');
    if (!guildId || !userId) continue;

    const todaySeconds = Number(record.dailySeconds?.[today] || 0);
    const todayQualified = todaySeconds >= RANK_CALL_STREAK_MIN_SECONDS;
    const yesterdayQualified =
      record.dates.includes(yesterday) ||
      Number(record.dailySeconds?.[yesterday] || 0) >= RANK_CALL_STREAK_MIN_SECONDS;

    // Se ontem não foi cumprido, a sequncia atual  quebrada.
    // Isso não impede que uma nova sequncia seja iniciada hoje aps 30 min.
    if (Number(record.currentStreak) > 0 && !yesterdayQualified && record.missedDayNotified !== yesterday) {
      const oldStreak = Number(record.currentStreak) || 0;
      record.currentStreak = 0;
      record.missedDayNotified = yesterday;
      changed = true;
      await notifyRankCallStreakBroken(guildId, userId, yesterday, oldStreak);
    }

    // Ao atingir 30 min hoje, a data de hoje precisa estar qualificada.
    // Mesmo que ela já esteja em `dates`, recalculamos o currentStreak;
    // isso corrige o caso em que a sequncia foi zerada no incio do dia.
    if (todayQualified) {
      if (!record.dates.includes(today)) {
        if (addRankCallQualifiedDate(record, today)) changed = true;
      } else {
        const recalculated = calculateRankCallStreakEndingAt(record.dates, today);
        if (recalculated !== Number(record.currentStreak) || record.lastActiveDate !== today || record.lastQualifiedDate !== today) {
          record.currentStreak = recalculated;
          record.bestStreak = Math.max(Number(record.bestStreak) || 0, recalculated);
          record.lastActiveDate = today;
          record.lastQualifiedDate = today;
          record.missedDayNotified = '';
          changed = true;
        }
      }
    }
  }

  if (changed) saveRankCallStreaks();
  return changed;
}

function getRankCallStreak(guildId, userId) { return rankCallStreaks.get(`${guildId}:${userId}`) || null; }

function getLiveRankCallStreakRanking(guild) {
  const today = getRankCallDateKey();
  const yesterday = shiftRankCallDate(today, -1);
  const rows = [];
  let changed = false;

  for (const [key, streak] of rankCallStreaks) {
    const [guildId, userId] = key.split(':');
    if (guildId !== guild.id) continue;

    // A sequncia só fica ATIVA no painel depois que a pessoa
    // completar 30 minutos acumulados de call no dia atual.
    const todaySeconds = Number(streak?.dailySeconds?.[today] || 0);
    const todayQualified = todaySeconds >= RANK_CALL_STREAK_MIN_SECONDS;

    // Repara automaticamente o painel caso o checkpoint tenha atualizado
    // dailySeconds, mas a inclusão da data qualificada ainda não tenha ocorrido.
    if (todayQualified && !streak.dates.includes(today)) {
      addRankCallQualifiedDate(streak, today);
      changed = true;
    }

    // Mantm a sequncia corrente coerente com as datas históricas.
    const recalculated = calculateRankCallCurrentStreak(streak.dates);
    if (Number(streak.currentStreak) !== Number(recalculated.currentStreak)) {
      streak.currentStreak = recalculated.currentStreak;
      changed = true;
    }
    streak.bestStreak = Math.max(Number(streak.bestStreak) || 0, Number(recalculated.bestStreak) || 0);

    const currentStreak = Number(streak.currentStreak) || 0;

    // Não exibe a sequncia como ativa antes dos 30 minutos do dia.
    // O histórico continua salvo normalmente; ao completar 30 min,
    // a data de hoje  adicionada e a sequncia volta a aparecer.
    if (currentStreak > 0) {
      rows.push({ userId, streak: currentStreak, bestStreak: Number(streak.bestStreak) || 0 });
    }
  }

  if (changed) saveRankCallStreaks();
  return rows.sort((a, b) => b.streak - a.streak || b.bestStreak - a.bestStreak || a.userId.localeCompare(b.userId));
}

async function saveRankCallBackup(reason = 'auto') {
  try {
    fs.mkdirSync(RANK_CALL_BACKUP_DIR, { recursive: true });
    await checkpointLocalVoiceSessions();

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeReason = String(reason || 'auto').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
    const snapshot = {
      version: 2,
      createdAt: new Date().toISOString(),
      reason: safeReason,
      timezone: RANK_CALL_TIMEZONE,
      config: rankCallConfig,
      voiceHours: Object.fromEntries(voiceHoursLocal),
      liveSessions: Object.fromEntries(voiceSessions),
      streaks: Object.fromEntries(rankCallStreaks)
    };
    const content = JSON.stringify(snapshot, null, 2);
    const datedFile = path.join(RANK_CALL_BACKUP_DIR, `rankcall-backup-${stamp}-${safeReason}.json`);
    const latestFile = path.join(RANK_CALL_BACKUP_DIR, 'rankcall-backup-latest.json');
    fs.writeFileSync(datedFile, content, 'utf8');
    fs.writeFileSync(latestFile, content, 'utf8');

    const backups = fs.readdirSync(RANK_CALL_BACKUP_DIR)
      .filter(name => /^rankcall-backup-\d{4}-/.test(name) && name.endsWith('.json'))
      .map(name => {
        const filePath = path.join(RANK_CALL_BACKUP_DIR, name);
        return { name, path: filePath, mtime: fs.statSync(filePath).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    for (const old of backups.slice(30)) fs.rmSync(old.path, { force: true });

    console.log(`[RankCall] Backup salvo: ${path.basename(datedFile)}`);
    return datedFile;
  } catch (e) {
    console.warn('[RankCall] Erro ao criar backup:', e.message);
    return null;
  }
}

function startRankCallBackupScheduler() {
  if (rankCallBackupTimer) return;
  void saveRankCallBackup('startup');
  rankCallBackupTimer = setInterval(() => void saveRankCallBackup('auto'), 60 * 60 * 1000);
}

let voiceCheckpointQueue = Promise.resolve();

function checkpointLocalVoiceSessions() {
  const checkpoint = voiceCheckpointQueue.then(() => performVoiceSessionCheckpoint());
  voiceCheckpointQueue = checkpoint.catch((error) => {
    console.error('[RankCall] Erro no checkpoint de voz:', error.message);
  });
  return checkpoint;
}

async function performVoiceSessionCheckpoint() {
  if (voiceSessions.size === 0) {
    if (!dbReady) saveVoiceSessionsLocal();
    await evaluateRankCallStreaks();
    return;
  }

  const now = Date.now();
  let sessionChanged = false;
  let streakChanged = false;

  for (const [key, startedAtRaw] of voiceSessions) {
    const startedAt = Number(startedAtRaw);

    if (!Number.isFinite(startedAt) || startedAt <= 0) {
      continue;
    }

    const elapsedSeconds = Math.floor((now - startedAt) / 1000);

    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
      continue;
    }

    const [guildId, userId] = key.split(':');

    if (!guildId || !userId) {
      continue;
    }

    const current = Number(voiceHoursLocal.get(key) || 0);
    const totalSeconds = current + elapsedSeconds;
    voiceHoursLocal.set(key, totalSeconds);
    let databaseSaved = false;

    if (dbReady && db) {
      const result = await q(`
        INSERT INTO bot_users (
          guild_id,
          user_id,
          username,
          voice_seconds,
          last_seen
        )
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (guild_id, user_id)
        DO UPDATE SET
          voice_seconds = GREATEST(bot_users.voice_seconds, EXCLUDED.voice_seconds),
          username = EXCLUDED.username,
          last_seen = NOW()
        RETURNING voice_seconds
      `, [
        guildId,
        userId,
        String(userId),
        totalSeconds
      ]);
      if (result?.rows?.length) {
        const persistedSeconds = Number(result.rows[0].voice_seconds || 0);
        voiceHoursLocal.set(key, Math.max(totalSeconds, persistedSeconds));
        databaseSaved = true;
      } else {
        console.warn(`[RankCall] Checkpoint de ${guildId}:${userId} não foi confirmado no banco; tentando manter no arquivo local.`);
      }
    }

    const localSaved = saveVoiceHoursLocal();
    if (!databaseSaved && !localSaved) {
      if (current > 0) voiceHoursLocal.set(key, current);
      else voiceHoursLocal.delete(key);
      continue;
    }

    if (addRankCallDailySecondsForInterval(guildId, userId, startedAt, now)) {
      streakChanged = true;
    }

    const newStartedAt = startedAt + elapsedSeconds * 1000;

    voiceSessions.set(
      key,
      newStartedAt
    );

    if (dbReady && db) {
      const sessionResult = await q(`
        UPDATE voice_sessions
        SET started_at = TO_TIMESTAMP($3 / 1000.0)
        WHERE guild_id = $1
          AND user_id = $2
      `, [
        guildId,
        userId,
        newStartedAt
      ]);
      if (!sessionResult) {
        console.warn(`[RankCall] Checkpoint da sessão ${guildId}:${userId} não foi confirmado no banco.`);
      }
    }

    sessionChanged = true;
  }

  if (sessionChanged) {
    saveVoiceSessionsLocal();
  }

  if (streakChanged) {
    saveRankCallStreaks();
  }

  await evaluateRankCallStreaks(now);
}

let voiceConnection = null;



let db = null;



let dbReady = false;


loadRankCallConfig();
loadAfkUsers();
loadVoiceHoursLocal();
loadVoiceSessionsLocal();
loadRankCallStreaks();




const PERMISSIONS = [

  'dm.send',

  'ticket.manage',

  'match.manage',

  'voice.manage',

  'moderation.warn',

  'moderation.kick',

  'moderation.ban',

  'moderation.mute',

  'moderation.clear',

  'rules.manage',

  'blocked.manage',

  'verification.manage',

  'stats.view',

  'dashboard.view'

];


// Permissões locais: funcionam mesmo sem DATABASE_URL.
const LOCAL_PERMISSIONS_FILE =
  path.join(__dirname, 'permissions-local.json');

let localPermissions = {};

function loadLocalPermissions() {
  try {
    if (!fs.existsSync(LOCAL_PERMISSIONS_FILE)) {
      localPermissions = {};
      return;
    }

    const data = JSON.parse(
      fs.readFileSync(LOCAL_PERMISSIONS_FILE, 'utf8')
    );

    localPermissions =
      data && typeof data === 'object'
        ? data
        : {};
  } catch (e) {
    console.warn(
      '[Permissões] Erro ao carregar permissões locais:',
      e.message
    );
    localPermissions = {};
  }
}

function saveLocalPermissions() {
  try {
    fs.writeFileSync(
      LOCAL_PERMISSIONS_FILE,
      JSON.stringify(localPermissions, null, 2),
      'utf8'
    );
    return true;
  } catch (e) {
    console.error(
      '[Permissões] Erro ao salvar permissões locais:',
      e.message
    );
    return false;
  }
}

function getLocalGuildPermissions(guildId) {
  if (!localPermissions[guildId]) {
    localPermissions[guildId] = {};
  }
  return localPermissions[guildId];
}

function hasLocalPermission(member, permission) {
  if (!member?.guild?.id) return false;
  const guildPermissions = localPermissions[member.guild.id] || {};
  const roleIds = memberRoleIds(member);
  return roleIds.some(roleId =>
    Array.isArray(guildPermissions[roleId]) &&
    guildPermissions[roleId].includes(permission)
  );
}

loadLocalPermissions();



function isValidHttpUrl(value) {

  try {

    const u = new URL(value);



    return (

      u.protocol === 'http:' ||

      u.protocol === 'https:'

    );

  } catch {

    return false;

  }

}



function normalizeHexColor(value) {

  return /^#[0-9A-Fa-f]{6}$/.test(

    value || ''

  )

    ? value

    : '#ff2a6d';

}



function hasOpenAIKey() {

  const k =

    process.env.OPENAI_API_KEY?.trim();



  return !!(

    k &&

    k.startsWith('sk-') &&

    !k.includes('opcional')

  );

}



async function safeReply(

  message,

  content

) {

  try {

    return await message.reply(

      content

    );

  } catch (e) {

    if (

      ![10008, 50035].includes(e.code)

    ) {

      console.error(

        '[Reply]',

        e.message

      );

    }



    return null;

  }

}



function isAdmin(member) {

  if (

    member?.roles?.cache?.has(

      COMMAND_ACCESS_ROLE_ID

    )

  ) {

    return true;

  }



  return !!member?.permissions?.has(

    PermissionFlagsBits.Administrator

  );

}



function memberRoleIds(member) {

  return member?.roles?.cache

    ? [...member.roles.cache.keys()]

    : [];

}



async function ensureRankCallDatabaseTables() {
  if (!dbReady || !db) return;

  try {
    await q(`
      CREATE TABLE IF NOT EXISTS rank_call_daily (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        date_key TEXT NOT NULL,
        seconds BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, user_id, date_key)
      )
    `);

    await q(`
      CREATE TABLE IF NOT EXISTS rank_call_streaks (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        dates JSONB NOT NULL DEFAULT '[]'::jsonb,
        daily_seconds JSONB NOT NULL DEFAULT '{}'::jsonb,
        current_streak INTEGER NOT NULL DEFAULT 0,
        best_streak INTEGER NOT NULL DEFAULT 0,
        last_active_date TEXT NOT NULL DEFAULT '',
        last_qualified_date TEXT NOT NULL DEFAULT '',
        missed_day_notified TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (guild_id, user_id)
      )
    `);

    console.log('[RankCall] Tabelas PostgreSQL do RankCall verificadas.');
  } catch (error) {
    console.warn('[RankCall] Erro ao criar tabelas PostgreSQL:', error.message);
  }
}

async function persistRankCallDailyToDatabase(guildId, userId, dateKey, seconds) {
  if (!dbReady || !db) return;

  const amount = Math.max(0, Math.floor(Number(seconds) || 0));
  if (amount <= 0) return;

  try {
    await q(`
      INSERT INTO rank_call_daily (
        guild_id,
        user_id,
        date_key,
        seconds
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (guild_id, user_id, date_key)
      DO UPDATE SET
        seconds = EXCLUDED.seconds
    `, [
      String(guildId),
      String(userId),
      String(dateKey),
      amount
    ]);
  } catch (error) {
    console.warn(
      `[RankCall] Erro ao persistir diário ${guildId}:${userId}:${dateKey}:`,
      error.message
    );
  }
}

async function persistRankCallStreakToDatabase(guildId, userId, record) {
  if (!dbReady || !db || !record) return;

  try {
    await q(`
      INSERT INTO rank_call_streaks (
        guild_id,
        user_id,
        dates,
        daily_seconds,
        current_streak,
        best_streak,
        last_active_date,
        last_qualified_date,
        missed_day_notified,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3::jsonb,
        $4::jsonb,
        $5,
        $6,
        $7,
        $8,
        $9,
        NOW()
      )
      ON CONFLICT (guild_id, user_id)
      DO UPDATE SET
        dates = EXCLUDED.dates,
        daily_seconds = EXCLUDED.daily_seconds,
        current_streak = EXCLUDED.current_streak,
        best_streak = EXCLUDED.best_streak,
        last_active_date = EXCLUDED.last_active_date,
        last_qualified_date = EXCLUDED.last_qualified_date,
        missed_day_notified = EXCLUDED.missed_day_notified,
        updated_at = NOW()
    `, [
      String(guildId),
      String(userId),
      JSON.stringify(Array.isArray(record.dates) ? record.dates : []),
      JSON.stringify(record.dailySeconds && typeof record.dailySeconds === 'object'
        ? record.dailySeconds
        : {}),
      Number(record.currentStreak) || 0,
      Number(record.bestStreak) || 0,
      String(record.lastActiveDate || ''),
      String(record.lastQualifiedDate || ''),
      String(record.missedDayNotified || '')
    ]);
  } catch (error) {
    console.warn(
      `[RankCall] Erro ao persistir streak ${guildId}:${userId}:`,
      error.message
    );
  }
}

async function loadRankCallStreaksFromDatabase() {
  if (!dbReady || !db) return;

  try {
    const result = await q(`
      SELECT
        guild_id,
        user_id,
        dates,
        daily_seconds,
        current_streak,
        best_streak,
        last_active_date,
        last_qualified_date,
        missed_day_notified
      FROM rank_call_streaks
    `);

    let loaded = 0;

    for (const row of result.rows || []) {
      const guildId = String(row.guild_id || '');
      const userId = String(row.user_id || '');

      if (!guildId || !userId) continue;

      let dates = [];
      let dailySeconds = {};

      try {
        dates = Array.isArray(row.dates) ? row.dates : JSON.parse(row.dates || '[]');
      } catch {
        dates = [];
      }

      try {
        dailySeconds =
          row.daily_seconds && typeof row.daily_seconds === 'object'
            ? row.daily_seconds
            : JSON.parse(row.daily_seconds || '{}');
      } catch {
        dailySeconds = {};
      }

      const MAX_DAILY_SECONDS = 24 * 60 * 60;
      let dailySecondsChanged = false;

      if (
        dailySeconds &&
        typeof dailySeconds === 'object' &&
        !Array.isArray(dailySeconds)
      ) {
        for (const [dateKey, rawSeconds] of Object.entries(dailySeconds)) {
          const seconds = Math.max(
            0,
            Math.floor(Number(rawSeconds) || 0)
          );

          const safeSeconds = Math.min(
            seconds,
            MAX_DAILY_SECONDS
          );

          if (safeSeconds !== seconds) {
            console.warn(
              `[RankCall] Corrigindo diário inválido no PostgreSQL ${guildId}:${userId} | ${dateKey} | ${seconds}s -> ${safeSeconds}s`
            );

            dailySeconds[dateKey] = safeSeconds;
            dailySecondsChanged = true;
          } else {
            dailySeconds[dateKey] = seconds;
          }
        }
      } else {
        dailySeconds = {};
        dailySecondsChanged = true;
      }

      const key = `${guildId}:${userId}`;

      const record = {
        dates: Array.isArray(dates) ? dates : [],
        dailySeconds,
        currentStreak: Number(row.current_streak) || 0,
        bestStreak: Number(row.best_streak) || 0,
        lastActiveDate: String(row.last_active_date || ''),
        lastQualifiedDate: String(row.last_qualified_date || ''),
        missedDayNotified: String(row.missed_day_notified || '')
      };

      rankCallStreaks.set(
        key,
        record
      );

      if (dailySecondsChanged) {
        void persistRankCallStreakToDatabase(
          guildId,
          userId,
          record
        );
      }

      loaded++;
    }

    if (loaded > 0) {
      saveRankCallStreaks();
      console.log(`[RankCall] ${loaded} streak(s) carregada(s) do PostgreSQL.`);
    }
  } catch (error) {
    console.warn('[RankCall] Erro ao carregar streaks do PostgreSQL:', error.message);
  }
}
async function initDB() {

  if (

    !Pool ||

    !process.env.DATABASE_URL

  ) {

    console.warn(

      '[DB] DATABASE_URL não configurada. Recursos de banco ficam em modo local/in-memory.'

    );



    return;

  }



  try {

    db = new Pool({

      connectionString:

        process.env.DATABASE_URL,



      ssl:

        process.env.DATABASE_SSL ===

        'false'

          ? false

          : {

              rejectUnauthorized: false

            },



      max: 5

    });



    await db.query(`

      CREATE TABLE IF NOT EXISTS bot_users (

        guild_id TEXT NOT NULL,

        user_id TEXT NOT NULL,

        username TEXT,

        xp BIGINT DEFAULT 0,

        coins BIGINT DEFAULT 0,

        warnings INT DEFAULT 0,

        trust INT DEFAULT 50,

        verified BOOLEAN DEFAULT FALSE,

        voice_seconds BIGINT DEFAULT 0,

        message_count BIGINT DEFAULT 0,

        first_seen TIMESTAMPTZ DEFAULT NOW(),

        last_seen TIMESTAMPTZ DEFAULT NOW(),

        PRIMARY KEY(guild_id,user_id)

      );



      CREATE TABLE IF NOT EXISTS voice_sessions (

        guild_id TEXT NOT NULL,

        user_id TEXT NOT NULL,

        started_at TIMESTAMPTZ NOT NULL,

        PRIMARY KEY(guild_id,user_id)

      );



      CREATE TABLE IF NOT EXISTS channel_stats (

        guild_id TEXT NOT NULL,

        channel_id TEXT NOT NULL,

        message_count BIGINT DEFAULT 0,

        last_message_at TIMESTAMPTZ DEFAULT NOW(),

        PRIMARY KEY(guild_id,channel_id)

      );



      CREATE TABLE IF NOT EXISTS blocked_words (

        guild_id TEXT NOT NULL,

        word TEXT NOT NULL,

        PRIMARY KEY(guild_id,word)

      );



      CREATE TABLE IF NOT EXISTS rules (

        guild_id TEXT NOT NULL,

        rule_id SERIAL,

        title TEXT NOT NULL,

        content TEXT NOT NULL,

        created_by TEXT,

        updated_at TIMESTAMPTZ DEFAULT NOW(),

        PRIMARY KEY(guild_id,rule_id)

      );



      CREATE TABLE IF NOT EXISTS role_permissions (

        guild_id TEXT NOT NULL,

        role_id TEXT NOT NULL,

        permission TEXT NOT NULL,

        PRIMARY KEY(guild_id,role_id,permission)

      );



      CREATE TABLE IF NOT EXISTS verifications (

        guild_id TEXT NOT NULL,

        user_id TEXT NOT NULL,

        code TEXT,

        expires_at TIMESTAMPTZ,

        verified BOOLEAN DEFAULT FALSE,

        PRIMARY KEY(guild_id,user_id)

      );



      CREATE TABLE IF NOT EXISTS matches (

        id BIGSERIAL PRIMARY KEY,

        guild_id TEXT NOT NULL,

        owner_id TEXT NOT NULL,

        category TEXT,

        nome TEXT,

        idade TEXT,

        descricao TEXT,

        social TEXT,

        likes INT DEFAULT 0,

        blocked BOOLEAN DEFAULT FALSE,

        created_at TIMESTAMPTZ DEFAULT NOW()

      );



      CREATE TABLE IF NOT EXISTS match_actions (

        guild_id TEXT NOT NULL,

        match_id BIGINT NOT NULL,

        actor_id TEXT NOT NULL,

        action TEXT NOT NULL,

        created_at TIMESTAMPTZ DEFAULT NOW()

      );



      CREATE TABLE IF NOT EXISTS tickets (

        guild_id TEXT NOT NULL,

        user_id TEXT NOT NULL,

        channel_id TEXT,

        opened_at TIMESTAMPTZ DEFAULT NOW(),

        closed_at TIMESTAMPTZ,

        PRIMARY KEY(guild_id,user_id)

      );



      CREATE TABLE IF NOT EXISTS moderation_logs (

        id BIGSERIAL PRIMARY KEY,

        guild_id TEXT,

        user_id TEXT,

        moderator_id TEXT,

        type TEXT,

        reason TEXT,

        created_at TIMESTAMPTZ DEFAULT NOW()

      );



      CREATE TABLE IF NOT EXISTS activity_hours (

        guild_id TEXT NOT NULL,

        hour INT NOT NULL,

        message_count BIGINT DEFAULT 0,

        PRIMARY KEY(guild_id,hour)

      );

    `);

    await db.query(`
      ALTER TABLE bot_users
        ADD COLUMN IF NOT EXISTS username TEXT,
        ADD COLUMN IF NOT EXISTS voice_seconds BIGINT DEFAULT 0
    `);


    dbReady = true;



    console.log(

      '[DB] PostgreSQL conectado e tabelas verificadas.'

    );

  } catch (e) {

    console.error(

      '[DB] Falha ao iniciar PostgreSQL:',

      e.message

    );



    db = null;

  }

}



async function restoreRankCallVoiceSessionsFromDB() {
  if (!dbReady || !db) return;

  try {
    const result = await q(`
      SELECT guild_id, user_id, started_at
      FROM voice_sessions
    `);

    if (!result?.rows?.length) return;

    let restored = 0;
    let removed = 0;

    for (const row of result.rows) {
      const guildId = String(row.guild_id || '');
      const userId = String(row.user_id || '');

      if (!guildId || !userId || !row.started_at) {
        continue;
      }

      const startedAt = new Date(row.started_at).getTime();

      if (!Number.isFinite(startedAt) || startedAt <= 0) {
        continue;
      }

      const guild = client.guilds.cache.get(guildId);

      if (!guild) {
        await q(`
          DELETE FROM voice_sessions
          WHERE guild_id = $1
            AND user_id = $2
        `, [guildId, userId]);

        removed++;
        continue;
      }

      const voiceState = guild.voiceStates?.cache?.get(userId);

      if (!voiceState?.channelId) {
        continue;
      }

      const key = `${guildId}:${userId}`;
      const localStartedAt = Number(voiceSessions.get(key) || 0);
      const restoredStartedAt = Math.max(startedAt, localStartedAt);
      voiceSessions.set(key, restoredStartedAt);
      if (restoredStartedAt > startedAt) {
        await q(`
          UPDATE voice_sessions
          SET started_at = TO_TIMESTAMP($3 / 1000.0)
          WHERE guild_id = $1 AND user_id = $2
        `, [guildId, userId, restoredStartedAt]);
      }
      restored++;
    }

    saveVoiceSessionsLocal();

    if (restored > 0 || removed > 0) {
      console.log(
        `[RankCall] ${restored} sessão(ões) restaurada(s) e ${removed} sessão(ões) antiga(s) removida(s).`
      );
    }
  } catch (error) {
    console.warn(
      '[RankCall] Erro ao restaurar sessões do PostgreSQL:',
      error.message
    );
  }
}
async function q(

  text,

  params = []

) {

  if (!dbReady || !db) {

    return null;

  }



  try {

    return await db.query(

      text,

      params

    );

  } catch (e) {

    console.error(

      '[DB]',

      e.message

    );



    return null;

  }

}



async function syncLocalVoiceHoursToDatabase() {
  if (!dbReady || !db) return;

  try {
    for (const [key, secondsRaw] of voiceHoursLocal.entries()) {
      const [guildId, userId] = String(key).split(':');
      const seconds = Math.max(0, Math.floor(Number(secondsRaw) || 0));
      if (!guildId || !userId) continue;

      if (seconds === 0) {
        await q(`
          INSERT INTO bot_users (guild_id, user_id, voice_seconds)
          VALUES ($1,$2,0)
          ON CONFLICT (guild_id,user_id)
          DO UPDATE SET voice_seconds = 0, last_seen = NOW()
        `, [guildId, userId]);
      } else {
        await q(`
          INSERT INTO bot_users (guild_id, user_id, voice_seconds)
          VALUES ($1,$2,$3)
          ON CONFLICT (guild_id,user_id)
          DO NOTHING
        `, [guildId, userId, seconds]);
      }
    }

    const result = await q(`
      SELECT guild_id, user_id, voice_seconds
      FROM bot_users
    `);
    if (!result?.rows) {
      console.warn('[DB] Não foi possível carregar as horas confirmadas do PostgreSQL.');
      return;
    }

    for (const row of result.rows) {
      const guildId = String(row.guild_id || '');
      const userId = String(row.user_id || '');
      const seconds = Number(row.voice_seconds);
      if (!guildId || !userId || !Number.isFinite(seconds) || seconds < 0) continue;
      voiceHoursLocal.set(`${guildId}:${userId}`, Math.floor(seconds));
    }
    saveVoiceHoursLocal();
    console.log('[DB] Horas locais conciliadas com PostgreSQL.');
  } catch (error) {
    console.error('[DB] Erro ao sincronizar horas locais:', error.message);
  }
}

async function ensureUser(

  guild,

  user

) {

  if (!dbReady) {

    return;

  }



  await q(

    `

    INSERT INTO bot_users(

      guild_id,

      user_id,

      username

    )

    VALUES($1,$2,$3)



    ON CONFLICT(guild_id,user_id)

    DO UPDATE SET

      username=EXCLUDED.username,

      last_seen=NOW()

    `,

    [

      guild.id,

      user.id,

      user.tag ||

        user.username

    ]

  );

}



async function addUserStats(

  guild,

  user,

  {

    messages = 0,

    xp = 0,

    coins = 0,

    warnings = 0

  } = {}

) {

  if (!dbReady) {

    return;

  }



  await ensureUser(

    guild,

    user

  );



  await q(

    `

    UPDATE bot_users

    SET

      message_count =

        message_count + $3,

      xp =

        xp + $4,

      coins =

        coins + $5,

      warnings =

        warnings + $6,

      last_seen = NOW()

    WHERE

      guild_id = $1

      AND user_id = $2

    `,

    [

      guild.id,

      user.id,

      messages,

      xp,

      coins,

      warnings

    ]

  );

}



async function hasCustomPermission(

  member,

  permission

) {

  if (

    member?.roles?.cache?.has(

      COMMAND_ACCESS_ROLE_ID

    )

  ) {

    return true;

  }



  if (isAdmin(member)) {

    return true;

  }



  if (hasLocalPermission(member, permission)) {
    return true;
  }

  if (!dbReady) {

    return false;

  }



  const ids =

    memberRoleIds(member);



  if (!ids.length) {

    return false;

  }



  const r = await q(

    `

    SELECT 1

    FROM role_permissions

    WHERE

      guild_id = $1

      AND role_id = ANY($2)

      AND permission = $3

    LIMIT 1

    `,

    [

      member.guild.id,

      ids,

      permission

    ]

  );



  return !!r?.rowCount;

}



async function requirePermission(

  member,

  permission

) {

  return hasCustomPermission(

    member,

    permission

  );

}



async function getRules(

  guildId

) {

  const r = await q(

    `

    SELECT

      rule_id,

      title,

      content

    FROM rules

    WHERE guild_id = $1

    ORDER BY rule_id

    `,

    [guildId]

  );



  return r?.rows || [];

}



async function getBlockedWords(

  guildId

) {

  const r = await q(

    `

    SELECT word

    FROM blocked_words

    WHERE guild_id = $1

    ORDER BY word

    `,

    [guildId]

  );



  return (

    r?.rows?.map(

      x => x.word

    ) || []

  );

}



async function logModeration(

  guildId,

  userId,

  moderatorId,

  type,

  reason

) {

  await q(

    `

    INSERT INTO moderation_logs(

      guild_id,

      user_id,

      moderator_id,

      type,

      reason

    )

    VALUES($1,$2,$3,$4,$5)

    `,

    [

      guildId,

      userId,

      moderatorId,

      type,

      reason

    ]

  );

}



async function sendLog(

  guild,

  text

) {

  const id =

    LOG_CHANNEL_ID ||

    process.env.LOG_CHANNEL_ID;



  if (!id) {

    return;

  }



  const ch =

    await guild.channels

      .fetch(id)

      .catch(() => null);



  if (ch?.isTextBased()) {

    await ch

      .send({

        content: text

      })

      .catch(() => {});

  }

}

function parseDiscordUserId(value) {
  const match = String(value || '').trim().match(/^(?:<@!?(\d{15,22})>|(\d{15,22}))$/);
  return match?.[1] || match?.[2] || null;
}

async function resolvePrefixUser(message, value) {
  const targetId = parseDiscordUserId(value);
  if (!targetId) return null;
  return message.mentions.users.get(targetId) ||
    await message.client.users.fetch(targetId).catch(() => null);
}

function parseModerationDuration(value) {
  const input = String(value || '').trim();
  const parts = [...input.matchAll(/(\d+)(s|m|h|d|w)/gi)];
  if (!parts.length || parts.map(part => part[0]).join('').toLowerCase() !== input.toLowerCase()) {
    return null;
  }

  const multipliers = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
  const seconds = parts.reduce(
    (total, part) => total + Number(part[1]) * multipliers[part[2].toLowerCase()],
    0
  );
  const milliseconds = seconds * 1000;
  return Number.isSafeInteger(milliseconds) && milliseconds > 0 && milliseconds <= 28 * 86400 * 1000
    ? milliseconds
    : null;
}

function formatModerationDuration(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const units = [
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
    ['s', 1]
  ];
  let remainder = seconds;
  const output = [];
  for (const [label, size] of units) {
    const amount = Math.floor(remainder / size);
    if (amount > 0) output.push(`${amount}${label}`);
    remainder %= size;
  }
  return output.join(' ');
}

function buildModerationEmbed({ action, target, moderator, reason, duration, proofs }) {
  const isMute = action === 'mute';
  const isBan = action === 'ban';
  const embed = new EmbedBuilder()
    .setColor(isMute ? '#F1C40F' : '#ED4245')
    .setTitle(
      isMute
        ? '🔇 Membro silenciado em canais de texto e voz'
        : isBan
          ? '⛔ Membro banido'
          : '👢 Membro expulso'
    )
    .addFields(
      {
        name: '👮 Moderador',
        value: `${moderator} (\`${moderator.id}\`)`,
        inline: true
      },
      {
        name: '👤 Membro',
        value: `${target} (\`${target.id}\`)`,
        inline: true
      },
      ...(duration ? [{ name: '⏱️ Duração', value: formatModerationDuration(duration), inline: false }] : []),
      { name: '📝 Motivo', value: String(reason || 'Não informado').slice(0, 1024), inline: false },
      ...(proofs.length
        ? [{
            name: '📎 Prova',
            value: proofs.map((proof, index) => `[${proof.name || `Prova ${index + 1}`}](${proof.url})`).join('\n').slice(0, 1024),
            inline: false
          }]
        : [])
    )
    .setTimestamp();

  if (target.displayAvatarURL) {
    embed.setThumbnail(target.displayAvatarURL({ extension: 'png', size: 128 }));
  }
  return embed;
}

async function sendModerationEmbed(guild, payload) {
  const configuredChannelId = payload.action === 'mute'
    ? MUTE_LOG_CHANNEL_ID
    : payload.action === 'ban'
      ? BAN_LOG_CHANNEL_ID
      : '';
  const defaultName = payload.action === 'mute'
    ? 'mute'
    : payload.action === 'ban'
      ? 'ban'
      : null;
  const namedChannel = defaultName
    ? guild.channels.cache.find(
        channel => channel.isTextBased() && channel.name?.toLowerCase() === defaultName
      )
    : null;
  const logChannelId = configuredChannelId || namedChannel?.id || LOG_CHANNEL_ID;
  if (!logChannelId) return false;

  const channel = await guild.channels.fetch(logChannelId).catch(() => null);
  if (!channel?.isTextBased()) {
    console.warn(`[Moderation] Canal de log ${logChannelId} não encontrado ou não é de texto.`);
    return false;
  }

  try {
    await channel.send({
      embeds: [buildModerationEmbed(payload)],
      files: payload.proofs
        .filter(proof => proof.attachment)
        .map(proof => ({ attachment: proof.url, name: proof.name || 'prova' }))
    });
    return true;
  } catch (error) {
    console.error(`[Moderation] Falha ao publicar o log de ${payload.action}:`, error.message);
    return false;
  }
}

function getPrefixProofs(message, text) {
  const proofLinks = [];
  const reasonParts = [];
  for (const part of String(text || '').trim().split(/\s+/).filter(Boolean)) {
    if (/^https?:\/\/\S+$/i.test(part)) {
      proofLinks.push({ url: part, name: 'Prova por link' });
    } else {
      reasonParts.push(part);
    }
  }

  const attachments = [...(message.attachments?.values?.() || [])].map(attachment => ({
    url: attachment.url,
    name: attachment.name || 'Prova anexada',
    attachment: true
  }));
  return {
    reason: reasonParts.join(' ').trim() || 'Não informado',
    proofs: [...proofLinks, ...attachments]
  };
}

async function handleModerationPrefixCommand(message, action) {
  const permission = action === 'mute' ? 'moderation.mute' : `moderation.${action}`;
  const replyPrivately = async content => {
    try {
      await message.author.send(content);
    } catch (error) {
      console.warn(`[Moderation] Não foi possível enviar confirmação privada: ${error.message}`);
    }
  };

  await message.delete().catch(error => {
    console.warn(`[Moderation] Não foi possível apagar o comando ${action}: ${error.message}`);
  });

  if (!(await requirePermission(message.member, permission))) {
    await replyPrivately(`❌ Você não possui a permissão \`${permission}\`.`);
    return;
  }

  const [, targetToken, ...args] = message.content.trim().split(/\s+/);
  const target = await resolvePrefixUser(message, targetToken);
  if (!target) {
    await replyPrivately(`❌ Use: \`!${action} <menção ou ID> ${action === 'mute' ? '<duração> ' : ''}[motivo] [link de prova]\`.`);
    return;
  }
  if (target.id === message.author.id || target.id === message.client.user.id) {
    await replyPrivately('❌ Não é possível aplicar esta ação a você ou ao próprio bot.');
    return;
  }

  let duration = null;
  if (action === 'mute') {
    duration = parseModerationDuration(args.shift());
    if (!duration) {
      await replyPrivately('❌ Informe uma duração válida, como `30m`, `4h`, `2d` ou `1w` (máximo de 28 dias).');
      return;
    }
  }

  const { reason, proofs } = getPrefixProofs(message, args.join(' '));
  const member = await message.guild.members.fetch(target.id).catch(() => null);
  if ((action === 'mute' || action === 'kick') && !member) {
    await replyPrivately(`❌ O usuário precisa estar no servidor para receber ${action === 'mute' ? 'timeout' : 'expulsão'}.`);
    return;
  }

  try {
    const loggedReason = [
      reason,
      duration ? `Duração: ${formatModerationDuration(duration)}` : '',
      ...proofs.map(proof => `Prova: ${proof.url}`)
    ].filter(Boolean).join('\n');

    if (action === 'mute') {
      await member.timeout(duration, reason.slice(0, 480));
    } else if (action === 'kick') {
      await member.kick(reason.slice(0, 480));
    } else {
      await message.guild.members.ban(target.id, { reason: reason.slice(0, 480) });
    }

    await logModeration(message.guild.id, target.id, message.author.id, action, loggedReason);
    const logSent = await sendModerationEmbed(message.guild, {
      action,
      target,
      moderator: message.author,
      reason,
      duration,
      proofs
    });
    const label = action === 'mute'
      ? `silenciado por ${formatModerationDuration(duration)}`
      : action === 'kick'
        ? 'expulso'
        : 'banido';
    const logWarning = logSent
      ? ''
      : `\n⚠️ A ação foi aplicada, mas o registro não foi publicado. Configure ${action === 'mute' ? 'MUTE' : 'BAN'}_LOG_CHANNEL_ID ou LOG_CHANNEL_ID.`;
    await replyPrivately(`✅ ${target.tag || target.username} foi ${label}.${logWarning}`);
  } catch (error) {
    console.error(`[Moderation] Falha ao executar ${action}:`, error);
    await replyPrivately(`❌ Não foi possível executar ${action}: ${error.message}`);
  }
}

async function handleHelpPrefixCommand(message) {
  await message.delete().catch(error => {
    console.warn(`[Help] Não foi possível apagar o comando: ${error.message}`);
  });

  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('📖 Comandos do bot')
    .setDescription('Você pode informar uma menção ou o ID do Discord sempre que o comando pedir um usuário.')
    .addFields(
      {
        name: 'Geral',
        value: '`!help`, `!ping`, `!oi`, `!regras2`, `!priv`'
      },
      {
        name: 'Voz e RankCall',
        value: '`!horascall [menção/ID]`, `!call [menção/ID]`, `!entrar`, `!sair`, `!rankcall`, `!rankrecreate`, `!rankconfig`, `!rankadd <menção/ID> <horas>`, `!rankremove <menção/ID> <horas>`, `!rankset <menção/ID> <horas>`, `!rankreset <menção/ID>`, `!rankresetall`'
      },
      {
        name: 'Moderação',
        value: '`!mute <menção/ID> <duração> [motivo] [link/anexo de prova]`, `!ban <menção/ID> [motivo] [link/anexo de prova]`, `!kick <menção/ID> [motivo]`, `!clear [quantidade]`, `!nuke`'
      },
      {
        name: 'Mensagens e servidor',
        value: '`!dm <menção/ID> <mensagem>`, `!match`, `!metch`, `!afk`, `!unafk`'
      },
      {
        name: 'Exemplos',
        value: '`!mute 123456789012345678 4h motivo do timeout` · `!ban 123456789012345678 motivo` · `!dm 123456789012345678 Olá!`'
      }
    )
    .setFooter({ text: 'Durações de mute: 30m, 4h, 2d ou 1w; máximo de 28 dias.' });

  try {
    await message.author.send({ embeds: [embed] });
  } catch (error) {
    console.warn(`[Help] Não foi possível enviar a ajuda por DM: ${error.message}`);
    await message.channel.send('📖 Não consegui enviar sua ajuda por DM. Ative mensagens diretas do servidor e tente `!help` novamente.').catch(() => {});
  }
}



async function askAI(

  prompt,

  systemExtra = ''

) {

  if (!hasOpenAIKey()) {

    throw new Error(

      'OPENAI_API_KEY não configurada.'

    );

  }



  const response =

    await fetch(

      'https://api.openai.com/v1/chat/completions',

      {

        method: 'POST',



        headers: {

          'Content-Type':

            'application/json',



          Authorization:

            `Bearer ${process.env.OPENAI_API_KEY}`

        },



        body: JSON.stringify({

          model:

            process.env.OPENAI_MODEL ||

            'gpt-4o-mini',



          messages: [

            {

              role: 'system',

              content:

                `Responda em portugus brasileiro, de forma clara, objetiva e educada. ${systemExtra}`

            },



            {

              role: 'user',

              content: prompt

            }

          ],



          max_tokens: 700

        }),



        signal:

          AbortSignal.timeout(

            30000

          )

      }

    );



  const data =

    await response.json();



  if (!response.ok) {

    throw new Error(

      data.error?.message ||

      'Falha na API da IA.'

    );

  }



  return (

    data.choices?.[0]?.message?.content?.trim() ||

    'Sem resposta.'

  );

}



async function askAIWithRules(

  guildId,

  prompt

) {

  const rules =

    await getRules(guildId);



  const context =

    rules.length

      ? `Regras cadastradas do servidor:\n${rules

          .map(

            r =>

              `#${r.rule_id} ${r.title}: ${r.content}`

          )

          .join('\n')}`

      : 'Não h regras cadastradas no banco.';



  return askAI(

    prompt,

    `Quando a pergunta for sobre regras do servidor, use somente as regras fornecidas abaixo. Não invente regras.\n${context}`

  );

}function randomCode(length = 6) {

  const chars =

    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';



  let result = '';



  for (let i = 0; i < length; i++) {

    result += chars[

      Math.floor(

        Math.random() *

          chars.length

      )

    ];

  }



  return result;

}



function formatDuration(seconds) {

  seconds = Number(seconds) || 0;



  const hours = Math.floor(

    seconds / 3600

  );



  const minutes = Math.floor(

    (seconds % 3600) / 60

  );



  const secs = Math.floor(

    seconds % 60

  );



  return `${hours}h ${minutes}m ${secs}s`;

}



function formatHours(seconds) {

  seconds = Number(seconds) || 0;



  return (

    Math.round(

      (seconds / 3600) * 100

    ) / 100

  );

}



function createEmbed({

  title,

  description,

  color = '#ff2a6d',

  fields = [],

  footer

}) {

  const embed =

    new EmbedBuilder()

      .setTitle(title)

      .setDescription(

        description || null

      )

      .setColor(

        normalizeHexColor(color)

      )

      .addFields(

        fields

          .filter(Boolean)

          .slice(0, 25)

      )

      .setTimestamp();



  if (footer) {

    embed.setFooter({

      text: footer

    });

  }



  return embed;

}



async function sendStaffAlert(

  guild,

  message

) {

  const channelId =

    STAFF_ALERT_CHANNEL_ID;



  if (!channelId) {

    return;

  }



  const channel =

    await guild.channels

      .fetch(channelId)

      .catch(() => null);



  if (!channel?.isTextBased()) {

    return;

  }



  await channel

    .send({

      content: message

    })

    .catch(() => {});

}



async function updateChannelStats(

  message

) {

  if (!dbReady) {

    return;

  }



  const hour =

    new Date().getHours();



  await q(

    `

    INSERT INTO channel_stats(

      guild_id,

      channel_id,

      message_count

    )

    VALUES($1,$2,1)



    ON CONFLICT(

      guild_id,

      channel_id

    )



    DO UPDATE SET

      message_count =

        channel_stats.message_count + 1,

      last_message_at = NOW()

    `,

    [

      message.guild.id,

      message.channel.id

    ]

  );



  await q(

    `

    INSERT INTO activity_hours(

      guild_id,

      hour,

      message_count

    )

    VALUES($1,$2,1)



    ON CONFLICT(

      guild_id,

      hour

    )



    DO UPDATE SET

      message_count =

        activity_hours.message_count + 1

    `,

    [

      message.guild.id,

      hour

    ]

  );

}



async function updateVoiceSession(
  guild,
  member,
  joined
) {
  const key = `${guild.id}:${member.id}`;

  if (joined) {
    if (voiceSessions.has(key)) return;

    const startedAt = Date.now();
    voiceSessions.set(key, startedAt);
    saveVoiceSessionsLocal();

    if (!dbReady) return;

    await q(`
      INSERT INTO voice_sessions(guild_id, user_id, started_at)
      VALUES($1,$2,NOW())
      ON CONFLICT(guild_id, user_id)
      DO UPDATE SET started_at = NOW()
    `, [guild.id, member.id]);
    return;
  }

  const started = voiceSessions.get(key);
  const endedAt = Date.now();

  if (started) {
    addRankCallDailySecondsForInterval(guild.id, member.id, started, endedAt);
  }

  voiceSessions.delete(key);
  saveVoiceSessionsLocal();

  const seconds = started ? Math.max(0, Math.floor((endedAt - started) / 1000)) : 0;
  if (seconds <= 0) {
    saveRankCallStreaks();
    void evaluateRankCallStreaks(endedAt);
    return;
  }

  const current = Number(voiceHoursLocal.get(key) || 0);
  const totalSeconds = current + seconds;
  voiceHoursLocal.set(key, totalSeconds);
  saveVoiceHoursLocal();

  if (dbReady) {
    const result = await q(`
      INSERT INTO bot_users (
        guild_id,
        user_id,
        username,
        voice_seconds,
        last_seen
      )
      VALUES ($1,$2,$3,$4,NOW())
      ON CONFLICT (guild_id,user_id)
      DO UPDATE SET
        voice_seconds = GREATEST(bot_users.voice_seconds, EXCLUDED.voice_seconds),
        username = EXCLUDED.username,
        last_seen = NOW()
      RETURNING voice_seconds
    `, [
      guild.id,
      member.id,
      member.user?.tag || member.user?.username || String(member.id),
      totalSeconds
    ]);

    if (result?.rows?.length) {
      const persistedSeconds = Number(result.rows[0].voice_seconds || 0);
      voiceHoursLocal.set(key, Math.max(totalSeconds, persistedSeconds));
      saveVoiceHoursLocal();
    } else {
      console.warn(`[RankCall] Horas de ${guild.id}:${member.id} mantidas localmente até a confirmação no banco.`);
    }
  }

  await q(`
    DELETE FROM voice_sessions
    WHERE guild_id = $1 AND user_id = $2
  `, [guild.id, member.id]);

  saveRankCallStreaks();
  void evaluateRankCallStreaks(endedAt);
}

// NOVO BLOCO

// NOVO BLOCO

async function getLiveVoiceRanking(

  guild

) {

  const ranking =

    new Map();



  if (dbReady) {

    const result =

      await q(

        `

        SELECT

          user_id,

          voice_seconds

        FROM bot_users

        WHERE

          guild_id = $1
          AND voice_seconds > 0

        `,

        [

          guild.id

        ]

      );



    for (

      const row of

        result?.rows || []

    ) {

      const dbVoiceSeconds = Number(row.voice_seconds || 0);

      console.log(
        `[RankCall] DB DEBUG | user=${row.user_id} | voice_seconds=${dbVoiceSeconds} | formatado=${formatVoiceDuration(dbVoiceSeconds)}`
      );

      ranking.set(
        row.user_id,
        dbVoiceSeconds
      );

    }

  } else {

    for (

      const [

        key,

        seconds

      ] of voiceHoursLocal

    ) {

      const [

        guildId,

        userId

      ] = key.split(':');



      if (

        guildId !==

        guild.id

      ) {

        continue;

      }



      ranking.set(

        userId,

        Number(seconds || 0)

      );

    }

  }

  for (const [key, seconds] of voiceHoursLocal) {
    const [guildId, userId] = key.split(':');
    if (guildId === guild.id && Number(seconds) > 0) {
      ranking.set(userId, Number(seconds) || 0);
    }
  }



  const now =

    Date.now();



  for (

    const [

      key,

      startedAt

    ] of voiceSessions

  ) {

    const [

      guildId,

      userId

    ] = key.split(':');



    if (

      guildId !==

      guild.id

    ) {

      continue;

    }



    const current =

      Number(

        ranking.get(userId) ||

          0

      );



    const activeSeconds =

      Math.max(

        0,

        Math.floor(

          (

            now -

            startedAt

          ) / 1000

        )

      );



    ranking.set(

      userId,

      current +

        activeSeconds

    );

  }



  return [...ranking.entries()]

    .map(

      ([

        userId,

        seconds

      ]) => ({

        userId,

        seconds

      })

    )

    .filter(

      row =>

        row.seconds > 0

    )

    .sort(

      (a, b) =>

        b.seconds -

        a.seconds

    );

}



function formatVoiceDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
}

function getRankCallVoiceInfo(guild, userId) {
  const member = guild.members.cache.get(userId) || null;
  const voiceState = guild.voiceStates?.cache?.get(userId) || null;
  const channelId = member?.voice?.channelId || voiceState?.channelId || null;
  const channel = channelId
    ? (guild.channels.cache.get(channelId) || null)
    : null;
  const tempData = channel ? tempRooms.get(channel.id) : null;
  return {
    member,
    channel,
    isCallPriv: !!tempData,
    ownerId: tempData?.ownerId || null
  };
}

function buildRankCallRow(guild, row, index) {
  const { channel, isCallPriv, ownerId } = getRankCallVoiceInfo(guild, row.userId);
  const LRI = '\u2066';
  const PDI = '\u2069';

  const userMention = `${LRI}<@${row.userId}>${PDI}`;
  const callLabel = channel
    ? `${isCallPriv ? '🔒 ' : ''}<#${channel.id}>${ownerId === row.userId ? ' 👑 Dono' : ''}`
    : '<a:Loading:1554696306633482252> Fora de call';
  const audioIcon = channel ? '<:audio_larp:1554688509715939350> ' : '';

  return [
    `**${LRI}${index + 1}.${PDI}** ${userMention}`,
    `↪ <:arrow1:1554152798071955477> <a:oceans6_clock:1554152778300002346> **${formatVoiceDuration(row.seconds)}** • ${audioIcon}${callLabel}`
  ].join('\n');
}

function buildLiveRankEmbed(guild, ranking, page = 0) {
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(ranking.length / pageSize));
  const safePage = Math.min(Math.max(Number(page) || 0, 0), totalPages - 1);
  const start = safePage * pageSize;
  const rows = ranking.slice(start, start + pageSize);

  const description = rows.length
    ? rows.map((row, index) => buildRankCallRow(guild, row, start + index)).join('\n\n')
    : 'Nenhum usuário possui horas registradas em call.';

  const embed = createEmbed({
    title: String(rankCallConfig.title || DEFAULT_RANK_CALL_CONFIG.title).slice(0, 256),
    description: [String(rankCallConfig.description || '').trim(), description].filter(Boolean).join('\n\n'),
    color: normalizeHexColor(rankCallConfig.color),
    footer: `Ranking de horas • Página ${safePage + 1}/${totalPages} • Atualiza a cada 5 segundos  ${guild.name}`
  });

  // O ranking normal usa o ícone e o banner configurados no RankCall.
  if (rankCallConfig.icon && /^https?:\/\//i.test(rankCallConfig.icon)) {
    embed.setThumbnail(rankCallConfig.icon);
  }

  if (rankCallConfig.banner && /^https?:\/\//i.test(rankCallConfig.banner)) {
    embed.setImage(rankCallConfig.banner);
  }

  return { embed, totalPages, safePage, userIds: rows.map(row => row.userId) };
}

function buildRankCallGeneralEmbed(guild, ranking, page = 0, userId = null) {
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(ranking.length / pageSize));
  const safePage = Math.min(
    Math.max(Number(page) || 0, 0),
    totalPages - 1
  );

  const start = safePage * pageSize;
  const rows = ranking.slice(start, start + pageSize);

  const userIndex = userId
    ? ranking.findIndex(row => row.userId === userId)
    : -1;

  const userPosition = userIndex >= 0 ? userIndex + 1 : 0;

  const topThree = rows
    .slice(0, 3)
    .map((row, index) => {
      const position = start + index + 1;
      const duration = formatVoiceDuration(row.seconds);

      let prefix = `**${position}º**`;

if (position === 1) prefix = '🥇 **1º**';
if (position === 2) prefix = '🥈 **2º**';
if (position === 3) prefix = '🥉 **3º**';

return `${prefix} <@${row.userId}> ⏱️ **${duration}**`;
    })
    .join('\n');

  const embed = createEmbed({
    title: '🐒 Rank de Call - Top 10',
    description: [
      `Sua posição #${userPosition} na página ${safePage}`,
      '',
      '🐒 **Top 3**',
      '',
      topThree || 'Nenhum usuário possui horas registradas em call.',
      '',
      rows.length > 3
        ? rows.slice(3).map((row, index) => {
            const position = start + index + 4;
            return `**${position}.** <@${row.userId}>  ${formatVoiceDuration(row.seconds)}`;
          }).join('\n')
        : ''
    ].filter(Boolean).join('\n'),
    color: normalizeHexColor(rankCallConfig.color),
    footer: `Ranking - Página ${safePage + 1} de ${totalPages} • ${guild.name}`
  });

  if (rankCallConfig.icon && /^https?:\/\//i.test(rankCallConfig.icon)) {
    embed.setThumbnail(rankCallConfig.icon);
  }

  if (rankCallConfig.banner && /^https?:\/\//i.test(rankCallConfig.banner)) {
    embed.setImage(rankCallConfig.banner);
  }

  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rankcall_general_prev_${safePage}`)
        .setLabel('Anterior')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(safePage <= 0),

      new ButtonBuilder()
        .setCustomId(`rankcall_general_next_${safePage}`)
        .setLabel('Próximo')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(safePage >= totalPages - 1),

      new ButtonBuilder()
        .setCustomId('rankcall_general_id')
        .setLabel('ID')
        .setStyle(ButtonStyle.Secondary)
    )
  ];

  return {
    embed,
    components,
    totalPages,
    safePage,
    userIds: rows.map(row => row.userId)
  };
}
function buildRankCallStreakEmbed(guild, page = 0) {
  const ranking = getLiveRankCallStreakRanking(guild);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(ranking.length / pageSize));
  const safePage = Math.min(Math.max(Number(page) || 0, 0), totalPages - 1);
  const start = safePage * pageSize;
  const rows = ranking.slice(start, start + pageSize);

  const description = rows.length
    ? rows.map((row, index) =>
        `**${start + index + 1}.** <@${row.userId}> • ${RANK_CALL_STREAK_EMOJI} **Sequência: ${row.streak} ${row.streak === 1 ? 'dia' : 'dias'}**`
      ).join('\n')
    : `${RANK_CALL_STREAK_EMOJI} Nenhum usuário possui uma sequência ativa no momento.`;

  const embed = createEmbed({
    title: `${RANK_CALL_STREAK_EMOJI} Sequência de dias em Call`,
    description,
    color: normalizeHexColor(rankCallConfig.color),
    footer: `30 minutos acumulados em call por dia • Dias históricos salvos • Página ${safePage + 1}/${totalPages}  ${guild.name}`
  });

  // A sequência de fogo tem somente o banner próprio; não usa ícone/thumbnail.
  const RANK_CALL_STREAK_BANNER = 'https://cdn.discordapp.com/attachments/1553979838698885200/1554936187612045404/9ed7e3a2bde57597d28d42fe22510cf1.gif?backend=b2&ex=6abeb2ac&is=6abd612c&hm=5e208e52231ae03a6e070f2f3994e1b3c6d60b36fb6651e9acc8c5b226509211&';
  embed.setImage(RANK_CALL_STREAK_BANNER);

  return { embed, totalPages, safePage, userIds: rows.map(row => row.userId) };
}

async function updateLiveRankPanel(

  message

) {

  try {

    const ranking =

      await getLiveVoiceRanking(

        message.guild

      );



    await message.edit({

      embeds: [

        buildLiveRankEmbed(

          message.guild,

          ranking

        )

      ]

    });



    return true;

  } catch (error) {

    console.error(

      '[LiveRank]',

      error.message

    );



    return false;

  }

}




let rankCallPanelMessage = null;

async function findExistingRankCallPanel(channel) {
  try {
    const messages = await channel.messages.fetch({ limit: 100 });
    const botId = client.user?.id;

    console.log(
      `[RankCall] DEBUG: ${messages.size} mensagens encontradas | botId=${botId}`
    );

    for (const message of messages.values()) {
      if (message.author?.id === botId && message.embeds?.length) {
        console.log(
          `[RankCall] DEBUG mensagem ${message.id} | ttulo="${message.embeds[0]?.title || ''}" | footer="${message.embeds[0]?.footer?.text || ''}"`
        );
      }
    }

    if (!botId) return null;

    const configuredTitle = String(
      rankCallConfig.title || DEFAULT_RANK_CALL_CONFIG.title
    ).trim();

    const candidates = [...messages.values()]
      .filter(message => message.author?.id === botId)
      .filter(message => Array.isArray(message.embeds) && message.embeds.length > 0)
      .filter(message => {
        const firstEmbed = message.embeds[0];
        const title = String(firstEmbed?.title || '').trim();
        const footer = String(firstEmbed?.footer?.text || '').trim();

        return (
          title === configuredTitle ||
          footer.includes('Ranking de horas')
        );
      })
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp);

    console.log(
      `[RankCall] Painis encontrados no canal: ${candidates.length} | IDs: ${candidates.map(m => m.id).join(', ')}`
    );

    const panel = candidates[0] || null;

    // Se existirem vrios painis antigos, mantém somente o mais recente.
    for (const duplicate of candidates.slice(1)) {
      try {
        await duplicate.delete();
        console.log(`[RankCall] Painel duplicado removido: ${duplicate.id}`);
      } catch (error) {
        console.error(
          `[RankCall] N foi possível remover painel duplicado ${duplicate.id}:`,
          error?.message || error
        );
      }
    }

    return panel;
  } catch (error) {
    console.warn(
      '[RankCall] N foi possível procurar painel existente:',
      error.message
    );
    return null;
  }
}

async function publishRankCallPanel(
  guild,
  {
    recreate = false,
    page = rankCallConfig.page || 0,
    streakPage = rankCallConfig.streakPage || 0
  } = {}
) {
  const channel = await client.channels.fetch(RANK_CALL_CHANNEL_ID).catch(() => null);

  console.log(
    `[RankCall] PAGE DEBUG | recebido=${page} | configAntes=${rankCallConfig.page} | streak=${streakPage}`
  );

  console.log(
  );

  if (!channel || !channel.isTextBased()) {
    throw new Error(
      `Canal RankCall ${RANK_CALL_CHANNEL_ID} n encontrado ou n  de texto.`
    );
  }

  // Usa somente a referncia em memria.
  // Nenhum messageId  salvo no arquivo.
  let panel = rankCallPanelMessage;

  if (recreate && panel) {
    try {
      await panel.delete();
      console.log(`[RankCall] Painel anterior removido: ${panel.id}`);
    } catch (error) {
      console.error(
        '[RankCall] N foi possível remover o painel anterior:',
        error?.message || error
      );
    }

    rankCallPanelMessage = null;
    panel = null;
  }

  // S procura um painel existente quando ainda n temos
  // um painel guardado em memria.
  if (!panel) {
    panel = await findExistingRankCallPanel(channel);
  }

  const ranking = await getLiveVoiceRanking(guild);
  const hoursView = buildLiveRankEmbed(guild, ranking, page);
  const streakView = buildRankCallStreakEmbed(guild, streakPage);

  rankCallConfig.page = hoursView.safePage;
  rankCallConfig.streakPage = streakView.safePage;
  console.log(
    `[RankCall] PAGE RESULT | safePage=${hoursView.safePage} | totalPages=${hoursView.totalPages} | configDepois=${rankCallConfig.page}`
  );

  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('rankcall_general')
        .setLabel('Geral')
        .setStyle(ButtonStyle.Primary)
    )
  ];

  const userMentions = [
    ...new Set([
      ...hoursView.userIds,
      ...streakView.userIds
    ])
  ];

  const payload = {
    embeds: [hoursView.embed, streakView.embed],
    components,
    allowedMentions: {
      users: userMentions,
      roles: []
    }
  };

  if (panel) {
    try {
      await panel.edit(payload);
    } catch (error) {
      // A mensagem pode ter sido apagada manualmente.
      // Limpa somente a referncia em memria e recria uma vez.
      if (error?.code === 10008) {
        console.warn('[RankCall] Painel n existe mais. Criando um novo painel.');

        rankCallPanelMessage = null;
        panel = await channel.send(payload);

        console.log(`[RankCall] Novo painel criado: ${panel.id}`);
      } else {
        throw error;
      }
    }
  } else {
    panel = await channel.send(payload);
    console.log(`[RankCall] Novo painel criado: ${panel.id}`);
  }

  // Guarda somente em memria durante esta execu.
  // Nenhum messageId  salvo no arquivo.
  rankCallPanelMessage = panel;
  liveRankPanels.set(panel.id, {
    guildId: guild.id,
    channelId: channel.id
  });

  return panel;
}
function buildRankCallConfigEmbed() {
  return createEmbed({
    title: ' Configuraío do RankCall',
    description: 'Use os botes abaixo para personalizar o painel de ranking. O ranking não possui limite de usuários; quando necessório, usa páginas de 10 pessoas.',
    color: normalizeHexColor(rankCallConfig.color),
    fields: [
      { name: 'Título', value: String(rankCallConfig.title || '"').slice(0, 1024) },
      { name: 'Descrição', value: String(rankCallConfig.description || '"').slice(0, 1024) },
      { name: 'Cor', value: String(rankCallConfig.color || '"'), inline: true },
      { name: 'ícone', value: rankCallConfig.icon ? 'Configurado' : 'Não configurado', inline: true },
      { name: 'Banner', value: rankCallConfig.banner ? 'Configurado' : 'Não configurado', inline: true }
    ],
    footer: 'RankCall  somente administradores'
  });
}

function buildRankCallConfigComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('rankconfig_title').setLabel('Título').setEmoji('').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('rankconfig_description').setLabel('Descrição').setEmoji('=').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('rankconfig_color').setLabel('Cor').setEmoji('<').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('rankconfig_icon').setLabel('ícone').setEmoji('=').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('rankconfig_banner').setLabel('Banner').setEmoji('YO"').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('rankconfig_reset').setLabel('Restaurar').setEmoji('=').setStyle(ButtonStyle.Danger)
    )
  ];
}

async function sendRankCallConfigPanel(guild) {
  const channel = await client.channels.fetch(RANK_CALL_CHANNEL_ID).catch(() => null);

  console.log(
  );
  if (!channel?.isTextBased()) throw new Error('Canal do RankCall não encontrado.');
  const message = await channel.send({
    embeds: [buildRankCallConfigEmbed()],
    components: buildRankCallConfigComponents()
  });
  return message;
}

function openRankCallConfigModal(interaction, option) {
  const labels = {
    title: 'Título do painel',
    description: 'Descrição do painel',
    color: 'Cor HEX (#RRGGBB)',
    icon: 'URL do ícone',
    banner: 'URL do banner'
  };
  const placeholders = {
    title: 'Y Ranking de Horas em Call',
    description: 'Acompanhe em tempo real quem  mais desempregado',
    color: '#000000',
    icon: 'https://...',
    banner: 'https://...'
  };
  const values = {
    title: String(rankCallConfig.title || ''),
    description: String(rankCallConfig.description || ''),
    color: String(rankCallConfig.color || ''),
    icon: String(rankCallConfig.icon || ''),
    banner: String(rankCallConfig.banner || '')
  };
  const modal = new ModalBuilder().setCustomId(`rankconfig_modal:${option}`).setTitle(` ${labels[option]}`);
  const input = new TextInputBuilder()
    .setCustomId('value')
    .setLabel(labels[option])
    .setPlaceholder(placeholders[option])
    .setRequired(false)
    .setStyle(option === 'description' ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setMaxLength(option === 'description' ? 1000 : 500);
  if (values[option]) input.setValue(values[option].slice(0, 1000));
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

async function handleRankCallConfigModal(interaction) {
  if (!isTempVoicePanelAdmin(interaction.member)) {
    return interaction.reply({ content: 'L Você não possui permissão para configurar o RankCall.', flags: MessageFlags.Ephemeral });
  }

  const option = interaction.customId.split(':')[1];
  const value = String(interaction.fields.getTextInputValue('value') || '').trim();

  if (option === 'color' && value && !/^#[0-9A-Fa-f]{6}$/.test(value)) {
    return interaction.reply({ content: 'L A cor deve estar no formato #RRGGBB.', flags: MessageFlags.Ephemeral });
  }
  if ((option === 'icon' || option === 'banner') && value && !/^https?:\/\//i.test(value)) {
    return interaction.reply({ content: 'L Informe uma URL começando com http:// ou https://.', flags: MessageFlags.Ephemeral });
  }

  rankCallConfig[option] = option === 'color' ? (value || DEFAULT_RANK_CALL_CONFIG.color) : value;
  saveRankCallConfig();
  saveRankCallBackup(`config-${option}`);
  await interaction.reply({ content: `. ${option === 'title' ? 'Título' : option === 'description' ? 'Descrição' : option === 'color' ? 'Cor' : option === 'icon' ? 'ícone' : 'Banner'} atualizado.`, flags: MessageFlags.Ephemeral });
  await refreshRankCallPanel();
}

async function handleRankCallConfigButton(interaction) {
  if (!isTempVoicePanelAdmin(interaction.member)) {
    await interaction.reply({ content: 'L Você não possui permissão para configurar o RankCall.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  const id = interaction.customId;
  if (id === 'rankconfig_reset') {
    rankCallConfig = { ...DEFAULT_RANK_CALL_CONFIG, channelId: RANK_CALL_CHANNEL_ID, page: rankCallConfig.page || 0, streakPage: rankCallConfig.streakPage || 0 };
    saveRankCallConfig();
    saveRankCallBackup('config-reset');
    await interaction.update({ embeds: [buildRankCallConfigEmbed()], components: buildRankCallConfigComponents() }).catch(() => {});
    await refreshRankCallPanel();
    return true;
  }

  const option = id.replace('rankconfig_', '');
  if (!['title','description','color','icon','banner'].includes(option)) return false;
  await openRankCallConfigModal(interaction, option);
  return true;
}

async function syncRankCallStreaksFromVoiceStates() {
  await evaluateRankCallStreaks();
}

let rankCallRefreshInProgress = false;

async function refreshRankCallPanel() {
  if (rankCallRefreshInProgress) return;
  rankCallRefreshInProgress = true;

  try {
    // Primeiro sincroniza quem está realmente em voz e transforma o tempo
    // acumulado desde o ltimo checkpoint em horas persistentes.
    syncRankCallVoiceSessionsFromVoiceStates();
    await checkpointLocalVoiceSessions();
    await syncRankCallStreaksFromVoiceStates();

    const channel = await client.channels.fetch(RANK_CALL_CHANNEL_ID).catch(() => null);

  console.log(
  );
    if (!channel?.isTextBased() || !channel.guild) return;

    // O painel  persistente, mas a mensagem pode ter sido apagada manualmente.
    // Nesse caso o bot recria automaticamente uma nica mensagem e grava o novo ID.
    await publishRankCallPanel(channel.guild, {
      page: rankCallConfig.page || 0,
      streakPage: rankCallConfig.streakPage || 0
    });

    // Log leve para confirmar no console que o relgio do RankCall continua
    // sendo processado, sem inundar o terminal.
    const active = [...voiceSessions.values()].length;
    console.log(`[RankCall] Heartbeat OK - ${active} sessão(ões) ativas - ${new Date().toLocaleTimeString('pt-BR')}`);
  } catch (error) {
    console.error('[RankCall] Atualização automática:', error.message);
  } finally {
    rankCallRefreshInProgress = false;
  }
}

function startRankCallAutoRefresh() {
  if (globalThis.__rankCallAutoRefreshTimer) {
    clearInterval(globalThis.__rankCallAutoRefreshTimer);
  }

  globalThis.__rankCallAutoRefreshTimer = setInterval(() => {
    void refreshRankCallPanel();
  }, 5000);

  console.log('[RankCall] Atualização automática a cada 5 segundos ativada.');
}

async function handleRankCallPrefixCommand(message) {
  const raw = String(message.content || '').trim();
  const parts = raw.slice(1).trim().split(/\s+/);
  const command = String(parts.shift() || '').toLowerCase();
  const allowed = new Set(['rankcall','rankrecreate','rankreset','rankadd','rankremove','rankset','rankresetall','rankconfig']);
  if (!allowed.has(command)) return false;

  await message.delete().catch(() => {});
  if (!message.guild) return true;

  try {
    if (command === 'rankcall') {
      await publishRankCallPanel(message.guild, { page: 0, streakPage: 0 });
      return true;
    }

    if (!isTempVoicePanelAdmin(message.member)) {
      await message.channel.send('⚠️ Você não possui permissão para administrar o RankCall.').catch(() => {});
      return true;
    }

    if (command === 'rankrecreate') {
      await publishRankCallPanel(message.guild, { recreate: true, page: 0, streakPage: 0 });
      return true;
    }

    if (command === 'rankconfig') {
      await sendRankCallConfigPanel(message.guild);
      return true;
    }

    if (command === 'rankresetall') {
      if (dbReady) {
        const result = await q(
          `WITH reset_hours AS (
             UPDATE bot_users
             SET voice_seconds = 0, last_seen = NOW()
             WHERE guild_id = $1
             RETURNING guild_id
           ),
           reset_sessions AS (
             UPDATE voice_sessions
             SET started_at = NOW()
             WHERE guild_id = $1
             RETURNING guild_id
           )
           SELECT 1`,
          [message.guild.id]
        );
        if (!result) {
          throw new Error('O banco não confirmou o reset; nenhuma hora foi alterada.');
        }
      }

      const prefix = `${message.guild.id}:`;
      for (const key of [...voiceHoursLocal.keys()]) {
        if (key.startsWith(prefix)) voiceHoursLocal.set(key, 0);
      }
      const resetAt = Date.now();
      for (const key of [...voiceSessions.keys()]) {
        if (key.startsWith(prefix)) voiceSessions.set(key, resetAt);
      }
      const localSaveSucceeded = saveVoiceHoursLocal();
      saveVoiceSessionsLocal();
      if (!localSaveSucceeded && !dbReady) {
        throw new Error('Não foi possível salvar o reset no arquivo local.');
      }
      await refreshRankCallPanel();
      await message.channel.send('✅ Todas as horas de call deste servidor foram zeradas. As sequências de dias continuam salvas.').catch(() => {});
      return true;
    }

    const target = await resolvePrefixUser(message, parts[0]);
    if (!target) {
      await message.channel.send(`⚠️ Use !${command} <menção ou ID>${command === 'rankreset' ? '' : ' horas'}`).catch(() => {});
      return true;
    }
    parts.shift();

    const key = `${message.guild.id}:${target.id}`;
    const rawAmount = parts.find(value => /^(?:\d+(?:[.,]\d+)?)(?:h|hora|horas)?$/i.test(value));
    const amountText = String(rawAmount || '').replace(/(?:h|hora|horas)$/i, '').replace(',', '.');
    const hours = Number.parseFloat(amountText || '0');
    const deltaSeconds = Math.round(hours * 3600);

    if (command !== 'rankreset' && (!rawAmount || (
      !Number.isFinite(hours) ||
      hours < 0 ||
      !Number.isSafeInteger(deltaSeconds) ||
      deltaSeconds < 0
    ))) {
      await message.channel.send('Informe uma quantidade de horas válida, por exemplo: `!rankadd @usuário 2h`.').catch(() => {});
      return true;
    }

    let newSeconds;
    if (dbReady) {
      const initialSeconds =
        command === 'rankadd' || command === 'rankset'
          ? deltaSeconds
          : 0;
      const result = await q(`
        WITH saved_hours AS (
          INSERT INTO bot_users (guild_id, user_id, username, voice_seconds, last_seen)
          VALUES ($1,$2,$3,$4,NOW())
          ON CONFLICT (guild_id,user_id)
          DO UPDATE SET
            username = EXCLUDED.username,
            voice_seconds = CASE $6
              WHEN 'rankadd' THEN COALESCE(bot_users.voice_seconds, 0) + $7::bigint
              WHEN 'rankremove' THEN GREATEST(0, COALESCE(bot_users.voice_seconds, 0) - $7::bigint)
              WHEN 'rankset' THEN $7::bigint
              WHEN 'rankreset' THEN 0
            END,
            last_seen = NOW()
          RETURNING voice_seconds
        ),
        reset_session AS (
          UPDATE voice_sessions
          SET started_at = NOW()
          WHERE guild_id = $1
            AND user_id = $2
            AND $5::boolean
          RETURNING user_id
        )
        SELECT voice_seconds FROM saved_hours
      `, [
        message.guild.id,
        target.id,
        target.tag || target.username,
        initialSeconds,
        (command === 'rankreset' || command === 'rankset') && voiceSessions.has(key),
        command,
        deltaSeconds
      ]);
      if (!result?.rows?.length) {
        throw new Error('O banco não confirmou a alteração das horas.');
      }
      newSeconds = Number(result.rows[0].voice_seconds);
      if (!Number.isSafeInteger(newSeconds) || newSeconds < 0) {
        throw new Error('A quantidade de horas ultrapassa o limite suportado.');
      }
      voiceHoursLocal.set(key, newSeconds);
      saveVoiceHoursLocal();
    } else {
      const current = Number(voiceHoursLocal.get(key) || 0);
      if (command === 'rankreset') {
        newSeconds = 0;
      } else if (command === 'rankremove') {
        newSeconds = Math.max(0, current - deltaSeconds);
      } else if (command === 'rankadd') {
        newSeconds = Math.max(0, current + deltaSeconds);
      } else {
        newSeconds = deltaSeconds;
      }
      if (!Number.isSafeInteger(newSeconds) || newSeconds < 0) {
        throw new Error('A quantidade de horas ultrapassa o limite suportado.');
      }

      const previous = voiceHoursLocal.get(key);
      voiceHoursLocal.set(key, newSeconds);
      if (!saveVoiceHoursLocal()) {
        if (previous === undefined) voiceHoursLocal.delete(key);
        else voiceHoursLocal.set(key, previous);
        throw new Error('Não foi possível salvar as horas no arquivo local.');
      }
    }

    if (
      (command === 'rankreset' || command === 'rankset') &&
      voiceSessions.has(key)
    ) {
      voiceSessions.set(key, Date.now());
    }

    if (command === 'rankadd' && deltaSeconds > 0) {
      const today = getRankCallDateKey();
      addRankCallDailySeconds(message.guild.id, target.id, today, deltaSeconds);
    }

    saveVoiceSessionsLocal();
    saveRankCallStreaks();
    await refreshRankCallPanel();
    await message.channel.send(`✅ Horas de <@${target.id}> atualizadas no RankCall. As sequências de dias permanecem salvas.`).catch(() => {});
    return true;
  } catch (error) {
    console.error('[RankCall]', error);
    await message.channel.send(`❌ Erro no RankCall: ${error.message}`).catch(() => {});
    return true;
  }
}

async function getVoiceRanking(

  guildId,

  limit = 10

) {

  const result =

    await q(

      `

      SELECT

        user_id,

        voice_seconds

      FROM bot_users

      WHERE guild_id = $1

      ORDER BY voice_seconds DESC

      LIMIT $2

      `,

      [

        guildId,

        limit

      ]

    );



  return result?.rows || [];

}



async function getServerStats(

  guild

) {

  const stats = {

    members:

      guild.memberCount || 0,



    online: 0,

    tickets: 0,

    matches: 0,

    voice: guild.channels.cache

      .filter(

        c =>

          c.type ===

            ChannelType.GuildVoice ||

          c.type ===

            ChannelType.GuildStageVoice

      )

      .reduce(

        (total, channel) =>

          total +

          channel.members.size,

        0

      ),



    messages: 0,

    topChannels: []

  };



  stats.online =

    guild.members.cache.filter(

      member =>

        member.presence &&

        member.presence.status !==

          'offline'

    ).size;



  if (dbReady) {

    const tickets =

      await q(

        `

        SELECT COUNT(*)::int AS count

        FROM tickets

        WHERE

          guild_id = $1

          AND closed_at IS NULL

        `,

        [guild.id]

      );



    stats.tickets =

      Number(

        tickets?.rows?.[0]?.count ||

          0

      );



    const matches =

      await q(

        `

        SELECT COUNT(*)::int AS count

        FROM matches

        WHERE guild_id = $1

        `,

        [guild.id]

      );



    stats.matches =

      Number(

        matches?.rows?.[0]?.count ||

          0

      );



    const messages =

      await q(

        `

        SELECT

          COALESCE(

            SUM(message_count),

            0

          )::bigint AS count

        FROM channel_stats

        WHERE guild_id = $1

        `,

        [guild.id]

      );



    stats.messages =

      Number(

        messages?.rows?.[0]?.count ||

          0

      );



    const channels =

      await q(

        `

        SELECT

          channel_id,

          message_count

        FROM channel_stats

        WHERE guild_id = $1

        ORDER BY

          message_count DESC

        LIMIT 10

        `,

        [guild.id]

      );



    stats.topChannels =

      channels?.rows || [];

  }



  return stats;

}



async function buildDashboardEmbed(

  guild

) {

  const stats =

    await getServerStats(

      guild

    );



  const top =

    stats.topChannels.length

      ? stats.topChannels

          .map(

            (item, index) => {

              const channel =

                guild.channels.cache.get(

                  item.channel_id

                );



              return `${

                index + 1

              }. ${

                channel

                  ? `<#${channel.id}>`

                  : `Canal ${item.channel_id}`

              } " ${

                item.message_count

              } mensagens`;

            }

          )

          .join('\n')

      : 'Sem dados ainda.';



  return createEmbed({

    title:

      '📊 Painel de Estatísticas',

    description:

      'Estatísticas atualizadas do servidor.',

    color: '#5865F2',



    fields: [

      {

        name: '🤖 BOT',

        value:

          'YY ONLINE',

        inline: true

      },



      {

        name: '👥 Membros',

        value:

          String(

            stats.members

          ),

        inline: true

      },



      {

        name: 'YY Online',

        value:

          String(

            stats.online

          ),

        inline: true

      },



      {

        name: '< Tickets',

        value:

          String(

            stats.tickets

          ),

        inline: true

      },



      {

        name: '= Matches',

        value:

          String(

            stats.matches

          ),

        inline: true

      },



      {

        name: '🔊 Em call',

        value:

          String(

            stats.voice

          ),

        inline: true

      },



      {

        name: '💬 Mensagens',

        value:

          String(

            stats.messages

          ),

        inline: true

      },



      {

        name:

          'Y"^ Canais mais utilizados',

        value:

          top

      }

    ],



    footer:

      'Atualização em tempo real'

  });

}



async function createDashboard(

  guild,

  channel

) {

  if (

    !channel ||

    !channel.isTextBased()

  ) {

    return null;

  }



  const embed =

    await buildDashboardEmbed(

      guild

    );



  const message =

    await channel.send({

      embeds: [embed]

    });



  return message;

}



async function refreshDashboard(

  guild,

  message

) {

  try {

    const embed =

      await buildDashboardEmbed(

        guild

      );



    await message.edit({

      embeds: [embed]

    });



    return true;

  } catch {

    return false;

  }

}



async function permissionList(

  guildId,

  roleId

) {

  const local =
    localPermissions[guildId]?.[roleId] || [];

  if (!dbReady) {
    return [...new Set(local)];
  }

  const result =
    await q(
      `
      SELECT permission
      FROM role_permissions
      WHERE
        guild_id = $1
        AND role_id = $2
      ORDER BY permission
      `,
      [
        guildId,
        roleId
      ]
    );

  return [
    ...new Set([
      ...local,
      ...(result?.rows?.map(row => row.permission) || [])
    ])
  ];
}



async function grantPermission(

  guildId,

  roleId,

  permission

) {

  if (!PERMISSIONS.includes(permission)) {
    return false;
  }

  const guildPermissions =
    getLocalGuildPermissions(guildId);

  if (!Array.isArray(guildPermissions[roleId])) {
    guildPermissions[roleId] = [];
  }

  if (!guildPermissions[roleId].includes(permission)) {
    guildPermissions[roleId].push(permission);
  }

  const localSaved = saveLocalPermissions();

  if (!dbReady) {
    return localSaved;
  }

  const result = await q(
    `
    INSERT INTO role_permissions(
      guild_id,
      role_id,
      permission
    )
    VALUES($1,$2,$3)
    ON CONFLICT DO NOTHING
    `,
    [guildId, roleId, permission]
  );

  return localSaved || !!result;
}



async function revokePermission(

  guildId,

  roleId,

  permission

) {

  const guildPermissions =
    getLocalGuildPermissions(guildId);

  if (Array.isArray(guildPermissions[roleId])) {
    guildPermissions[roleId] =
      guildPermissions[roleId].filter(p => p !== permission);

    if (guildPermissions[roleId].length === 0) {
      delete guildPermissions[roleId];
    }
  }

  const localSaved = saveLocalPermissions();

  if (!dbReady) {
    return localSaved;
  }

  const result = await q(
    `
    DELETE FROM role_permissions
    WHERE
      guild_id = $1
      AND role_id = $2
      AND permission = $3
    `,
    [guildId, roleId, permission]
  );

  return localSaved || !!result;
}



async function createVerification(

  guild,

  member

) {

  const code =

    randomCode(6);



  const expiresAt =

    new Date(

      Date.now() +

        10 * 60 * 1000

    );



  pendingVerification.set(

    `${guild.id}:${member.id}`,

    {

      code,

      expiresAt

    }

  );



  await q(

    `

    INSERT INTO verifications(

      guild_id,

      user_id,

      code,

      expires_at,

      verified

    )

    VALUES($1,$2,$3,$4,FALSE)



    ON CONFLICT(

      guild_id,

      user_id

    )



    DO UPDATE SET

      code = EXCLUDED.code,

      expires_at =

        EXCLUDED.expires_at,

      verified = FALSE

    `,

    [

      guild.id,

      member.id,

      code,

      expiresAt

    ]

  );



  return {

    code,

    expiresAt

  };

}



async function verifyMember(

  guild,

  member,

  code

) {

  const key =

    `${guild.id}:${member.id}`;



  const local =

    pendingVerification.get(

      key

    );



  let expected =

    local?.code;



  let expiresAt =

    local?.expiresAt;



  if (!expected) {

    const result =

      await q(

        `

        SELECT

          code,

          expires_at

        FROM verifications

        WHERE

          guild_id = $1

          AND user_id = $2

        `,

        [

          guild.id,

          member.id

        ]

      );



    expected =

      result?.rows?.[0]?.code;



    expiresAt =

      result?.rows?.[0]

        ?.expires_at;

  }



  if (!expected) {

    return {

      ok: false,

      reason:

        'Nenhum código de verificação encontrado.'

    };

  }



  if (

    expiresAt &&

    new Date(expiresAt)

      .getTime() <

      Date.now()

  ) {

    pendingVerification.delete(

      key

    );



    return {

      ok: false,

      reason:

        'O código expirou. Gere outro código.'

    };

  }



  if (

    String(code)

      .trim()

      .toUpperCase() !==

    String(expected)

      .trim()

      .toUpperCase()

  ) {

    return {

      ok: false,

      reason:

        'Código incorreto.'

    };

  }



  pendingVerification.delete(

    key

  );



  await q(

    `

    UPDATE verifications

    SET verified = TRUE

    WHERE

      guild_id = $1

      AND user_id = $2

    `,

    [

      guild.id,

      member.id

    ]

  );



  await q(

    `

    UPDATE bot_users

    SET verified = TRUE

    WHERE

      guild_id = $1

      AND user_id = $2

    `,

    [

      guild.id,

      member.id

    ]

  );



  if (VERIFY_ROLE_ID) {

    await member.roles

      .add(VERIFY_ROLE_ID)

      .catch(() => {});

  }



  return {

    ok: true

  };

}async function handleBlockedWords(message) {

  if (!message.guild || message.author.bot) {

    return false;

  }



  const words = await getBlockedWords(

    message.guild.id

  );



  if (!words.length) {

    return false;

  }



  const content =

    message.content.toLowerCase();



  const found = words.find(word =>

    content.includes(

      String(word).toLowerCase()

    )

  );



  if (!found) {

    return false;

  }



  await message

    .delete()

    .catch(() => {});



  await addUserStats(

    message.guild,

    message.author,

    {

      warnings: 1,

      xp: 0

    }

  );



  const warning =

    await message.channel

      .send({

        content:

          ` ${message.author}, sua mensagem foi removida por conter uma palavra bloqueada.`

      })

      .catch(() => null);



  if (warning) {

    setTimeout(() => {

      warning

        .delete()

        .catch(() => {});

    }, 2 * 60 * 1000);

  }



  try {

    await message.author.send({

      content:

        ` Sua mensagem no servidor **${message.guild.name}** foi removida porque contm uma palavra que está na lista de bloqueio.`

    });

  } catch {}



  await sendLog(

    message.guild,

    `⚠️ **Palavra bloqueada**\nUsuário: ${message.author.tag} (${message.author.id})\nCanal: <#${message.channel.id}>\nPalavra detectada: \`${found}\``

  );



  return true;

}



async function detectAttention(

  message

) {

  if (

    !message.guild ||

    message.author.bot

  ) {

    return;

  }



  if (!hasOpenAIKey()) {

    return;

  }



  const now = Date.now();



  const cooldownKey =

    `${message.guild.id}:${message.author.id}`;



  const last =

    aiAttentionCooldown.get(

      cooldownKey

    ) || 0;



  if (

    now - last <

    60 * 1000

  ) {

    return;

  }



  const content =

    message.content.trim();



  if (

    content.length < 15

  ) {

    return;

  }



  try {

    const result =

      await askAI(

        `Analise esta mensagem de Discord e determine se ela parece exigir atenção da equipe de staff.



Mensagem:

"${content}"



Responda SOMENTE neste formato JSON:

{

  "attention": true ou false,

  "reason": "motivo curto",

  "severity": "low" ou "medium" ou "high"

}



Não considere simplesmente crticas, opinies ou discussóes normais como motivo para interveno.`,

        'Você  um detector de mensagens que podem precisar de atenção humana. Você não pune ningum e não deve inventar contexto.'

      );



    const cleaned =

      result

        .replace(/^```json/i, '')

        .replace(/^```/i, '')

        .replace(/```$/i, '')

        .trim();



    const data =

      JSON.parse(cleaned);



    if (!data.attention) {

      return;

    }



    aiAttentionCooldown.set(

      cooldownKey,

      now

    );



    await sendStaffAlert(

      message.guild,

      `⚠️ **Atenção da IA**\nUsuário: ${message.author} (${message.author.id})\nCanal: <#${message.channel.id}>\nSeveridade: **${data.severity || 'medium'}**\nMotivo: ${data.reason || 'A IA identificou uma possível necessidade de atenção.'}\n\n> ${content.slice(0, 1000)}`

    );

  } catch (e) {

    console.warn(

      '[AI Attention]',

      e.message

    );

  }

}



async function updateMessageActivity(

  message

) {

  if (

    !message.guild ||

    message.author.bot

  ) {

    return;

  }



  await ensureUser(

    message.guild,

    message.author

  );



  await addUserStats(

    message.guild,

    message.author,

    {

      messages: 1,

      xp: 5,

      coins: 1

    }

  );



  await updateChannelStats(

    message

  );

}



async function handleSpam(

  message

) {

  if (

    !message.guild ||

    message.author.bot

  ) {

    return false;

  }



  const key =

    `${message.guild.id}:${message.author.id}`;



  const now =

    Date.now();



  const history =

    spamHistory.get(key) || [];



  const recent =

    history.filter(

      time =>

        now - time <

        10 * 1000

    );



  recent.push(now);



  spamHistory.set(

    key,

    recent

  );



  if (

    recent.length < 6

  ) {

    return false;

  }



  spamHistory.set(

    key,

    []

  );



  try {

    if (

      message.member?.moderatable

    ) {

      await message.member.timeout(

        60 * 1000,

        'Anti-spam automtico'

      );



      await logModeration(

        message.guild.id,

        message.author.id,

        client.user.id,

        'timeout',

        'Anti-spam automtico'

      );



      await sendLog(

        message.guild,

        ` **Anti-spam**\n${message.author} recebeu timeout de 1 minuto.`

      );

    }

  } catch (e) {

    console.warn(

      '[Anti-spam]',

      e.message

    );

  }



  return true;

}



async function sendVerificationPanel(

  channel

) {

  const embed =

    createEmbed({

      title:

        '. Verificaío',

      description:

        'Clique no boto abaixo para receber um código de verificação por DM.',

      color: '#57F287'

    });



  const row =

    new ActionRowBuilder().addComponents(

      new ButtonBuilder()

        .setCustomId(

          'verification_start'

        )

        .setLabel(

          '= Verificar'

        )

        .setStyle(

          ButtonStyle.Success

        )

    );



  return channel.send({

    embeds: [embed],

    components: [row]

  });

}



async function sendVerificationCode(

  interaction

) {

  if (

    !interaction.guild ||

    !interaction.member

  ) {

    return;

  }



  const result =

    await createVerification(

      interaction.guild,

      interaction.member

    );



  try {

    await interaction.user.send({

      content:

        `= **Código de verificação**\n\nSeu código para o servidor **${interaction.guild.name}** :\n\n**${result.code}**\n\nEste código expira em 10 minutos.`

    });



    await interaction.reply({

      content:

        '. O código foi enviado para sua DM. Clique em **Inserir código** para finalizar.',

      ephemeral: true,

      components: [

        new ActionRowBuilder()

          .addComponents(

            new ButtonBuilder()

              .setCustomId(

                'verification_enter'

              )

              .setLabel(

                '= Inserir código'

              )

              .setStyle(

                ButtonStyle.Primary

              )

          )

      ]

    });

  } catch {

    await interaction.reply({

      content:

        'L Não consegui enviar DM. Ative as mensagens diretas para membros do servidor e tente novamente.',

      ephemeral: true

    });

  }

}



async function showVerificationModal(

  interaction

) {

  const modal =

    new ModalBuilder()

      .setCustomId(

        'verification_modal'

      )

      .setTitle(

        'Código de verificação'

      );



  const input =

    new TextInputBuilder()

      .setCustomId(

        'verification_code'

      )

      .setLabel(

        'Digite o código recebido'

      )

      .setPlaceholder(

        'ABC123'

      )

      .setStyle(

        TextInputStyle.Short

      )

      .setRequired(true)

      .setMaxLength(6)

      .setMinLength(6);



  modal.addComponents(

    new ActionRowBuilder().addComponents(

      input

    )

  );



  await interaction.showModal(

    modal

  );

}



async function handleVerificationModal(

  interaction

) {

  const code =

    interaction.fields.getTextInputValue(

      'verification_code'

    );



  const result =

    await verifyMember(

      interaction.guild,

      interaction.member,

      code

    );



  if (!result.ok) {

    await interaction.reply({

      content:

        `L ${result.reason}`,

      ephemeral: true

    });



    return;

  }



  await interaction.reply({

    content:

      '. Verificaío concluda com sucesso!',

    ephemeral: true

  });



  await sendLog(

    interaction.guild,

    `. ${interaction.user} concluiu a verificação.`

  );

}



async function createTempVoiceRoom(

  guild,

  member

) {

  const existingEntry =

    [...tempRooms.entries()].find(

      ([, data]) =>

        data.guildId === guild.id &&

        data.ownerId === member.id

    );



  if (existingEntry) {

    const [existingChannelId] = existingEntry;

    const existingChannel =

      guild.channels.cache.get(

        existingChannelId

      );



    if (existingChannel) {

      return existingChannel;

    }

    const fetchedExistingChannel =
      await guild.channels.fetch(existingChannelId).catch(() => null);

    if (fetchedExistingChannel) {
      return fetchedExistingChannel;
    }



    tempRooms.delete(

      existingChannelId

    );

    saveTempRooms();

  }



  let category = null;

  const configuredCategoryId =
    tempVoiceConfig.categoryId || TEMP_VOICE_CATEGORY_ID;

  if (configuredCategoryId) {
    category = guild.channels.cache.get(configuredCategoryId) || null;
  }

  if (!category || category.type !== ChannelType.GuildCategory) {
    category = guild.channels.cache.find(channel =>
      channel.type === ChannelType.GuildCategory &&
      channel.name.toLowerCase().includes('tempor')
    ) || null;
  }

  const channel =

    await guild.channels.create({

      name:

        String(tempVoiceConfig.defaultName || '🔊 {user}')
          .replace(/\{user\}/gi, member.user.username)
          .replace(/\{display\}/gi, member.displayName || member.user.username)
          .slice(0, 100),

      type:

        ChannelType.GuildVoice,



      parent:

        category?.id || undefined,



      userLimit:
        Number(tempVoiceConfig.userLimit) || 0,

      permissionOverwrites: [

        {

          id: guild.roles.everyone.id,

          allow: [

            PermissionFlagsBits.Connect,

            PermissionFlagsBits.ViewChannel

          ]

        },



        {

          id: member.id,

          allow: [

            PermissionFlagsBits.Connect,

            PermissionFlagsBits.ViewChannel,

            PermissionFlagsBits.ManageChannels,

            PermissionFlagsBits.MoveMembers

          ]

        }

      ]

    });



  tempRooms.set(

    channel.id,

    {

      guildId: guild.id,

      ownerId: member.id,

      createdAt: Date.now(),

      emptyTimer: null

    }

  );

  saveTempRooms();

  return channel;

}



function detectTempVoiceOwner(channel) {
  if (!channel?.guild) return null;

  // Primeiro tenta a informação persistida em temp-voice-rooms.json.
  const saved = tempRooms.get(channel.id);
  if (saved?.ownerId) {
    return saved.ownerId;
  }

  // Fallback para salas antigas: o dono recebe explicitamente
  // ManageChannels + MoveMembers na criação.
  const ownerOverwrite =
    channel.permissionOverwrites?.cache?.find(overwrite => {
      if (overwrite.type !== 1) return false;
      if (!overwrite.allow?.has(PermissionFlagsBits.ManageChannels)) return false;
      if (!overwrite.allow?.has(PermissionFlagsBits.MoveMembers)) return false;
      return overwrite.id !== client.user?.id;
    });

  return ownerOverwrite?.id || null;
}


function getTempRoom(

  channelId

) {

  const existing = tempRooms.get(

    channelId

  );

  if (existing) {

    return existing;

  }



  // Recupera salas mesmo depois de reiniciar o bot.
  const channel = client.channels.cache.get(

    channelId

  );

  const ownerId = detectTempVoiceOwner(channel);

  if (!ownerId || !channel?.guild) {

    return null;

  }



  const recovered = {

    guildId: channel.guild.id,

    ownerId,

    createdAt: Date.now(),

    emptyTimer: null

  };



  tempRooms.set(channelId, recovered);
  saveTempRooms();

  return recovered;

}



async function deleteTempRoom(

  guild,

  channelId

) {

  const data =

    tempRooms.get(

      channelId

    );



  if (!data) {

    return;

  }



  if (data.emptyTimer) {

    clearTimeout(

      data.emptyTimer

    );

  }



  tempRooms.delete(

    channelId

  );

  saveTempRooms();



  const channel =

    guild.channels.cache.get(

      channelId

    );



  if (channel) {

    await channel

      .delete(

        'Sala temporária vazia'

      )

      .catch(() => {});

  }

}



function scheduleEmptyRoomDeletion(

  guild,

  channel

) {

  const data =

    getTempRoom(

      channel.id

    );



  if (!data) {

    return;

  }



  if (

    channel.members.size > 0

  ) {

    if (data.emptyTimer) {

      clearTimeout(

        data.emptyTimer

      );



      data.emptyTimer = null;

    }



    return;

  }



  if (data.emptyTimer) {

    return;

  }



  data.emptyTimer =    setTimeout(

      async () => {

        const fresh =

          guild.channels.cache.get(

            channel.id

          );



        if (

          fresh &&

          fresh.members.size === 0

        ) {

          await deleteTempRoom(

            guild,

            channel.id

          );

        } else {

          data.emptyTimer =

            null;

        }

      },

      Math.max(1, Number(tempVoiceConfig.deleteAfterMinutes) || 5) * 60 * 1000

    );

}



async function transferTempRoomOwner(

  guild,

  channel

) {

  const data =

    getTempRoom(

      channel.id

    );



  if (!data) {

    return;

  }



  const newOwner =

    channel.members

      .filter(

        member =>

          member.id !==

          data.ownerId

      )

      .first();



  if (!newOwner) {

    scheduleEmptyRoomDeletion(

      guild,

      channel

    );



    return;

  }



  data.ownerId =

    newOwner.id;

  saveTempRooms();



  await channel.permissionOverwrites

    .edit(

      newOwner.id,

      {

        Connect: true,

        ViewChannel: true,

        ManageChannels: true,

        MoveMembers: true

      }

    )

    .catch(() => {});

}



async function recoverTempVoiceRooms() {
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.channels.fetch();
    } catch {}

    for (const channel of guild.channels.cache.values()) {
      if (channel.type !== ChannelType.GuildVoice) continue;

      const ownerId = detectTempVoiceOwner(channel);

      if (!ownerId) continue;

      const existing = tempRooms.get(channel.id);

      if (!existing || existing.ownerId !== ownerId || existing.guildId !== guild.id) {
        tempRooms.set(channel.id, {
          guildId: guild.id,
          ownerId,
          createdAt: existing?.createdAt || Date.now(),
          emptyTimer: null
        });
      }

      scheduleEmptyRoomDeletion(guild, channel);
    }
  }

  saveTempRooms();
}



function syncRankCallVoiceSessionsFromVoiceStates() {
  let changed = false;

  for (const guild of client.guilds.cache.values()) {
    const states = guild.voiceStates?.cache;

    if (!states) {
      continue;
    }

    for (const state of states.values()) {
      const userId =
        state?.id ||
        state?.member?.id ||
        null;

      if (!state?.channelId || !userId) {
        continue;
      }

      if (state?.member?.user?.bot) {
        continue;
      }

      const key = `${guild.id}:${userId}`;

      if (voiceSessions.has(key)) {
        continue;
      }

      const startedAt = Date.now();

      voiceSessions.set(
        key,
        startedAt
      );

      changed = true;

      if (dbReady && db) {
        q(`
          INSERT INTO voice_sessions (
            guild_id,
            user_id,
            started_at
          )
          VALUES (
            $1,
            $2,
            TO_TIMESTAMP($3 / 1000.0)
          )
          ON CONFLICT (guild_id, user_id)
          DO NOTHING
        `, [
          guild.id,
          userId,
          startedAt
        ]).catch((error) => {
          console.warn(
            `[RankCall] Erro ao registrar sessão sincronizada ${guild.id}:${userId}:`,
            error.message
          );
        });
      }
    }
  }

  if (changed) {
    saveVoiceSessionsLocal();
  }

  return changed;
}
function initializeRankCallVoiceSessions() {
  const activeNow = new Set();
  for (const guild of client.guilds.cache.values()) {
    const states = guild.voiceStates?.cache;
    if (!states) continue;
    for (const state of states.values()) {
      const userId = state?.id || state?.member?.id || null;
      if (!state?.channelId || !userId) continue;
      if (state?.member?.user?.bot) continue;
      const key = `${guild.id}:${userId}`;
      activeNow.add(key);
      if (!voiceSessions.has(key)) voiceSessions.set(key, Date.now());
    }
  }
  for (const key of [...voiceSessions.keys()]) {
    if (!activeNow.has(key)) voiceSessions.delete(key);
  }
  saveVoiceSessionsLocal();
  void evaluateRankCallStreaks();
}

async function handleVoiceStateUpdate(

  oldState,

  newState

) {

  const member =

    newState.member ||

    oldState.member;



  if (!member || member.user.bot) {

    return;

  }



  const guild =

    newState.guild ||

    oldState.guild;



  const wasInVoice =

    !!oldState.channelId;



  const isInVoice =

    !!newState.channelId;
if (

    !wasInVoice &&

    isInVoice

  ) {

    await updateVoiceSession(

      guild,

      member,

      true

    );

  }



  if (

    wasInVoice &&

    !isInVoice

  ) {

    await updateVoiceSession(

      guild,

      member,

      false

    );

  }



  const oldTemp =

    oldState.channelId &&

    tempRooms.get(

      oldState.channelId

    );



  const newTemp =

    newState.channelId &&

    tempRooms.get(

      newState.channelId

    );



  if (

    oldTemp &&

    oldState.channelId !==

      newState.channelId

  ) {

    const oldChannel =

      guild.channels.cache.get(

        oldState.channelId

      );



    if (oldChannel) {

      if (

        oldTemp.ownerId ===

        member.id

      ) {

        await transferTempRoomOwner(

          guild,

          oldChannel

        );

      }



      scheduleEmptyRoomDeletion(

        guild,

        oldChannel

      );

    }

  }



  if (

    newTemp &&

    newState.channelId

  ) {

    const channel =

      guild.channels.cache.get(

        newState.channelId

      );



    if (channel) {

      scheduleEmptyRoomDeletion(

        guild,

        channel

      );

    }

  }

}async function handleTempVoiceButton(

  interaction

) {

  if (

    !interaction.guild ||

    !interaction.member

  ) {

    return;

  }



  const channel =

    await createTempVoiceRoom(

      interaction.guild,

      interaction.member

    );



  await interaction.reply({

    content:

      `. Sua sala foi criada: ${channel}`,

    ephemeral: true

  });



  if (

    interaction.member.voice

      ?.channelId

  ) {

    await interaction.member.voice

      .setChannel(channel)

      .catch(() => {});

  }

}



async function renameTempRoom(

  interaction

) {

  const channel =

    interaction.member.voice

      ?.channel;



  if (!channel) {

    return interaction.reply({

      content:

        'L Você precisa estar em uma sala temporária.',

      ephemeral: true

    });

  }



  const data =

    getTempRoom(channel.id);



  if (!data) {

    return interaction.reply({

      content:

        'L Esta não  uma sala temporária.',

      ephemeral: true

    });

  }



  if (

    data.ownerId !==

    interaction.user.id

  ) {

    return interaction.reply({

      content:

        'L Somente o dono da sala pode alterar o nome.',

      ephemeral: true

    });

  }



  const modal =

    new ModalBuilder()

      .setCustomId(

        `tempvoice_rename:${channel.id}`

      )

      .setTitle(

        'Renomear sala'

      );



  const input =

    new TextInputBuilder()

      .setCustomId('name')

      .setLabel('Novo nome')

      .setStyle(

        TextInputStyle.Short

      )

      .setRequired(true)

      .setMaxLength(90)

      .setValue(channel.name);



  modal.addComponents(

    new ActionRowBuilder().addComponents(

      input

    )

  );



  await interaction.showModal(

    modal

  );

}



async function handleTempVoiceModal(

  interaction

) {

  const [, channelId] =

    interaction.customId.split(

      ':'

    );



  const channel =

    interaction.guild.channels.cache.get(

      channelId

    );



  if (!channel) {

    return interaction.reply({

      content:

        'L Sala não encontrada.',

      ephemeral: true

    });

  }



  const data =

    getTempRoom(channelId);



  if (

    !data ||

    data.ownerId !==

      interaction.user.id

  ) {

    return interaction.reply({

      content:

        'L Você não  o dono desta sala.',

      ephemeral: true

    });

  }



  const name =

    interaction.fields

      .getTextInputValue(

        'name'

      )

      .trim();



  if (!name) {

    return interaction.reply({

      content:

        'L Informe um nome vlido.',

      ephemeral: true

    });

  }



  await channel

    .setName(name)

    .catch(() => {});



  await interaction.reply({

    content:

      `. Nome alterado para **${name}**.`,

    ephemeral: true

  });

}



async function tempVoiceControl(

  interaction,

  action

) {

  const channel =

    interaction.member.voice

      ?.channel;



  if (!channel) {

    return interaction.reply({

      content:

        'L Você precisa estar em uma sala temporária.',

      ephemeral: true

    });

  }



  const data =

    getTempRoom(channel.id);



  if (!data) {

    return interaction.reply({

      content:

        'L Esta não  uma sala temporária.',

      ephemeral: true

    });

  }



  if (

    data.ownerId !==

    interaction.user.id

  ) {

    return interaction.reply({

      content:

        'L Somente o dono da sala pode usar este controle.',

      ephemeral: true

    });

  }



  if (action === 'lock') {

    try {

      await channel.permissionOverwrites.edit(

        interaction.guild.roles.everyone,

        {

          Connect: false

        }

      );

    } catch (e) {

      if (e?.code === 50013) {

        return interaction.reply({

          content:

            'L O bot não tem permissão para alterar as permissões desta sala. Dê ao cargo do bot a permissão **Gerenciar canais** e verifique se a categoria não possui uma negaío dessa permissão.',

          ephemeral: true

        });

      }

      throw e;

    }

    return interaction.reply({

      content:

        '🔒 Sala bloqueada.',

      ephemeral: true

    });

  }



  if (action === 'unlock') {

    try {

      await channel.permissionOverwrites.edit(

        interaction.guild.roles.everyone,

        {

          Connect: true

        }

      );

    } catch (e) {

      if (e?.code === 50013) {

        return interaction.reply({

          content:

            'L O bot não tem permissão para alterar as permissões desta sala. Dê ao cargo do bot a permissão **Gerenciar canais** e verifique se a categoria não possui uma negaío dessa permissão.',

          ephemeral: true

        });

      }

      throw e;

    }

    return interaction.reply({

      content:

        'Y"" Sala desbloqueada.',

      ephemeral: true

    });

  }



  if (action === 'delete') {

    await deleteTempRoom(

      interaction.guild,

      channel.id

    );



    return interaction.reply({

      content:

        '🗑️ Sala excluída.',

      ephemeral: true

    });

  }



  if (action === 'limit') {

    const modal =

      new ModalBuilder()

        .setCustomId(

          `tempvoice_limit:${channel.id}`

        )

        .setTitle(

          'Limite de usuários'

        );



    const input =

      new TextInputBuilder()

        .setCustomId(

          'limit'

        )

        .setLabel(

          'Quantidade de usuários'

        )

        .setPlaceholder(

          '0 = sem limite'

        )

        .setStyle(

          TextInputStyle.Short

        )

        .setRequired(true)

        .setMaxLength(2);



    modal.addComponents(

      new ActionRowBuilder()

        .addComponents(

          input

        )

    );



    return interaction.showModal(

      modal

    );

  }



  if (action === 'kick') {

    const options =

      channel.members

        .filter(

          member =>

            member.id !==

            interaction.user.id

        )

        .map(

          member =>

            new StringSelectMenuOptionBuilder()

              .setLabel(

                member.user.username

              )

              .setValue(

                member.id

              )

        )

        .slice(0, 25);



    if (!options.length) {

      return interaction.reply({

        content:

          'L Não h outros usuários na sala.',

        ephemeral: true

      });

    }



    const menu =

      new StringSelectMenuBuilder()

        .setCustomId(

          `tempvoice_kick:${channel.id}`

        )

        .setPlaceholder(

          'Escolha quem remover'

        )

        .addOptions(

          options

        );



    return interaction.reply({

      content:

        '👤 Escolha o usuário:',

      components: [

        new ActionRowBuilder()

          .addComponents(menu)

      ],

      ephemeral: true

    });

  }



  if (action === 'transfer') {

    const options =

      channel.members

        .filter(

          member =>

            member.id !==

            interaction.user.id

        )

        .map(

          member =>

            new StringSelectMenuOptionBuilder()

              .setLabel(

                member.user.username

              )

              .setValue(

                member.id

              )

        )

        .slice(0, 25);



    if (!options.length) {

      return interaction.reply({

        content:

          'L Não h outro usuário para receber a posse.',

        ephemeral: true

      });

    }



    const menu =

      new StringSelectMenuBuilder()

        .setCustomId(

          `tempvoice_transfer:${channel.id}`

        )

        .setPlaceholder(

          'Escolha o novo dono'

        )

        .addOptions(

          options

        );



    return interaction.reply({

      content:

        '👑 Escolha o novo dono:',

      components: [

        new ActionRowBuilder()

          .addComponents(menu)

      ],

      ephemeral: true

    });

  }

}



async function handleTempVoiceModalAction(

  interaction

) {

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const [

    action,

    channelId

  ] =

    interaction.customId.split(

      ':'

    );



  const channel =

    interaction.guild.channels.cache.get(

      channelId

    );



  const data =

    getTempRoom(channelId);



  if (

    !channel ||

    !data ||

    data.ownerId !==

      interaction.user.id

  ) {

    return interaction.editReply({

      content:

        'L Você não  o dono desta sala ou ela não existe mais.',


    });

  }



  if (

    action ===

    'tempvoice_limit'

  ) {

    const value =

      Number(

        interaction.fields

          .getTextInputValue(

            'limit'

          )

      );



    if (

      !Number.isInteger(

        value

      ) ||

      value < 0 ||

      value > 99

    ) {

      return interaction.editReply({

        content:

          'L Informe um número entre 0 e 99.',

  
      });

    }
    try {
      await channel.setUserLimit(value);
      return interaction.editReply({ content: `. Limite definido para **${value === 0 ? 'sem limite' : value}**.` });
    } catch (error) {
      console.error('[TempVoice] Erro ao alterar limite:', error);
      return interaction.editReply({ content: error?.code === 50013 ? 'L O bot não tem permissão para alterar o limite desta sala. Verifique **Gerenciar canais**.' : 'L Não foi possível alterar o limite da sala.' });
    }

  }



  if (

    action ===

    'tempvoice_rename'

  ) {

    const name =

      interaction.fields

        .getTextInputValue(

          'name'

        )

        .trim();
    if (!name) return interaction.editReply({ content: 'L Informe um nome vlido para a sala.' });

    try {
      await channel.setName(name);
      return interaction.editReply({ content: `. Sala renomeada para **${name}**.` });
    } catch (error) {
      console.error('[TempVoice] Erro ao renomear sala:', error);
      return interaction.editReply({ content: error?.code === 50013 ? 'L O bot não tem permissão para renomear esta sala. Verifique **Gerenciar canais** e as permissões da categoria.' : 'L Não foi possível renomear a sala.' });
    }

  }

}



async function handleTempVoiceSelect(

  interaction

) {

  const [

    action,

    channelId

  ] =

    interaction.customId.split(

      ':'

    );



  const selectedId =

    interaction.values[0];



  const channel =

    interaction.guild.channels.cache.get(

      channelId

    );



  const data =

    getTempRoom(channelId);



  if (

    !channel ||

    !data ||

    data.ownerId !==

      interaction.user.id

  ) {

    return interaction.reply({

      content:

        'L Você não  o dono desta sala.',

      ephemeral: true

    });

  }



  const member =

    interaction.guild.members.cache.get(

      selectedId

    );



  if (!member) {

    return interaction.reply({

      content:

        '⚠️ Usuário não encontrado.',

      ephemeral: true

    });

  }



  if (

    action ===

    'tempvoice_kick'

  ) {

    if (

      member.voice

        ?.channelId !==

      channel.id

    ) {

      return interaction.reply({

        content:

          'L O usuário não está mais na sala.',

        ephemeral: true

      });

    }



    await member.voice

      .disconnect(

        'Removido pelo dono da sala'

      )

      .catch(() => {});



    return interaction.update({

      content:

        `✅ ${member} foi removido da sala.`,

      components: []

    });

  }



  if (

    action ===

    'tempvoice_transfer'

  ) {

    data.ownerId =

      member.id;

    saveTempRooms();



    await channel.permissionOverwrites

      .edit(

        member.id,

        {

          Connect: true,

          ViewChannel: true,

          ManageChannels: true,

          MoveMembers: true

        }

      )

      .catch(() => {});



    await channel.permissionOverwrites

      .edit(

        interaction.user.id,

        {

          ManageChannels: false,

          MoveMembers: false

        }

      )

      .catch(() => {});



    return interaction.update({

      content:

        `Y'' A posse da sala foi transferida para ${member}.`,

      components: []

    });

  }

}



function buildTempVoicePanelPayload() {
  const embed = createEmbed({
    title: tempVoiceConfig.title || '🔊 Salas de Voz Temporárias',
    description: tempVoiceConfig.description || 'Clique no menu abaixo para criar e administrar sua sala de voz.',
    color: tempVoiceConfig.color || '#5865F2',
    footer: tempVoiceConfig.footer || undefined
  });

  if (tempVoiceConfig.banner) embed.setImage(tempVoiceConfig.banner);
  if (tempVoiceConfig.icon) embed.setThumbnail(tempVoiceConfig.icon);

  const emojis = { create:'🔊', rename:'✏️', lock:'🔒', unlock:'🔓', limit:'👥', kick:'👢', transfer:'👑', delete:'🗑️' };
  const actions = new StringSelectMenuBuilder()
    .setCustomId('tempvoice_action')
    .setPlaceholder('YZT Selecione uma aío para sua sala')
    .addOptions(Object.keys(tempVoiceConfig.options).filter(k => tempVoiceConfig.options[k]).map(option =>
      new StringSelectMenuOptionBuilder()
        .setLabel(getTempVoiceOptionLabel(option))
        .setDescription(getTempVoiceOptionDescription(option))
        .setEmoji(emojis[option])
        .setValue(option)
    ));

  if (!tempVoiceConfig.options.create) tempVoiceConfig.options.create = true;

  const config = new StringSelectMenuBuilder()
    .setCustomId('tempvoice_panel_config')
    .setPlaceholder(' Configuraío do painel')
    .addOptions(
      ['description','title','color','banner','icon','footer','defaultName','categoryId','deleteAfterMinutes','userLimit','options','authorizedRoleId','reset'].map((value, i) => {
        const data = [
          ['Descrição','Altera a descrição do embed.','📝'], ['Título','Altera o título do embed.','✏️'],
          ['Cor','Define a cor hexadecimal do embed.','🎨'], ['Banner','Adiciona ou altera a imagem principal.','🖼️'],
          ['Ícone / Thumbnail','Adiciona ou altera a thumbnail.','🖼️'], ['Rodapé','Personaliza o footer do painel.','📌'],
          ['Nome padrão das calls','Define o nome usado ao criar salas.','🔊'], ['Categoria das calls','Define a categoria onde as salas serão criadas.','📁'],
          ['Tempo de exclusão automática','Define os minutos que uma sala vazia permanece.','⏱️'], ['Limite padrão','Define o limite de usuários das novas salas.','👥'],
          ['Opções / botões do painel','Ativa ou desativa as opções da Call Priv.','⚙️'], ['Permissão de configuração','Define o cargo autorizado a configurar o painel.','🔐'],
          ['Restaurar padrão','Volta todas as configurações aos valores originais.','♻️']
        ][i];
        return new StringSelectMenuOptionBuilder().setLabel(data[0]).setDescription(data[1]).setEmoji(data[2]).setValue(value);
      })
    );

  return { embeds:[embed], components:[
    new ActionRowBuilder().addComponents(actions),
    new ActionRowBuilder().addComponents(config)
  ]};
}

async function refreshTempVoicePanel(guild) {
  if (!tempVoiceConfig.panelChannelId || !tempVoiceConfig.panelMessageId) return false;
  try {
    const channel = await guild.channels.fetch(tempVoiceConfig.panelChannelId);
    if (!channel?.isTextBased()) return false;
    const message = await channel.messages.fetch(tempVoiceConfig.panelMessageId);
    await message.edit(buildTempVoicePanelPayload());
    return true;
  } catch (error) {
    console.warn('[TempVoice] Falha ao atualizar painel em tempo real:', error.message);
    return false;
  }
}

async function sendTempVoicePanel(channel) {
  normalizeTempVoiceConfig();
  const message = await channel.send(buildTempVoicePanelPayload());
  tempVoiceConfig.panelChannelId = channel.id;
  tempVoiceConfig.panelMessageId = message.id;
  saveTempVoiceConfig();
  return message;
}

async function handleTempVoiceActionSelect(interaction) {
  const action = interaction.values[0];
  if (!tempVoiceConfig.options[action] && action !== 'create') {
    return interaction.reply({ content:'L Esta opção está desativada no painel.', ephemeral:true });
  }

  if (action === 'create') {
    const existing = [...tempRooms.entries()].find(([, data]) => data.guildId === interaction.guild.id && data.ownerId === interaction.user.id);
    if (existing) {
      const existingChannel = interaction.guild.channels.cache.get(existing[0]);
      if (existingChannel) {
        if (interaction.member.voice?.channelId !== existingChannel.id) await interaction.member.voice.setChannel(existingChannel).catch(() => {});
        return interaction.reply({ content:` Você já possui uma sala: ${existingChannel}`, ephemeral:true });
      }
      tempRooms.delete(existing[0]);
      saveTempRooms();
    }

    // A criação da sala pode passar de 3 segundos. Reconhea a interação antes da API do Discord.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const channel = await createTempVoiceRoom(interaction.guild, interaction.member);
      if (interaction.member.voice?.channelId !== channel.id) {
        await interaction.member.voice.setChannel(channel).catch(() => {});
      }
      return interaction.editReply({ content:`. Sua sala foi criada: ${channel}` });
    } catch (error) {
      console.error('[TempVoice] Erro ao criar sala:', error);
      return interaction.editReply({
        content: error?.code === 50013
          ? 'L O bot não tem permissão para criar/configurar a sala. Verifique **Gerenciar canais**, **Gerenciar permissões** e as permissões da categoria.'
          : 'L Não foi possível criar sua sala de voz. Verifique as permissões do bot e a categoria configurada.'
      });
    }
  }
  return tempVoiceControl(interaction, action);
}

async function handleTempVoicePanelConfigSelect(interaction) {
  if (!isTempVoicePanelAdmin(interaction.member)) {
    const roleId = tempVoiceConfig.authorizedRoleId || COMMAND_ACCESS_ROLE_ID;
    return interaction.reply({ content:`L Apenas Administrador ou membros com o cargo <@&${roleId}> podem configurar o painel.`, ephemeral:true });
  }

  const option = interaction.values[0];
  if (option === 'reset') {
    resetTempVoiceConfig();
    saveTempVoiceConfig();
    await refreshTempVoicePanel(interaction.guild);
    return interaction.reply({ content:'= Todas as configurações foram restauradas e o painel foi atualizado em tempo real.', ephemeral:true });
  }

  if (option === 'options') {
    const modal = new ModalBuilder().setCustomId('tempvoice_panel_config:options').setTitle('YZ> Opes do painel');
    for (const [key,label] of [['create','Criar sala'],['rename','Renomear sala'],['lock','Bloquear sala'],['unlock','Desbloquear sala'],['limit','Alterar limite'],['kick','Expulsar membro'],['transfer','Transferir posse'],['delete','Excluir sala']]) {
      modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(key).setLabel(`${label} " ON/OFF`).setPlaceholder('ON ou OFF').setValue(tempVoiceConfig.options[key] ? 'ON':'OFF').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3)));
    }
    return interaction.showModal(modal);
  }

  const labels = { description:'Descrição do painel', banner:'URL do banner', icon:'URL do ícone/thumbnail', title:'Título do painel', color:'Cor do embed', footer:'Rodapé do painel', defaultName:'Nome padrão das calls', categoryId:'ID da categoria das calls', deleteAfterMinutes:'Tempo para excluir sala vazia (minutos)', userLimit:'Limite padrão de usuários', authorizedRoleId:'ID do cargo autorizado' };
  const placeholders = { description:'Ex.: Crie e administre sua prpria sala...', banner:'https://exemplo.com/banner.png', icon:'https://exemplo.com/icone.png', title: 'Salas de Voz Temporárias', color:'#5865F2', footer: 'Call Priv - Configuração dinâmica', defaultName: '🔊 {user}', categoryId:'ID da categoria do Discord', deleteAfterMinutes:'5', userLimit:'0 = ilimitado', authorizedRoleId:'ID do cargo autorizado' };
  const modal = new ModalBuilder().setCustomId(`tempvoice_panel_config:${option}`).setTitle(labels[option]);
  const input = new TextInputBuilder().setCustomId('value').setLabel(labels[option]).setPlaceholder(placeholders[option]).setStyle(option === 'description' || option === 'footer' ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(false).setMaxLength(option === 'description' ? 4000 : 1000);
  const current = String(tempVoiceConfig[option] ?? '');
  if (current) input.setValue(current.slice(0, option === 'description' ? 4000 : 1000));
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

async function handleTempVoicePanelConfigModal(interaction) {
  if (!isTempVoicePanelAdmin(interaction.member)) return interaction.reply({ content:'L Você não possui permissão para configurar o painel.', ephemeral:true });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const option = interaction.customId.split(':')[1];

  if (option === 'options') {
    for (const key of ['create','rename','lock','unlock','limit','kick','transfer','delete']) {
      const value = interaction.fields.getTextInputValue(key).trim().toUpperCase();
      if (!['ON','OFF'].includes(value)) return interaction.editReply({ content:`L O campo **${getTempVoiceOptionLabel(key)}** deve ser \`ON\` ou \`OFF\`.` });
      tempVoiceConfig.options[key] = value === 'ON';
    }
    tempVoiceConfig.options.create = true;
    saveTempVoiceConfig(); await refreshTempVoicePanel(interaction.guild);
    return interaction.editReply({ content:'YZ> Opes do painel atualizadas em tempo real.' });
  }

  const value = interaction.fields.getTextInputValue('value').trim();
  if ((option === 'banner' || option === 'icon') && value && !/^https?:\/\//i.test(value)) return interaction.editReply({ content:'L Para banner/ícone, informe uma URL começando com `http://` ou `https://`.' });
  if (option === 'color' && value && !/^#[0-9A-Fa-f]{6}$/.test(value)) return interaction.editReply({ content:'L A cor deve estar no formato hexadecimal, por exemplo `#5865F2`.' });

  if (option === 'deleteAfterMinutes') {
    const n = Number(value); if (!Number.isInteger(n) || n < 1 || n > 10080) return interaction.editReply({ content:'L Informe um número inteiro entre 1 e 10080 minutos.' });
    tempVoiceConfig[option] = n;
  } else if (option === 'userLimit') {
    const n = Number(value); if (!Number.isInteger(n) || n < 0 || n > 99) return interaction.editReply({ content:'L O limite deve ser um número entre 0 e 99. Use `0` para ilimitado.' });
    tempVoiceConfig[option] = n;
  } else if (option === 'categoryId') {
    if (value) { const c = interaction.guild.channels.cache.get(value); if (!c || c.type !== ChannelType.GuildCategory) return interaction.editReply({ content:'L O ID informado não pertence a uma categoria vlida deste servidor.' }); }
    tempVoiceConfig[option] = value;
  } else if (option === 'authorizedRoleId') {
    if (value && !interaction.guild.roles.cache.get(value)) return interaction.editReply({ content:'L Não encontrei esse cargo neste servidor.' });
    tempVoiceConfig[option] = value;
  } else {
    tempVoiceConfig[option] = value;
  }

  normalizeTempVoiceConfig(); saveTempVoiceConfig(); await refreshTempVoicePanel(interaction.guild);
  const names = { description:'Descrição', banner:'Banner', icon:'Ícone/thumbnail', title:'Título', color:'Cor', footer:'Rodapé', defaultName:'Nome padrão', categoryId:'Categoria', deleteAfterMinutes:'Tempo de exclusão automática', userLimit:'Limite padrão', authorizedRoleId:'Permissão de configuração' };
  return interaction.editReply({ content:`. ${names[option] || option} atualizado e aplicado em tempo real.` });
}



async function showCallRanking(

  interaction

) {

  const ranking =

    await getVoiceRanking(

      interaction.guild.id,

      10

    );



  if (!ranking.length) {

    return interaction.reply({

      content:

        '📊 Ainda não existem dados de call suficientes.',

      ephemeral: true

    });

  }



  const lines =

    ranking.map(

      (row, index) =>

        `**${index + 1}.** <@${row.user_id}> " **${formatHours(row.voice_seconds)}h**`

    );



  await interaction.reply({

    embeds: [

      createEmbed({

        title:

          'Y Ranking de Call',

        description:

          lines.join('\n'),

        color:

          '#FEE75C'

      })

    ],

    ephemeral: true

  });

}



async function showUserCallHours(

  interaction,

  userId

) {

  try {

    await interaction.deferReply({

      flags: MessageFlags.Ephemeral

    });



    const result =

      await q(

        `

        SELECT

          voice_seconds

        FROM bot_users

        WHERE

          guild_id = $1

          AND user_id = $2

        `,

        [

          interaction.guild.id,

          userId

        ]

      );



    const seconds =

      Number(

        result?.rows?.[0]

          ?.voice_seconds || 0

      );



    return interaction.editReply({

      content:

        `=
 <@${userId}> possui **${formatHours(seconds)} horas** em call.`

    });



  } catch (error) {

    console.error(

      '[Call Hours] Erro:',

      error

    );



    if (

      interaction.deferred ||

      interaction.replied

    ) {

      return interaction.editReply({

        content:

          'L Não foi possível consultar as horas em call.'

      });

    }



    return interaction.reply({

      content:

        'L Não foi possível consultar as horas em call.',

      flags: MessageFlags.Ephemeral

    });

  }

}



async function createMatchProfile(

  interaction,

  category

) {

  const modal =

    new ModalBuilder()

      .setCustomId(

        `match_profile:${category}`

      )

      .setTitle(

        `Perfil de Match " ${category}`

      );



  const nome =

    new TextInputBuilder()

      .setCustomId('nome')

      .setLabel('Nome')

      .setStyle(

        TextInputStyle.Short

      )

      .setRequired(true)

      .setMaxLength(50);



  const idade =

    new TextInputBuilder()

      .setCustomId('idade')

      .setLabel('Idade')

      .setStyle(

        TextInputStyle.Short

      )

      .setRequired(true)

      .setMaxLength(3);



  const sobre =

    new TextInputBuilder()

      .setCustomId('sobre')

      .setLabel('Sobre mim')

      .setStyle(

        TextInputStyle.Paragraph

      )

      .setRequired(true)

      .setMaxLength(1000);



  const social =

    new TextInputBuilder()

      .setCustomId('social')

      .setLabel('Rede social')

      .setStyle(

        TextInputStyle.Short

      )

      .setRequired(false)

      .setMaxLength(200);



  modal.addComponents(

    new ActionRowBuilder()

      .addComponents(nome),



    new ActionRowBuilder()

      .addComponents(idade),



    new ActionRowBuilder()

      .addComponents(sobre),



    new ActionRowBuilder()

      .addComponents(social)

  );



  await interaction.showModal(

    modal

  );

}async function handleMatchProfileModal(

  interaction

) {

  const [, category] =

    interaction.customId.split(':');



  const nome =

    interaction.fields.getTextInputValue(

      'nome'

    );



  const idade =

    interaction.fields.getTextInputValue(

      'idade'

    );



  const sobre =

    interaction.fields.getTextInputValue(

      'sobre'

    );



  const social =

    interaction.fields.getTextInputValue(

      'social'

    ) || 'Não informado';



  const embed =

    createEmbed({

      title:

        `= Perfil de Match " ${nome}`,



      description:

        sobre,



      color:

        matchConfig.color,



      fields: [

        {

          name: '👤 Nome',

          value: nome,

          inline: true

        },

        {

          name: 'YZ, Idade',

          value: idade,

          inline: true

        },

        {

          name: 'Y", Categoria',

          value: category,

          inline: true

        },

        {

          name: 'YO Rede Social',

          value: social,

          inline: true

        },

        {

          name: '💬 Discord',

          value:

            `<@${interaction.user.id}>`,

          inline: true

        }

      ],



      footer:

        `ID do perfil: ${interaction.user.id}`

    });



  const row =

    new ActionRowBuilder()

      .addComponents(

        new ButtonBuilder()

          .setCustomId(

            `match_like:${interaction.user.id}`

          )

          .setLabel(

            'd Dar Match'

          )

          .setStyle(

            ButtonStyle.Success

          ),



        new ButtonBuilder()

          .setCustomId(

            `match_block:${interaction.user.id}`

          )

          .setLabel(

            ' Bloquear'

          )

          .setStyle(

            ButtonStyle.Danger

          )

      );



  await q(

    `

    INSERT INTO matches(

      guild_id,

      owner_id,

      category,

      nome,

      idade,

      descricao,

      social

    )

    VALUES($1,$2,$3,$4,$5,$6,$7)

    `,

    [

      interaction.guild.id,

      interaction.user.id,

      category,

      nome,

      idade,

      sobre,

      social

    ]

  );



  const channel =

    interaction.guild.channels.cache.get(

      TARGET_MATCH_CHANNEL_ID

    );



  if (

    channel?.isTextBased()

  ) {

    await channel.send({

      embeds: [embed],

      components: [row]

    });

  }



  await interaction.reply({

    content:      '. Seu perfil foi criado e publicado no painel de Match.',

    ephemeral: true

  });

}



async function handleMatchLike(

  interaction,

  targetId

) {

  if (

    targetId ===

    interaction.user.id

  ) {

    return interaction.reply({

      content:

        'L Você não pode dar Match no prprio perfil.',

      ephemeral: true

    });

  }



  const result =

    await q(

      `

      SELECT id

      FROM matches

      WHERE

        guild_id = $1

        AND owner_id = $2

      ORDER BY created_at DESC

      LIMIT 1

      `,

      [

        interaction.guild.id,

        targetId

      ]

    );



  if (!result?.rows?.length) {

    return interaction.reply({

      content:

        'L Perfil não encontrado.',

      ephemeral: true

    });

  }



  const matchId =

    result.rows[0].id;



  await q(

    `

    INSERT INTO match_actions(

      guild_id,

      match_id,

      actor_id,

      action

    )

    VALUES($1,$2,$3,'like')

    `,

    [

      interaction.guild.id,

      matchId,

      interaction.user.id

    ]

  );



  const mutual =

    await q(

      `

      SELECT 1

      FROM match_actions

      WHERE

        guild_id = $1

        AND match_id = $2

        AND actor_id = $3

        AND action = 'like'

      LIMIT 1

      `,

      [

        interaction.guild.id,

        matchId,

        targetId

      ]

    );



  if (mutual?.rowCount) {

    const target =

      await client.users

        .fetch(targetId)

        .catch(() => null);



    try {

      await interaction.user.send({

        content:

          `= **Match mtuo!**\nVocê e ${target || `<@${targetId}>`} deram Match um no outro!`

      });

    } catch {}



    try {

      if (target) {

        await target.send({

          content:

            `= **Match mtuo!**\nVocê e ${interaction.user} deram Match um no outro!`

        });

      }

    } catch {}



    return interaction.reply({

      content:

        '= **Match mtuo!** As duas pessoas receberam uma notificaío por DM.',

      ephemeral: true

    });

  }



  await interaction.reply({

    content:

      'd Interesse registrado! Se a outra pessoa também curtir seu perfil, ser um Match mtuo.',

    ephemeral: true

  });

}



async function handleMatchBlock(

  interaction,

  targetId

) {

  await q(

    `

    INSERT INTO match_actions(

      guild_id,

      match_id,

      actor_id,

      action

    )

    SELECT

      $1,

      id,

      $2,

      'block'

    FROM matches

    WHERE

      guild_id = $1

      AND owner_id = $3

    ORDER BY created_at DESC

    LIMIT 1

    `,

    [

      interaction.guild.id,

      interaction.user.id,

      targetId

    ]

  );



  await interaction.reply({

    content:

      ' Perfil bloqueado para você.',

    ephemeral: true

  });

}



async function sendMatchPanel(

  channel

) {

  const embed =

    createEmbed({

      title:

        matchConfig.title,



      description:

        matchConfig.description,



      color:

        matchConfig.color,



      footer:

        'Crie seu perfil e encontre novas conexões.'

    });



  if (

    matchConfig.banner &&

    isValidHttpUrl(

      matchConfig.banner

    )

  ) {

    embed.setImage(

      matchConfig.banner

    );

  }



  if (

    matchConfig.icon &&

    isValidHttpUrl(

      matchConfig.icon

    )

  ) {

    embed.setThumbnail(

      matchConfig.icon

    );

  }



  const menu =

    new StringSelectMenuBuilder()

      .setCustomId(

        'match_category'

      )

      .setPlaceholder(

        'Escolha uma categoria'

      )

      .addOptions(

        new StringSelectMenuOptionBuilder()

          .setLabel(

            'Categoria Normal'

          )

          .setDescription(

            'Criar perfil na categoria normal'

          )

          .setValue(

            'cat_normal'

          ),



        new StringSelectMenuOptionBuilder()

          .setLabel(

            'Categoria Paneleiros'

          )

          .setDescription(

            'Criar perfil na categoria Paneleiros'

          )

          .setValue(

            'cat_paneleiros'

          )

      );



  const row =

    new ActionRowBuilder()

      .addComponents(

        menu

      );



  const message =

    await channel.send({

      embeds: [embed],

      components: [row]

    });



  matchConfig.panelChannelId =

    channel.id;



  matchConfig.panelMessageId =

    message.id;



  saveMatchConfig();



  return message;

}



async function registerCommands() {

  const commands = [

    new SlashCommandBuilder()

      .setName('ping')

      .setDescription(

        'Verifica se o bot está online.'

      ),



    new SlashCommandBuilder()

      .setName('clear')

      .setDescription(

        'Apaga mensagens.'

      )

      .addIntegerOption(option =>

        option

          .setName('quantidade')

          .setDescription(

            'Quantidade de mensagens.'

          )

          .setRequired(true)

          .setMinValue(1)

          .setMaxValue(100)

      ),



    new SlashCommandBuilder()

      .setName('mute')

      .setDescription('Aplica timeout em canais de texto e voz por uma duração definida.')

      .addUserOption(option =>
        option
          .setName('usuario')
          .setDescription('Membro a silenciar.')
          .setRequired(true)
      )

      .addStringOption(option =>
        option
          .setName('duracao')
          .setDescription('Ex.: 30m, 4h, 2d ou 1w (máximo 28 dias).')
          .setRequired(true)
      )

      .addStringOption(option =>
        option
          .setName('motivo')
          .setDescription('Motivo do timeout.')
          .setRequired(false)
      )

      .addStringOption(option =>
        option
          .setName('prova')
          .setDescription('Link opcional de prova.')
          .setRequired(false)
      )

      .addAttachmentOption(option =>
        option
          .setName('anexo')
          .setDescription('Anexo opcional de prova.')
          .setRequired(false)
      ),

    new SlashCommandBuilder()

      .setName('kick')

      .setDescription(

        'Expulsa um membro.'

      )

      .addUserOption(option =>

        option

          .setName('usuario')

          .setDescription(

            'Usuário.'

          )

          .setRequired(true)

      )

      .addStringOption(option =>
        option
          .setName('motivo')
          .setDescription(

            'Motivo.'

          )

          .setRequired(false)
      ),



    new SlashCommandBuilder()

      .setName('ban')

      .setDescription(

        'Bane um membro.'

      )

      .addUserOption(option =>

        option

          .setName('usuario')

          .setDescription(

            'Usuário.'

          )

          .setRequired(true)

      )

      .addStringOption(option =>
        option

          .setName('motivo')

          .setDescription(

            'Motivo.'

          )

          .setRequired(false)

      )
      .addStringOption(option =>
        option
          .setName('prova')
          .setDescription('Link opcional de prova.')
          .setRequired(false)
      )
      .addAttachmentOption(option =>
        option
          .setName('anexo')
          .setDescription('Anexo opcional de prova.')
          .setRequired(false)
      ),



    new SlashCommandBuilder()

      .setName('ticket')

      .setDescription(

        'Cria um ticket.'

      ),



    new SlashCommandBuilder()

      .setName('close')

      .setDescription(

        'Fecha o ticket atual.'

      ),



    new SlashCommandBuilder()

      .setName('role')

      .setDescription(

        'Gerencia cargos.'

      )

      .addSubcommand(sub =>

        sub

          .setName('add')

          .setDescription(

            'Adiciona cargo.'

          )

          .addUserOption(option =>

            option

              .setName('usuario')

              .setDescription(

                'Usuário.'

              )

              .setRequired(true)

          )

          .addRoleOption(option =>

            option

              .setName('cargo')

              .setDescription(

                'Cargo.'

              )

              .setRequired(true)

          )

      )

      .addSubcommand(sub =>

        sub

          .setName('remove')

          .setDescription(

            'Remove cargo.'

          )

          .addUserOption(option =>

            option

              .setName('usuario')

              .setDescription(

                'Usuário.'

              )

              .setRequired(true)

          )

          .addRoleOption(option =>

            option

              .setName('cargo')

              .setDescription(

                'Cargo.'

              )

              .setRequired(true)

          )

      ),



    new SlashCommandBuilder()

      .setName('ask')

      .setDescription(

        'Pergunta para a IA.'

      )

      .addStringOption(option =>

        option

          .setName('pergunta')

          .setDescription(

            'Sua pergunta.'

          )

          .setRequired(true)

      ),



    new SlashCommandBuilder()

      .setName('dashboard')

      .setDescription(

        'Mostra o painel de estatsticas.'

      ),



    new SlashCommandBuilder()

      .setName('verify')

      .setDescription(

        'Envia o painel de verificação.'

      ),



    new SlashCommandBuilder()

      .setName('voicepanel')

      .setDescription(

        'Envia o painel de salas temporárias.'

      ),



    new SlashCommandBuilder()

      .setName('rankcall')

      .setDescription(

        'Mostra o ranking de horas em call.'

      ),



    new SlashCommandBuilder()

      .setName('horascall')

      .setDescription(

        'Mostra as horas de call de um usuário.'

      )

      .addUserOption(option =>

        option

          .setName('usuario')

          .setDescription(

            'Usuário.'

          )

          .setRequired(false)

      ),



    new SlashCommandBuilder()

      .setName('call')

      .setDescription(

        'Mostra as horas de call de um usuário.'

      )

      .addUserOption(option =>

        option

          .setName('usuario')

          .setDescription(

            'Usuário.'

          )

          .setRequired(true)

      ),



    new SlashCommandBuilder()

      .setName('match')

      .setDescription(

        'Envia o painel de Match.'

      ),



    new SlashCommandBuilder()

      .setName('rules')

      .setDescription(

        'Gerencia as regras do servidor.'

      )

      .addSubcommand(sub =>

        sub

          .setName('list')

          .setDescription(

            'Lista as regras.'

          )

      )

      .addSubcommand(sub =>

        sub

          .setName('add')

          .setDescription(

            'Adiciona uma regra.'

          )

          .addStringOption(option =>

            option

              .setName('titulo')

              .setDescription(

                'Título.'

              )

              .setRequired(true)

          )

          .addStringOption(option =>

            option

              .setName('texto')

              .setDescription(

                'Texto da regra.'

              )

              .setRequired(true)

          )

      )

      .addSubcommand(sub =>

        sub

          .setName('remove')

          .setDescription(

            'Remove uma regra.'

          )

          .addIntegerOption(option =>

            option

              .setName('id')

              .setDescription(

                'ID da regra.'

              )

              .setRequired(true)

          )

      )



      .addSubcommand(sub =>
        sub
          .setName('panel')
          .setDescription('Envia/renova o painel de regras no canal configurado.')
      ),


    new SlashCommandBuilder()

      .setName('permission')

      .setDescription(

        'Gerencia permissões personalizadas.'

      )

      .addSubcommand(sub =>

        sub

          .setName('grant')

          .setDescription(

            'Concede uma permissão a um cargo.'

          )

          .addRoleOption(option =>

            option

              .setName('cargo')

              .setDescription(

                'Cargo.'

              )

              .setRequired(true)

          )

          .addStringOption(option =>

            option

              .setName('permissao')

              .setDescription(

                'Permissão.'

              )

              .setRequired(true)

              .addChoices(

                ...PERMISSIONS.map(

                  permission => ({

                    name: permission,

                    value: permission

                  })

                )

              )

          )

      )

      .addSubcommand(sub =>

        sub

          .setName('revoke')

          .setDescription(

            'Remove uma permissão.'

          )

          .addRoleOption(option =>

            option

              .setName('cargo')

              .setDescription(

                'Cargo.'

              )

              .setRequired(true)

          )

          .addStringOption(option =>

            option

              .setName('permissao')

              .setDescription(

                'Permissão.'

              )

              .setRequired(true)

              .addChoices(

                ...PERMISSIONS.map(

                  permission => ({

                    name: permission,

                    value: permission

                  })

                )

              )

          )

      )

      .addSubcommand(sub =>

        sub

          .setName('list')

          .setDescription(

            'Lista as permissões de um cargo.'

          )

          .addRoleOption(option =>

            option

              .setName('cargo')

              .setDescription(

                'Cargo.'

              )

              .setRequired(true)

          )

      )

  ];



  const rest =

    new REST({

      version: '10'

    }).setToken(token);



  try {

    if (GUILD_ID) {

      await rest.put(

        Routes.applicationGuildCommands(

          client.user.id,

          GUILD_ID

        ),

        {

          body:

            commands.map(

              command =>

                command.toJSON()

            )

        }

      );

    } else {

      await rest.put(

        Routes.applicationCommands(

          client.user.id

        ),

        {

          body:

            commands.map(

              command =>

                command.toJSON()

            )

        }

      );

    }



    console.log(

      '[Comandos] Comandos Slash registrados com sucesso.'

    );

  } catch (e) {

    console.error(

      '[Comandos] Erro:',

      e.message

    );

  }

}



async function handleSlashCommand(

  interaction

) {

  const command =

    interaction.commandName;



  if (command === 'ping') {

    return interaction.reply({

      content:

        `Y" Pong! ${client.ws.ping}ms`,

      ephemeral: true

    });

  }



  if (command === 'dashboard') {

    if (

      !(

        await requirePermission(

          interaction.member,

          'dashboard.view'

        )

      )

    ) {

      return interaction.reply({

        content:

          'L Você não possui a permissão `dashboard.view`.',

        ephemeral: true

      });

    }



    const embed =

      await buildDashboardEmbed(

        interaction.guild

      );



    return interaction.reply({

      embeds: [embed]

    });

  }



  if (command === 'rankcall') {

    return showCallRanking(

      interaction

    );

  }



  if (

    command === 'horascall' ||

    command === 'call'

  ) {

    const user =

      interaction.options.getUser(

        'usuario'

      ) || interaction.user;



    return showUserCallHours(

      interaction,

      user.id

    );

  }



  if (command === 'verify') {

    if (

      !(

        await requirePermission(

          interaction.member,

          'verification.manage'

        )

      )

    ) {

      return interaction.reply({

        content:

          'L Você não possui a permissão `verification.manage`.',

        ephemeral: true

      });

    }



    await sendVerificationPanel(

      interaction.channel

    );



    return interaction.reply({

      content:

        '. Painel de verificação enviado.',

      ephemeral: true

    });

  }



  if (command === 'voicepanel') {

    if (

      !(

        await requirePermission(

          interaction.member,

          'voice.manage'

        )

      )

    ) {

      return interaction.reply({

        content:

          'L Você não possui a permissão `voice.manage`.',

        ephemeral: true

      });

    }



    await sendTempVoicePanel(

      interaction.channel

    );



    return interaction.reply({

      content:

        '. Painel de voz enviado.',

      ephemeral: true

    });

  }



  if (command === 'match') {

    if (

      !(

        await requirePermission(

          interaction.member,

          'match.manage'

        )

      )

    ) {

      return interaction.reply({

        content:

          'L Você não possui a permissão `match.manage`.',

        ephemeral: true

      });

    }



    await sendMatchPanel(

      interaction.channel

    );



    return interaction.reply({

      content:

        '. Painel de Match enviado.',

      ephemeral: true

    });

  }



  if (command === 'ask') {

    const question =

      interaction.options.getString(

        'pergunta',

        true

      );



    await interaction.deferReply();



    try {

      const answer =

        await askAIWithRules(

          interaction.guild.id,

          question

        );



      return interaction.editReply(

        answer.slice(0, 1900)

      );

    } catch (e) {

      return interaction.editReply(

        `L ${e.message}`

      );

    }

  }



  if (command === 'rules') {

    if (

      !(await requirePermission(

        interaction.member,

        'rules.manage'

      ))

    ) {

      return interaction.reply({

        content:

          'L Você não possui a permissão `rules.manage`.',

        ephemeral: true

      });

    }



    const sub =

      interaction.options.getSubcommand();


    if (sub === 'panel') {
      const ok = await refreshRulesPanel(interaction.guild);
      return interaction.reply({
        content: ok ? `. Painel de regras enviado/renovado no canal <#${RULES_CHANNEL_ID}>.` : 'L Não consegui acessar o canal configurado para as regras.',
        flags: MessageFlags.Ephemeral
      });
    }



    if (sub === 'list') {

      const rules =

        await getRules(

          interaction.guild.id

        );



      if (!rules.length) {

        return interaction.reply({

          content:

            '= Nenhuma regra cadastrada.',

          ephemeral: true

        });

      }



      const text =

        rules

          .map(

            rule =>

              `**#${rule.rule_id} " ${rule.title}**\n${rule.content}`

          )

          .join('\n\n');



      return interaction.reply({

        embeds: [

          createEmbed({

            title:

              '= Regras do servidor',

            description:

              text.slice(0, 4000),

            color:

              '#5865F2'

          })

        ],

        ephemeral: true

      });

    }



    if (sub === 'add') {

      const title =

        interaction.options.getString(

          'titulo',

          true

        );



      const content =

        interaction.options.getString(

          'texto',

          true

        );



      await q(

        `

        INSERT INTO rules(

          guild_id,

          title,

          content,

          created_by

        )

        VALUES($1,$2,$3,$4)

        `,

        [

          interaction.guild.id,

          title,

          content,

          interaction.user.id

        ]

      );



      return interaction.reply({

        content:

          '. Regra adicionada.',

        ephemeral: true

      });

    }



    if (sub === 'remove') {

      const id =

        interaction.options.getInteger(

          'id',

          true

        );



      await q(

        `

        DELETE FROM rules

        WHERE

          guild_id = $1

          AND rule_id = $2

        `,

        [

          interaction.guild.id,

          id

        ]

      );



      return interaction.reply({

        content:

          '. Regra removida, caso existisse.',

        ephemeral: true

      });

    }

  }



  if (command === 'permission') {

    if (!isAdmin(

      interaction.member

    )) {

      return interaction.reply({

        content:

          'L Somente administradores do Discord podem configurar permissões personalizadas.',

        ephemeral: true

      });

    }



    const sub =

      interaction.options.getSubcommand();



    const role =

      interaction.options.getRole(

        'cargo',

        true

      );



    const permission =

      interaction.options.getString(

        'permissao'

      );



    if (sub === 'grant') {

      await grantPermission(

        interaction.guild.id,

        role.id,

        permission

      );



      return interaction.reply({

        content:

          `. \`${permission}\` concedida ao cargo ${role}.`,

        ephemeral: true

      });

    }



    if (sub === 'revoke') {

      await revokePermission(

        interaction.guild.id,

        role.id,

        permission

      );



      return interaction.reply({

        content:

          `. \`${permission}\` removida do cargo ${role}.`,

        ephemeral: true

      });

    }



    if (sub === 'list') {

      const permissions =

        await permissionList(

          interaction.guild.id,

          role.id

        );



      return interaction.reply({

        content:

          permissions.length

            ? `= Permissões de ${role}:\n${permissions.map(p => ` \`${p}\``).join('\n')}`

            : `" O cargo ${role} não possui permissões personalizadas.`,

        ephemeral: true

      });

    }

  }



  if (command === 'clear') {

    if (

      !(await requirePermission(

        interaction.member,

        'moderation.clear'

      ))

    ) {

      return interaction.reply({

        content:

          'L Você não possui `moderation.clear`.',

        ephemeral: true

      });

    }



    const amount =

      interaction.options.getInteger(

        'quantidade',

        true

      );



    await interaction.deferReply({

      ephemeral: true

    });



    const deleted =

      await interaction.channel.bulkDelete(

        amount,

        true

      );



    return interaction.editReply(

      `= ${deleted.size} mensagens apagadas.`

    );

  }



  if (command === 'kick' || command === 'ban' || command === 'mute') {

    const permission =
      command === 'kick'
        ? 'moderation.kick'
        : command === 'mute'
          ? 'moderation.mute'
          : 'moderation.ban';



    if (

      !(await requirePermission(

        interaction.member,

        permission

      ))

    ) {

      return interaction.reply({

        content:

          `L Você não possui \`${permission}\`.`,

        ephemeral: true

      });

    }



    const user =

      interaction.options.getUser(

        'usuario',

        true

      );



    const reason =

      interaction.options.getString(

        'motivo'

      ) ||

      'Sem motivo informado';

    const durationText = command === 'mute'
      ? interaction.options.getString('duracao', true)
      : null;
    const duration = durationText ? parseModerationDuration(durationText) : null;
    if (command === 'mute' && !duration) {
      return interaction.reply({
        content: '❌ Duração inválida. Use `30m`, `4h`, `2d` ou `1w` (máximo 28 dias).',
        ephemeral: true
      });
    }

    const proofLink = interaction.options.getString('prova');
    if (proofLink && !/^https?:\/\/\S+$/i.test(proofLink)) {
      return interaction.reply({
        content: '❌ O link de prova precisa começar com http:// ou https://.',
        ephemeral: true
      });
    }
    const proofAttachment = interaction.options.getAttachment('anexo');
    const proofs = [
      ...(proofLink ? [{ url: proofLink, name: 'Prova por link' }] : []),
      ...(proofAttachment ? [{
        url: proofAttachment.url,
        name: proofAttachment.name || 'Prova anexada',
        attachment: true
      }] : [])
    ];

    const member = command === 'ban'
      ? null
      :
      await interaction.guild.members

        .fetch(user.id)

        .catch(() => null);

    if (command !== 'ban' && !member) {

      return interaction.reply({

        content:

          'L Membro não encontrado.',

        ephemeral: true

      });

    }



    try {

      if (command === 'kick') {

        await member.kick(reason);

      } else if (command === 'mute') {

        await member.timeout(duration, reason.slice(0, 480));

      } else {

        await interaction.guild.members.ban(user.id, { reason: reason.slice(0, 480) });

      }

      const loggedReason = [
        reason,
        duration ? `Duração: ${formatModerationDuration(duration)}` : '',
        ...proofs.map(proof => `Prova: ${proof.url}`)
      ].filter(Boolean).join('\n');

      await logModeration(

        interaction.guild.id,

        user.id,

        interaction.user.id,

        command,

        loggedReason

      );
      const logSent = await sendModerationEmbed(interaction.guild, {
        action: command,
        target: user,
        moderator: interaction.user,
        reason,
        duration,
        proofs
      });

      return interaction.reply({

        content: `✅ ${user.tag} foi ${
          command === 'kick'
            ? 'expulso'
            : command === 'mute'
              ? `silenciado por ${formatModerationDuration(duration)}`
              : 'banido'
        }.${logSent ? '' : '\n⚠️ A ação foi aplicada, mas o log não foi publicado. Configure MUTE_LOG_CHANNEL_ID, BAN_LOG_CHANNEL_ID ou LOG_CHANNEL_ID.'}`,

        ephemeral: true

      });

    } catch (e) {

      return interaction.reply({

        content:

          `L Não foi possível executar a aío: ${e.message}`,

        ephemeral: true

      });

    }

  }



  if (command === 'role') {

    if (

      !isAdmin(

        interaction.member

      )

    ) {

      return interaction.reply({

        content:

          'L Você precisa ser administrador para usar este comando.',

        ephemeral: true

      });

    }



    const sub =

      interaction.options.getSubcommand();



    const user =

      interaction.options.getUser(

        'usuario',

        true

      );



    const role =

      interaction.options.getRole(

        'cargo',

        true

      );



    const member =

      await interaction.guild.members

        .fetch(user.id)

        .catch(() => null);



    if (!member) {

      return interaction.reply({

        content:

          'L Membro não encontrado.',

        ephemeral: true

      });

    }



    try {

      if (sub === 'add') {

        await member.roles.add(

          role

        );

      } else {

        await member.roles.remove(

          role

        );

      }



      return interaction.reply({

        content:

          `. Cargo ${role} ${sub === 'add' ? 'adicionado a' : 'removido de'} ${member}.`,

        ephemeral: true

      });

    } catch (e) {

      return interaction.reply({

        content:

          `L Erro ao gerenciar cargo: ${e.message}`,

        ephemeral: true

      });

    }

  }



  if (command === 'ticket') {

    const permission =

      await requirePermission(

        interaction.member,

        'ticket.manage'

      );



    if (!permission) {

      return interaction.reply({

        content:

          'L Você não possui `ticket.manage`.',

        ephemeral: true

      });

    }



    const channel =

      await interaction.guild.channels.create(

        {

          name:

            `ticket-${interaction.user.username}`

              .toLowerCase()

              .replace(

                /[^a-z0-9-]/g,

                ''

              )

              .slice(0, 80),



          type:

            ChannelType.GuildText,



          permissionOverwrites: [

            {

              id:

                interaction.guild

                  .roles

                  .everyone

                  .id,



              deny: [

                PermissionFlagsBits.ViewChannel

              ]

            },



            {

              id:

                interaction.user.id,



              allow: [

                PermissionFlagsBits.ViewChannel,

                PermissionFlagsBits.SendMessages,

                PermissionFlagsBits.ReadMessageHistory

              ]

            }

          ]

        }

      );



    await q(

      `

      INSERT INTO tickets(

        guild_id,

        user_id,

        channel_id

      )

      VALUES($1,$2,$3)

      ON CONFLICT(

        guild_id,

        user_id

      )

      DO UPDATE SET

        channel_id = EXCLUDED.channel_id,

        opened_at = NOW(),

        closed_at = NULL

      `,

      [

        interaction.guild.id,

        interaction.user.id,

        channel.id

      ]

    );



    await channel.send({

      content:

        `< ${interaction.user}, seu ticket foi criado.\nUse **/close** quando quiser fech-lo.`

    });



    return interaction.reply({

      content:

        `. Ticket criado: ${channel}`,

      ephemeral: true

    });

  }



  if (command === 'close') {

    if (

      !(

        await requirePermission(

          interaction.member,

          'ticket.manage'

        )

      ) &&

      !interaction.channel.name.startsWith(

        'ticket-'

      )

    ) {

      return interaction.reply({

        content:

          'L Você não possui permissão para fechar este ticket.',

        ephemeral: true

      });

    }



    await q(

      `

      UPDATE tickets

      SET closed_at = NOW()

      WHERE

        guild_id = $1

        AND channel_id = $2

      `,

      [

        interaction.guild.id,

        interaction.channel.id

      ]

    );



    await interaction.reply({

      content:

        '🔒 Ticket fechado.'

    });



    setTimeout(() => {

      interaction.channel

        .delete(

          'Ticket fechado'

        )

        .catch(() => {});

    }, 3000);



    return;

  }

}



client.once(

  Events.ClientReady,

  async () => {

    console.log(

      `Bot conectado como ${client.user.tag}`

    );



    console.log(

      `IA configurada: ${

        hasOpenAIKey()

          ? 'sim'

          : 'não'

      }`

    );



    await initDB();
    await syncLocalVoiceHoursToDatabase();
    await ensureRankCallDatabaseTables();
    await loadRankCallStreaksFromDatabase();
    await restoreRankCallVoiceSessionsFromDB();



    await registerCommands();

    await recoverTempVoiceRooms();
    startRulesAutoRefresh();
    await startRules2AutoRefresh();

    initializeRankCallVoiceSessions();
    syncRankCallVoiceSessionsFromVoiceStates();
    await checkpointLocalVoiceSessions();
    startRankCallAutoRefresh();
    await refreshRankCallPanel();
    await restoreAfkUsersOnReady();



    if (

      VOICE_CHANNEL_ID &&

      client.guilds.cache.size

    ) {

      const guild =

        client.guilds.cache.find(

          g =>

            g.channels.cache.has(

              VOICE_CHANNEL_ID

            )

        );



      const voice =

        guild?.channels.cache.get(

          VOICE_CHANNEL_ID

        );



      if (

        voice &&

        (

          voice.type ===

            ChannelType.GuildVoice ||

          voice.type ===

            ChannelType.GuildStageVoice

        )

      ) {

        try {

          voiceConnection =

            joinVoiceChannel({

              channelId:

                voice.id,

              guildId:

                guild.id,

              adapterCreator:

                guild.voiceAdapterCreator,

              selfDeaf: false

            });

          voiceConnection.on('error', (error) => {
            console.warn('[Voice] Erro na conexo de voz:', error?.message || error);
            try { voiceConnection?.destroy(); } catch {}
            voiceConnection = null;
          });



          voiceConnection.on(

            VoiceConnectionStatus.Disconnected,

            async () => {

              try {

                await entersState(

                  voiceConnection,

                  VoiceConnectionStatus.Signalling,

                  5000

                );

              } catch {

                voiceConnection =

                  null;

              }

            }

          );



          console.log(

            `[Voice] Conectado em ${voice.name}`

          );

        } catch (e) {

          console.warn(

            '[Voice]',

            e.message

          );

        }

      }

    }



    console.log(

      '[Servidor] Web server rodando na porta ' +

        port

    );

  }

);



client.on(

  Events.InteractionCreate,

  async interaction => {

    try {

      if (

        interaction.isChatInputCommand()

      ) {

        await handleSlashCommand(

          interaction

        );



        return;

      }




      if (
        interaction.isButton() &&
        /^rankcall_general_(prev|next)_\d+$/.test(interaction.customId)
      ) {
        try {
          const match = interaction.customId.match(
            /^rankcall_general_(prev|next)_(\d+)$/
          );

          const direction = match[1];
          const currentPage = Number(match[2]) || 0;
          const nextPage = Math.max(
            0,
            currentPage + (direction === 'next' ? 1 : -1)
          );

          const ranking = await getLiveVoiceRanking(interaction.guild);

          const generalView = buildRankCallGeneralEmbed(
            interaction.guild,
            ranking,
            nextPage,
            interaction.user.id
          );

          await interaction.update({
            embeds: [generalView.embed],
            components: generalView.components,
            allowedMentions: {
              users: generalView.userIds,
              roles: []
            }
          });
        } catch (error) {
          console.error(
            '[RankCall] Erro na paginaío do painel Geral:',
            error.message
          );
        }

        return;
      }
      if (
        interaction.isButton() &&
        interaction.customId === 'rankcall_general_id'
      ) {
        const modal = new ModalBuilder()
          .setCustomId('rankcall_general_id_modal')
          .setTitle('🆔 Consultar por ID');

        const idInput = new TextInputBuilder()
          .setCustomId('user_id')
          .setLabel('ID do usuário')
          .setPlaceholder('Ex.: 123456789012345678')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(17)
          .setMaxLength(20);

        modal.addComponents(
          new ActionRowBuilder().addComponents(idInput)
        );

        await interaction.showModal(modal);
        return;
      }
      if (
        interaction.isModalSubmit() &&
        interaction.customId === 'rankcall_general_id_modal'
      ) {
        try {
          const userId = interaction.fields.getTextInputValue('user_id').trim();

          if (!/^\d{17,20}$/.test(userId)) {
            await interaction.reply({
              content: 'L ID de usuário invlido. Informe um ID numrico vlido do Discord.',
              ephemeral: true
            });
            return;
          }

          const ranking = await getLiveVoiceRanking(interaction.guild);
          const userIndex = ranking.findIndex(row => row.userId === userId);

          if (userIndex === -1) {
            await interaction.reply({
              content: 'L Esse usuário não possui horas registradas no ranking.',
              ephemeral: true
            });
            return;
          }

          const pageSize = 10;
          const userPage = Math.floor(userIndex / pageSize);

          const generalView = buildRankCallGeneralEmbed(
            interaction.guild,
            ranking,
            userPage,
            userId
          );

          await interaction.reply({
            embeds: [generalView.embed],
            components: generalView.components,
            ephemeral: true,
            allowedMentions: {
              users: generalView.userIds,
              roles: []
            }
          });
        } catch (error) {
          console.error(
            '[RankCall] Erro ao consultar ranking por ID:',
            error.message
          );

          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
              content: 'L Não foi possível consultar esse ID agora.',
              ephemeral: true
            }).catch(() => {});
          }
        }

        return;
      }
      if (
        interaction.isButton() &&
        interaction.customId === 'rankcall_general'
      ) {
        try {
          const ranking = await getLiveVoiceRanking(interaction.guild);
          const generalView = buildRankCallGeneralEmbed(
            interaction.guild,
            ranking,
            0,
            interaction.user.id
          );

          await interaction.reply({
            embeds: [generalView.embed],
            components: generalView.components,
            ephemeral: true,
            allowedMentions: {
              users: generalView.userIds,
              roles: []
            }
          });
        } catch (error) {
          console.error('[RankCall] Erro ao abrir painel Geral:', error.message);

          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
              content: 'Não foi possível abrir o ranking geral agora.',
              ephemeral: true
            }).catch(() => {});
          }
        }

        return;
      }
      if (
        interaction.isButton() &&
        /^rankcall_(prev|next)_\d+$/.test(interaction.customId)
      ) {
        try {
          const match = interaction.customId.match(/^rankcall_(prev|next)_(\d+)$/);
          const direction = match[1];
          const currentPage = Number(match[2]) || 0;
          const nextPage = Math.max(0, currentPage + (direction === 'next' ? 1 : -1));
          await interaction.deferUpdate().catch(() => {});
          await publishRankCallPanel(interaction.guild, { page: nextPage, streakPage: rankCallConfig.streakPage || 0 });
        } catch (error) {
          console.error('[RankCall] Paginaío de horas:', error.message);
        }
        return;
      }

      if (
        interaction.isButton() &&
        /^rankstreak_(prev|next)_\d+$/.test(interaction.customId)
      ) {
        try {
          const match = interaction.customId.match(/^rankstreak_(prev|next)_(\d+)$/);
          const direction = match[1];
          const currentPage = Number(match[2]) || 0;
          const nextPage = Math.max(0, currentPage + (direction === 'next' ? 1 : -1));
          await interaction.deferUpdate().catch(() => {});
          await publishRankCallPanel(interaction.guild, { page: rankCallConfig.page || 0, streakPage: nextPage });
        } catch (error) {
          console.error('[RankCall] Paginaío de sequências:', error.message);
        }
        return;
      }

      if (
        interaction.isButton() &&
        interaction.customId.startsWith('rankconfig_')
      ) {
        await handleRankCallConfigButton(interaction);
        return;
      }

      if (

        interaction.isButton()

      ) {

        const id =

          interaction.customId;



        if (

          id ===

          'verification_start'

        ) {

          await sendVerificationCode(

            interaction

          );



          return;

        }



        if (

          id ===

          'verification_enter'

        ) {

          await showVerificationModal(

            interaction

          );



          return;

        }



        if (id === 'rules_admin_edit' || id === 'rules_admin_appearance') {
          await handleRulesButton(interaction);
          return;
        }

        if (id === 'rules2_admin_edit' || id === 'rules2_admin_appearance') {
          await handleRules2Button(interaction);
          return;
        }

        if (

          id ===

          'tempvoice_create'

        ) {

          await handleTempVoiceButton(

            interaction

          );



          return;

        }



        if (

          id ===

          'tempvoice_rename'

        ) {

          await renameTempRoom(

            interaction

          );



          return;

        }



        if (

          id ===

          'tempvoice_lock'

        ) {

          await tempVoiceControl(

            interaction,

            'lock'

          );



          return;

        }



        if (

          id ===

          'tempvoice_unlock'

        ) {

          await tempVoiceControl(

            interaction,

            'unlock'

          );



          return;

        }



        if (

          id ===

          'tempvoice_limit'

        ) {

          await tempVoiceControl(

            interaction,

            'limit'

          );



          return;

        }



        if (

          id ===

          'tempvoice_kick'

        ) {

          await tempVoiceControl(

            interaction,

            'kick'

          );



          return;

        }



        if (

          id ===

          'tempvoice_transfer'

        ) {

          await tempVoiceControl(

            interaction,

            'transfer'

          );



          return;

        }



        if (

          id ===

          'tempvoice_delete'

        ) {

          await tempVoiceControl(

            interaction,

            'delete'

          );



          return;

        }



        if (

          id.startsWith(

            'match_like:'

          )

        ) {

          await handleMatchLike(

            interaction,

            id.split(':')[1]

          );



          return;

        }



        if (

          id.startsWith(

            'match_block:'

          )

        ) {

          await handleMatchBlock(

            interaction,

            id.split(':')[1]

          );



          return;

        }

      }



      if (

        interaction.isStringSelectMenu()

      ) {

        if (interaction.customId === 'rules_appearance_select') {
          await handleRulesAppearanceSelect(interaction);
          return;
        }

        if (interaction.customId === 'rules2_appearance_select') {
          await handleRules2Appearance(interaction);
          return;
        }

        if (

          interaction.customId ===

          'tempvoice_action'

        ) {

          await handleTempVoiceActionSelect(

            interaction

          );



          return;

        }



        if (

          interaction.customId ===

          'tempvoice_panel_config'

        ) {

          await handleTempVoicePanelConfigSelect(

            interaction

          );



          return;

        }



        if (

          interaction.customId ===

          'match_category'

        ) {

          await createMatchProfile(

            interaction,

            interaction.values[0]

          );



          return;

        }



        if (

          interaction.customId.startsWith(

            'tempvoice_kick:'

          ) ||

          interaction.customId.startsWith(

            'tempvoice_transfer:'

          )

        ) {

          await handleTempVoiceSelect(

            interaction

          );



          return;

        }

      }



      if (

        interaction.isModalSubmit()

      ) {

        if (interaction.customId.startsWith('rankconfig_modal:')) {
          await handleRankCallConfigModal(interaction);
          return;
        }

        if (

          interaction.customId ===

          'verification_modal'

        ) {

          await handleVerificationModal(

            interaction

          );



          return;

        }



        if (

          interaction.customId === 'rules_edit_modal' ||

          interaction.customId.startsWith('rules_config_modal:')

        ) {

          await handleRulesModal(interaction);

          return;

        }



        if (interaction.customId === 'rules2_edit_modal' || interaction.customId.startsWith('rules2_config_modal:')) {
          await handleRules2Modal(interaction);
          return;
        }

        if (

          interaction.customId.startsWith(

            'tempvoice_panel_config:'

          )

        ) {

          await handleTempVoicePanelConfigModal(

            interaction

          );



          return;

        }



        if (

          interaction.customId.startsWith(

            'tempvoice_'

          )

        ) {

          await handleTempVoiceModalAction(

            interaction

          );



          return;

        }



        if (

          interaction.customId.startsWith(

            'match_profile:'

          )

        ) {

          await handleMatchProfileModal(

            interaction

          );



          return;

        }

      }

    } catch (e) {

      console.error(

        '[Interaction]',

        e

      );



      try {

        if (

          interaction.replied ||

          interaction.deferred

        ) {

          await interaction.followUp({

            content:

              'L Ocorreu um erro ao processar esta aío.',

            ephemeral: true

          });

        } else {

          await interaction.reply({

            content:

              'L Ocorreu um erro ao processar esta aío.',

            ephemeral: true

          });

        }

      } catch {}

    }

  }

);



client.on(

  Events.VoiceStateUpdate,

  async (

    oldState,

    newState

  ) => {

    try {

      await handleVoiceStateUpdate(

        oldState,

        newState

      );

    } catch (e) {

      console.error(

        '[VoiceState]',

        e.message

      );

    }

  }

);



async function forwardIncomingDmToLog(message) {
  if (message.guild) return false;

  try {
    if (message.author?.bot) return true;

    const logChannel = await client.channels.fetch(DM_LOG_CHANNEL_ID).catch(() => null);
    if (!logChannel?.isTextBased()) {
      console.warn(`[DM Log] Canal ${DM_LOG_CHANNEL_ID} não encontrado ou não é de texto.`);
      return true;
    }

    const content = message.content?.trim() || '*Sem texto; veja os anexos abaixo.*';
    const attachmentLines = [...message.attachments.values()].map(
      attachment => `📎 [${attachment.name || 'arquivo'}](${attachment.url})`
    );

    const description = [
      `👤 **Usuário:** ${message.author.tag || message.author.username}`,
      `🆔 **ID:** \`${message.author.id}\``,
      '',
      '💬 **Mensagem:**',
      content,
      attachmentLines.length ? `\n${attachmentLines.join('\n')}` : ''
    ].filter(Boolean).join('\n').slice(0, 4096);

    const embed = new EmbedBuilder()
      .setTitle('Nova mensagem recebida no PV')
      .setDescription(description)
      .setColor('#5865F2')
      .setTimestamp(message.createdAt || new Date());

    if (message.author?.displayAvatarURL) {
      embed.setThumbnail(message.author.displayAvatarURL({ extension: 'png', size: 128 }));
    }

    await logChannel.send({ embeds: [embed] });
    console.log(`[DM Log] Mensagem recebida de ${message.author.tag || message.author.id}.`);
  } catch (e) {
    console.error('[DM Log] Erro ao encaminhar mensagem recebida:', e);
  }

  return true;
}

client.on(

  Events.MessageCreate,

  async message => {

    try {

      if (!message.guild) {
        await forwardIncomingDmToLog(message);
        return;
      }

      if (message.author.bot) {
        return;
      }


      if (await handleAfkPrefixCommand(message)) {
        return;
      }

      const afkMention = findAfkMention(message);
      if (afkMention) {
        await warnAboutAfkMention(message);
        return;
      }


      if (
        message.content?.trim().toLowerCase() === '!rankcall' ||
        /^!rank(?:recreate|reset|add|remove|set)(?:\s|$)/i.test(message.content?.trim() || '') ||
        /^!rankresetall(?:\s|$)/i.test(message.content?.trim() || '') ||
        message.content?.trim().toLowerCase() === '!rankconfig'
      ) {
        await handleRankCallPrefixCommand(message);
        return;
      }

      const prefixCommand = message.content?.trim().match(/^!(\S+)/)?.[1]?.toLowerCase();
      if (prefixCommand === 'help') {
        await handleHelpPrefixCommand(message);
        return;
      }
      if (prefixCommand === 'mute' || prefixCommand === 'ban' || prefixCommand === 'kick') {
        await handleModerationPrefixCommand(message, prefixCommand);
        return;
      }



      if (

        await handleBlockedWords(

          message

        )

      ) {

        return;

      }



      await updateMessageActivity(

        message

      );



      if (

        await handleSpam(

          message

        )

      ) {

        return;

      }



      await detectAttention(

        message

      );



      const content =

        message.content.trim();



      if (

        content ===

          '!ping'

      ) {

        await message.reply(

          `Y" Pong! ${client.ws.ping}ms`

        );



        return;

      }



      if (

        content ===

          '!oi'

      ) {

        await message.reply(

          `Y'< Ol, ${message.author}!`

        );



        return;

      }



      if (

        content ===

          '!regras2'

      ) {
        await refreshRules2Panel(message.guild);
        await message.reply('. Painel de regras 2 publicado/atualizado neste canal.');
        return;
      }



      if (

        content ===

          '!priv'

      ) {

        await sendTempVoicePanel(

          message.channel

        );



        return;

      }




      if (

        content.startsWith(

          '!horascall'

        ) ||

        content.startsWith(

          '!call'

        )

      ) {
        const targetToken = content.split(/\s+/)[1];
        const target = targetToken
          ? await resolvePrefixUser(message, targetToken)
          : message.author;

        if (!target) {
          await message.reply('⚠️ Não encontrei esse usuário. Informe uma menção ou um ID válido.');
          return;
        }



        await showUserCallHoursFromMessage(

          message,

          target.id

        );



        return;

      }



      if (

        content.startsWith(

          '!entrar'

        )

      ) {

        if (

          message.member?.voice

            ?.channelId

        ) {

          const channel =

            message.member.voice

              .channel;



          try {

            if (

              voiceConnection

            ) {

              voiceConnection.destroy();

            }



            voiceConnection =

              joinVoiceChannel({

                channelId:

                  channel.id,

                guildId:

                  message.guild.id,

                adapterCreator:

                  message.guild

                    .voiceAdapterCreator,

                selfDeaf: false

              });

            voiceConnection.on('error', (error) => {
              console.warn('[Voice] Erro na conexo de voz:', error?.message || error);
              try { voiceConnection?.destroy(); } catch {}
              voiceConnection = null;
            });



            await message.reply(

              `=
 Entrei em **${channel.name}**.`

            );

          } catch (e) {

            await message.reply(

              `L Erro ao entrar na call: ${e.message}`

            );

          }

        } else {

          await message.reply(

            'L Entre em um canal de voz primeiro.'

          );

        }



        return;

      }



      if (

        content ===

        '!sair'

      ) {

        if (

          voiceConnection

        ) {

          voiceConnection.destroy();

          voiceConnection =

            null;



          await message.reply(

            '👋 Saí da call.'

          );

        }



        return;

      }
      if (/^!dm(?:\s|$)/i.test(content)) {
        if (!global.__dmHandledMessages) {
          global.__dmHandledMessages = new Set();
        }

        if (message?.id && global.__dmHandledMessages.has(message.id)) {
          return;
        }

        if (message?.id) {
          global.__dmHandledMessages.add(message.id);

          setTimeout(() => {
            global.__dmHandledMessages.delete(message.id);
          }, 60000);
        }

        if (dmCommand) {
          const dmArgs = content
            .replace(/^!dm\s*/i, '')
            .trim()
            .split(/\s+/)
            .filter(Boolean);

          await dmCommand.execute(
            message,
            dmArgs,
            client
          );
        } else {
          await message.delete().catch(() => {});
          await message.author.send('❌ O comando de DM não está disponível no momento.').catch(error => {
            console.warn('[DM] Não foi possível enviar uma resposta privada:', error.message);
          });
        }

        return;
      }



      if (

        content.startsWith(

          '!metch'

        ) ||

        content.startsWith(

          '!match'

        )

      ) {

        if (

          !(await requirePermission(

            message.member,

            'match.manage'

          ))

        ) {

          await message.reply(

            'L Você não possui `match.manage`.'

          );



          return;

        }



        await sendMatchPanel(

          message.channel

        );



        return;

      }



      if (

        content.startsWith(

          '!nuke'

        )

      ) {

        if (

          !isAdmin(

            message.member

          )

        ) {

          await message.reply(

            'L Você precisa ser administrador.'

          );



          return;

        }



        const cloned =

          await message.channel.clone();



        await message.channel.delete();



        await cloned.send(

          '✅ Canal recriado com sucesso.'

        );



        return;

      }



      if (

        content.startsWith(

          '!clear'

        )

      ) {

        if (

          !(await requirePermission(

            message.member,

            'moderation.clear'

          ))

        ) {

          await message.reply(

            'L Você não possui `moderation.clear`.'

          );



          return;

        }



        const amount =

          Number(

            content

              .split(/\s+/)[1]

          ) || 10;



        const deleted =

          await message.channel

            .bulkDelete(

              Math.min(

                Math.max(

                  amount,

                  1

                ),

                100

              ),

              true

            );



        const response =

          await message.channel.send(

            `= ${deleted.size} mensagens apagadas.`

          );



        setTimeout(

          () =>

            response

              .delete()

              .catch(() => {}),

          3000

        );



        return;

      }



      if (

        content.startsWith(

          '!ban '

        )

      ) {

        if (

          !(await requirePermission(

            message.member,

            'moderation.ban'

          ))

        ) {

          await message.reply(

            'L Você não possui `moderation.ban`.'

          );



          return;

        }



        const user =

          message.mentions.users.first();



        if (!user) {

          await message.reply(

            'L Mencione um usuário.'

          );



          return;

        }



        const member =

          await message.guild.members

            .fetch(user.id)

            .catch(() => null);



        if (!member) {

          await message.reply(

            '⚠️ Usuário não encontrado.'

          );



          return;

        }



        await member.ban({

          reason:

            content

              .replace(

                /^!ban\s+<@!?\d+>\s*/i,

                ''

              ) ||

            'Sem motivo'

        });



        await message.reply(

          `= ${user.tag} foi banido.`

        );



        return;

      }



      if (

        content.startsWith(

          '!kick '

        )

      ) {

        if (

          !(await requirePermission(

            message.member,

            'moderation.kick'

          ))

        ) {

          await message.reply(

            'L Você não possui `moderation.kick`.'

          );



          return;

        }



        const user =

          message.mentions.users.first();



        if (!user) {

          await message.reply(

            'L Mencione um usuário.'

          );



          return;

        }



        const member =

          await message.guild.members

            .fetch(user.id)

            .catch(() => null);



        if (!member) {

          await message.reply(

            '⚠️ Usuário não encontrado.'

          );



          return;

        }



        await member.kick(

          'Comando !kick'

        );



        await message.reply(

          `✅ ${user.tag} foi expulso.`

        );



        return;

      }



      const mentionedBot =

        message.mentions.has(

          client.user

        );



      const repliedToBot =

        message.reference

          ?.messageId

          ? await message.channel.messages

              .fetch(

                message.reference

                  .messageId

              )

              .then(

                m =>

                  m.author.id ===

                  client.user.id

              )

              .catch(

                () => false

              )

          : false;



      if (

        (mentionedBot ||

          repliedToBot) &&

        hasOpenAIKey()

      ) {

        if (

          processedAiMessages.has(

            message.id

          )

        ) {

          return;

        }



        processedAiMessages.add(

          message.id

        );



        if (

          processedAiMessages.size >

          500

        ) {

          const first =

            processedAiMessages

              .values()

              .next()

              .value;



          if (first) {

            processedAiMessages.delete(

              first

            );

          }

        }



        const question =

          message.content

            .replace(

              /<@!?\d+>/g,

              ''

            )

            .trim();



        if (!question) {

          await message.reply(

            '🤖 Como posso ajudar?'

          );



          return;

        }



        try {

          await message.channel.sendTyping();



          const answer =

            await askAIWithRules(

              message.guild.id,

              question

            );



          await message.reply(

            answer.slice(

              0,

              1900

            )

          );

        } catch (e) {

          await message.reply(

            `L Erro na IA: ${e.message}`

          );

        }

      }

    } catch (e) {

      console.error(

        '[MessageCreate]',

        e

      );

    }

  }

);



async function showUserCallHoursFromMessage(

  message,

  userId

) {

  const result =

    await q(

      `

      SELECT voice_seconds

      FROM bot_users

      WHERE

        guild_id = $1

        AND user_id = $2

      `,

      [

        message.guild.id,

        userId

      ]

    );



  const seconds =

    Number(

      result?.rows?.[0]

        ?.voice_seconds || 0

    );



  await message.reply(

    `=
 <@${userId}> possui **${formatHours(seconds)} horas** em call.`

  );

}



const server = http.createServer(

  async (req, res) => {

    if (

      req.url === '/health'

    ) {

      res.writeHead(200, {

        'Content-Type':

          'application/json'

      });



      res.end(

        JSON.stringify({

          online:

            client.isReady(),

          bot:

            client.user?.tag ||

            null,

          database:

            dbReady,

          uptime:

            process.uptime()

        })

      );



      return;

    }



    if (

      req.url === '/stats'

    ) {

      if (

        DASHBOARD_KEY &&

        req.headers.authorization !==

          `Bearer ${DASHBOARD_KEY}`

      ) {

        res.writeHead(401);



        res.end(

          'Unauthorized'

        );



        return;

      }



      const guild =

        client.guilds.cache.first();



      if (!guild) {

        res.writeHead(503);



        res.end(

          JSON.stringify({

            error:

              'Bot não está em nenhum servidor.'

          })

        );



        return;

      }



      const stats =

        await getServerStats(

          guild

        );



      res.writeHead(200, {

        'Content-Type':

          'application/json'

      });



      res.end(

        JSON.stringify(

          stats

        )

      );



      return;

    }



    res.writeHead(200, {

      'Content-Type':

        'text/plain; charset=utf-8'

    });



    res.end(

      'Bot Discord online.'

    );

  }

);



server.listen(

  port,

  '0.0.0.0',

  () => {

    console.log(

      `[Servidor] Web server rodando na porta ${port}`

    );

  }

);



process.on(

  'unhandledRejection',

  error => {

    console.error(

      '[unhandledRejection]',

      error

    );

  }

);



process.on(

  'uncaughtException',

  error => {

    console.error(

      '[uncaughtException]',

      error

    );

  }

);



let persistenceShutdownStarted = false;

async function persistRankCallStateOnShutdown() {
  if (persistenceShutdownStarted) return;
  persistenceShutdownStarted = true;
  try {
    await checkpointLocalVoiceSessions();
  } catch (error) {
    console.error('[RankCall] Não foi possível concluir o checkpoint ao encerrar:', error.message);
  }
  saveVoiceHoursLocal();
  saveVoiceSessionsLocal();
  saveRankCallStreaks();
}

process.on('SIGINT', async () => {
  try {
    await persistRankCallStateOnShutdown();
  } finally {
    process.exit(0);
  }
});

process.on('SIGTERM', async () => {
  try {
    await persistRankCallStateOnShutdown();
  } finally {
    process.exit(0);
  }
});

client.login(token);