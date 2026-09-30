require('dotenv').config();

// MantÃ©m o processo vivo em rejeiÃ§Ãµes assÃ­ncronas conhecidas do sistema de voz.
process.on('unhandledRejection', (reason) => {
  const message = String(reason?.message || reason || '');
  if (message.includes('Shard 0 not found') || message.includes('Cannot perform IP discovery - socket closed')) {
    console.warn(`[Voice] RejeiÃ§Ã£o assÃ­ncrona de voz ignorada: ${message}`);
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

    '[DB] Pacote pg nÃ£o instalado. Instale com: npm i pg'

  );

}



const token = process.env.DISCORD_TOKEN;



if (!token) {

  console.error(

    'ERRO CRÃTICO: Defina DISCORD_TOKEN no .env.'

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
  title: 'ðŸ“œ Regras do Servidor',
  description: 'Leia e siga as regras do servidor para manter a comunidade organizada e segura.',
  color: '#5865F2',
  banner: '',
  icon: '',
  footer: 'Leia com atenÃ§Ã£o antes de participar.',
  rulesText: '1ï¸âƒ£ Respeite todos os membros.\n\n2ï¸âƒ£ NÃ£o faÃ§a spam ou flood.\n\n3ï¸âƒ£ NÃ£o divulgue servidores, links ou serviÃ§os sem autorizaÃ§Ã£o.\n\n4ï¸âƒ£ Use cada canal para sua finalidade.\n\n5ï¸âƒ£ Siga as regras do Discord e as orientaÃ§Ãµes da equipe.',
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
  console.warn('[Rules] Erro ao carregar configuraÃ§Ã£o:', e.message);
}

function saveRulesPanelConfig() {
  try {
    fs.writeFileSync(RULES_CONFIG_FILE, JSON.stringify(rulesPanelConfig, null, 2), 'utf8');
  } catch (e) {
    console.error('[Rules] Erro ao salvar configuraÃ§Ã£o:', e.message);
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
    title: rulesPanelConfig.title || 'ðŸ“œ Regras do Servidor',
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
          .setEmoji('ðŸ“œ')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('rules_admin_appearance')
          .setLabel('Alterar aparÃªncia')
          .setEmoji('ðŸŽ¨')
          .setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

async function refreshRulesPanel(guild) {
  if (!guild) return false;
  const channel = await guild.channels.fetch(RULES_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) {
    console.warn(`[Rules] Canal ${RULES_CHANNEL_ID} nÃ£o encontrado ou nÃ£o Ã© de texto.`);
    return false;
  }

  const me = channel.guild.members.me || await channel.guild.members.fetchMe().catch(() => null);
  const permissions = me ? channel.permissionsFor(me) : null;
  if (permissions && !permissions.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.EmbedLinks])) {
    const missing = [
      [PermissionFlagsBits.ViewChannel, 'Ver canal'],
      [PermissionFlagsBits.SendMessages, 'Enviar mensagens'],
      [PermissionFlagsBits.ReadMessageHistory, 'Ver histÃ³rico de mensagens'],
      [PermissionFlagsBits.ManageMessages, 'Gerenciar mensagens'],
      [PermissionFlagsBits.EmbedLinks, 'Incorporar links']
    ].filter(([flag]) => !permissions.has(flag)).map(([, name]) => name);
    throw Object.assign(new Error(`PermissÃµes ausentes: ${missing.join(', ')}`), { code: 50013, missing });
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
    return interaction.reply({ content: 'âŒ Apenas administradores ou membros autorizados podem configurar as regras.', flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'rules_admin_edit') {
    const modal = new ModalBuilder().setCustomId('rules_edit_modal').setTitle('ðŸ“œ Editar regras');

    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('TÃ­tulo')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(256)
      .setValue(String(rulesPanelConfig.title || '').slice(0, 256));

    const descriptionInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('DescriÃ§Ã£o')
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
      .setPlaceholder('ðŸŽ¨ Escolha o que deseja alterar')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('TÃ­tulo').setDescription('Altera o tÃ­tulo do embed.').setEmoji('âœï¸').setValue('title'),
        new StringSelectMenuOptionBuilder().setLabel('DescriÃ§Ã£o').setDescription('Altera a descriÃ§Ã£o do embed.').setEmoji('ðŸ“').setValue('description'),
        new StringSelectMenuOptionBuilder().setLabel('Cor').setDescription('Altera a cor hexadecimal.').setEmoji('ðŸŽ¨').setValue('color'),
        new StringSelectMenuOptionBuilder().setLabel('Banner').setDescription('Altera a imagem principal.').setEmoji('ðŸ–¼ï¸').setValue('banner'),
        new StringSelectMenuOptionBuilder().setLabel('Ãcone / Thumbnail').setDescription('Altera a thumbnail.').setEmoji('ðŸ–¼ï¸').setValue('icon'),
        new StringSelectMenuOptionBuilder().setLabel('RodapÃ©').setDescription('Altera o texto do rodapÃ©.').setEmoji('ðŸ“Œ').setValue('footer')
      );
    return interaction.reply({ content: 'ðŸŽ¨ Escolha a aparÃªncia que deseja alterar:', components: [new ActionRowBuilder().addComponents(menu)], flags: MessageFlags.Ephemeral });
  }
}

async function handleRulesAppearanceSelect(interaction) {
  if (!isRulesPanelAdmin(interaction.member)) return interaction.reply({ content: 'âŒ VocÃª nÃ£o possui permissÃ£o para configurar as regras.', flags: MessageFlags.Ephemeral });
  const option = interaction.values[0];
  const labels = { title:'TÃ­tulo', description:'DescriÃ§Ã£o', color:'Cor hexadecimal', banner:'URL do banner', icon:'URL do Ã­cone/thumbnail', footer:'RodapÃ©' };
  const placeholders = { title:'ðŸ“œ Regras do Servidor', description:'Leia as regras...', color:'#5865F2', banner:'https://...', icon:'https://...', footer:'Leia com atenÃ§Ã£o.' };
  const modal = new ModalBuilder().setCustomId(`rules_config_modal:${option}`).setTitle(`ðŸŽ¨ ${labels[option]}`);
  const input = new TextInputBuilder().setCustomId('value').setLabel(labels[option]).setPlaceholder(placeholders[option]).setRequired(false).setStyle(option === 'description' || option === 'footer' ? TextInputStyle.Paragraph : TextInputStyle.Short).setMaxLength(1000);
  const current = String(rulesPanelConfig[option] || '');
  if (current) input.setValue(current.slice(0, 1000));
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

async function handleRulesModal(interaction) {
  if (!isRulesPanelAdmin(interaction.member)) {
    return interaction.reply({ content: 'âŒ VocÃª nÃ£o possui permissÃ£o para configurar as regras.', flags: MessageFlags.Ephemeral });
  }

  // Toda atualizaÃ§Ã£o que pode apagar/enviar a mensagem precisa reconhecer a interaÃ§Ã£o antes.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (interaction.customId === 'rules_edit_modal') {
      const title = interaction.fields.getTextInputValue('title').trim();
      const description = interaction.fields.getTextInputValue('description').trim();
      const rulesText = interaction.fields.getTextInputValue('rulesText').trim();

      rulesPanelConfig.title = title || 'ðŸ“œ Regras do Servidor';
      rulesPanelConfig.description = description;
      rulesPanelConfig.rulesText = rulesText;
      saveRulesPanelConfig();
      await refreshRulesPanel(interaction.guild);
      return interaction.editReply({ content: 'âœ… TÃ­tulo, descriÃ§Ã£o e texto das regras atualizados.' });
    }

    const option = interaction.customId.split(':')[1];
    const value = interaction.fields.getTextInputValue('value').trim();
    if (option === 'color' && value && !/^#[0-9A-Fa-f]{6}$/.test(value)) {
      return interaction.editReply({ content: 'âŒ A cor deve estar no formato `#5865F2`.' });
    }
    if ((option === 'banner' || option === 'icon') && value && !/^https?:\/\//i.test(value)) {
      return interaction.editReply({ content: 'âŒ Informe uma URL comeÃ§ando com `http://` ou `https://`.' });
    }

    rulesPanelConfig[option] = value;
    saveRulesPanelConfig();
    await refreshRulesPanel(interaction.guild);
    return interaction.editReply({ content: `âœ… ${option} atualizado e o painel foi renovado.` });
  } catch (error) {
    console.error('[Rules] Erro ao atualizar configuraÃ§Ã£o:', error);
    return interaction.editReply({ content: error?.code === 50013
      ? 'âŒ O bot nÃ£o tem permissÃ£o para apagar/enviar a mensagem no canal de regras. DÃª **Gerenciar mensagens**, **Enviar mensagens**, **Ver histÃ³rico de mensagens** e **Incorporar links** no canal.'
      : 'âŒ NÃ£o foi possÃ­vel atualizar as regras. Verifique as permissÃµes do bot e tente novamente.' });
  }
}




// ==================== REGRAS 2 ====================
const RULES2_CHANNEL_ID = '1553953899180728372';
const RULES2_CONFIG_FILE = path.join(__dirname, 'rules-panel-config-2.json');

let rules2Config = {
  title: 'ðŸ“œ Regras do Servidor',
  description: 'Leia e siga as regras do servidor para manter a comunidade organizada e segura.',
  color: '#5865F2',
  banner: '',
  icon: '',
  footer: 'Leia com atenÃ§Ã£o antes de participar.',
  rulesText: '1ï¸âƒ£ Respeite todos os membros.\n\n2ï¸âƒ£ NÃ£o faÃ§a spam ou flood.\n\n3ï¸âƒ£ NÃ£o divulgue servidores, links ou serviÃ§os sem autorizaÃ§Ã£o.\n\n4ï¸âƒ£ Use cada canal para sua finalidade.\n\n5ï¸âƒ£ Siga as regras do Discord e as orientaÃ§Ãµes da equipe.',
  messageId: ''
};

try {
  if (fs.existsSync(RULES2_CONFIG_FILE)) {
    rules2Config = { ...rules2Config, ...JSON.parse(fs.readFileSync(RULES2_CONFIG_FILE, 'utf8')) };
  }
} catch (e) {
  console.warn('[Rules2] Erro ao carregar configuraÃ§Ã£o:', e.message);
}

function saveRules2Config() {
  try { fs.writeFileSync(RULES2_CONFIG_FILE, JSON.stringify(rules2Config, null, 2), 'utf8'); }
  catch (e) { console.error('[Rules2] Erro ao salvar configuraÃ§Ã£o:', e.message); }
}

function buildRules2Payload() {
  const embed = createEmbed({
    title: rules2Config.title || 'ðŸ“œ Regras do Servidor',
    description: `${rules2Config.description || ''}\n\n${rules2Config.rulesText || 'Nenhuma regra configurada.'}`.slice(0, 4096),
    color: rules2Config.color || '#5865F2',
    footer: rules2Config.footer || undefined
  });
  if (rules2Config.banner) embed.setImage(rules2Config.banner);
  if (rules2Config.icon) embed.setThumbnail(rules2Config.icon);
  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('rules2_admin_edit').setLabel('Editar regras').setEmoji('ðŸ“œ').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('rules2_admin_appearance').setLabel('Alterar aparÃªncia').setEmoji('ðŸŽ¨').setStyle(ButtonStyle.Secondary)
    )]
  };
}

async function refreshRules2Panel(guild) {
  if (!guild) return false;
  const channel = await guild.channels.fetch(RULES2_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) throw new Error(`Canal ${RULES2_CHANNEL_ID} nÃ£o encontrado ou nÃ£o Ã© de texto.`);
  const me = channel.guild.members.me || await channel.guild.members.fetchMe().catch(() => null);
  const permissions = me ? channel.permissionsFor(me) : null;
  if (permissions && !permissions.has([
    PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.EmbedLinks
  ])) throw Object.assign(new Error('PermissÃµes insuficientes no canal de regras 2.'), {code:50013});
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
    return interaction.reply({content:'âŒ Apenas administradores ou membros autorizados podem configurar as regras.', flags:MessageFlags.Ephemeral});

  if (interaction.customId === 'rules2_admin_edit') {
    const modal = new ModalBuilder().setCustomId('rules2_edit_modal').setTitle('ðŸ“œ Editar regras 2');
    const title = new TextInputBuilder().setCustomId('title').setLabel('TÃ­tulo').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256).setValue(String(rules2Config.title||'').slice(0,256));
    const desc = new TextInputBuilder().setCustomId('description').setLabel('DescriÃ§Ã£o').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000).setValue(String(rules2Config.description||'').slice(0,1000));
    const text = new TextInputBuilder().setCustomId('rulesText').setLabel('Texto das regras').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(3800).setValue(String(rules2Config.rulesText||'').slice(0,3800));
    modal.addComponents(new ActionRowBuilder().addComponents(title),new ActionRowBuilder().addComponents(desc),new ActionRowBuilder().addComponents(text));
    return interaction.showModal(modal);
  }

  const menu = new StringSelectMenuBuilder().setCustomId('rules2_appearance_select').setPlaceholder('ðŸŽ¨ Escolha o que deseja alterar').addOptions(
    new StringSelectMenuOptionBuilder().setLabel('TÃ­tulo').setDescription('Altera o tÃ­tulo do embed.').setEmoji('âœï¸').setValue('title'),
    new StringSelectMenuOptionBuilder().setLabel('DescriÃ§Ã£o').setDescription('Altera a descriÃ§Ã£o do embed.').setEmoji('ðŸ“').setValue('description'),
    new StringSelectMenuOptionBuilder().setLabel('Cor').setDescription('Altera a cor hexadecimal.').setEmoji('ðŸŽ¨').setValue('color'),
    new StringSelectMenuOptionBuilder().setLabel('Banner').setDescription('Altera a imagem principal.').setEmoji('ðŸ–¼ï¸').setValue('banner'),
    new StringSelectMenuOptionBuilder().setLabel('Ãcone / Thumbnail').setDescription('Altera a thumbnail.').setEmoji('ðŸ–¼ï¸').setValue('icon'),
    new StringSelectMenuOptionBuilder().setLabel('RodapÃ©').setDescription('Altera o texto do rodapÃ©.').setEmoji('ðŸ“Œ').setValue('footer')
  );
  return interaction.reply({content:'ðŸŽ¨ Escolha a aparÃªncia que deseja alterar:',components:[new ActionRowBuilder().addComponents(menu)],flags:MessageFlags.Ephemeral});
}

async function handleRules2Appearance(interaction) {
  if (!isRulesPanelAdmin(interaction.member)) return interaction.reply({content:'âŒ VocÃª nÃ£o possui permissÃ£o.',flags:MessageFlags.Ephemeral});
  const option=interaction.values[0];
  const labels={title:'TÃ­tulo',description:'DescriÃ§Ã£o',color:'Cor hexadecimal',banner:'URL do banner',icon:'URL do Ã­cone/thumbnail',footer:'RodapÃ©'};
  const placeholders={title:'ðŸ“œ Regras do Servidor',description:'Leia as regras...',color:'#5865F2',banner:'https://...',icon:'https://...',footer:'Leia com atenÃ§Ã£o.'};
  const modal=new ModalBuilder().setCustomId(`rules2_config_modal:${option}`).setTitle(`ðŸŽ¨ ${labels[option]}`);
  const input=new TextInputBuilder().setCustomId('value').setLabel(labels[option]).setPlaceholder(placeholders[option]).setRequired(false).setStyle(option==='description'||option==='footer'?TextInputStyle.Paragraph:TextInputStyle.Short).setMaxLength(1000);
  const current=String(rules2Config[option]||''); if(current) input.setValue(current.slice(0,1000));
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

async function handleRules2Modal(interaction) {
  if (!isRulesPanelAdmin(interaction.member)) return interaction.reply({content:'âŒ VocÃª nÃ£o possui permissÃ£o.',flags:MessageFlags.Ephemeral});
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  try {
    if (interaction.customId==='rules2_edit_modal') {
      rules2Config.title=interaction.fields.getTextInputValue('title').trim()||'ðŸ“œ Regras do Servidor';
      rules2Config.description=interaction.fields.getTextInputValue('description').trim();
      rules2Config.rulesText=interaction.fields.getTextInputValue('rulesText').trim();
      saveRules2Config(); await refreshRules2Panel(interaction.guild);
      return interaction.editReply({content:'âœ… Regras 2 atualizadas.'});
    }
    const option=interaction.customId.split(':')[1];
    const value=interaction.fields.getTextInputValue('value').trim();
    if(option==='color' && value && !/^#[0-9A-Fa-f]{6}$/.test(value)) return interaction.editReply({content:'âŒ A cor deve estar no formato `#5865F2`.'});
    if((option==='banner'||option==='icon') && value && !/^https?:\/\//i.test(value)) return interaction.editReply({content:'âŒ Informe uma URL comeÃ§ando com `http://` ou `https://`.'});
    rules2Config[option]=value; saveRules2Config(); await refreshRules2Panel(interaction.guild);
    return interaction.editReply({content:`âœ… ${option} atualizado no painel 2.`});
  } catch(e) {
    console.error('[Rules2] Erro:',e);
    return interaction.editReply({content:'âŒ NÃ£o foi possÃ­vel atualizar o painel 2. Verifique as permissÃµes do bot no canal.'});
  }
}
// ==================== FIM REGRAS 2 ====================

const STAFF_ALERT_CHANNEL_ID =

  process.env.STAFF_ALERT_CHANNEL_ID || '';



const LOG_CHANNEL_ID =

  process.env.LOG_CHANNEL_ID || '';



const DASHBOARD_KEY =

  process.env.DASHBOARD_KEY || '';



const port =

  Number(process.env.PORT) || 3000;



const MATCH_CONFIG_FILE =

  path.join(__dirname, 'match-config.json');



let matchConfig = {

  title: 'ðŸ’˜ Central de Match & ConexÃµes',

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

    '[Match] Erro ao carregar configuraÃ§Ã£o:',

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
  title: 'ðŸ”Š Salas de Voz TemporÃ¡rias',
  description:
    'Clique no menu abaixo para criar e administrar sua sala de voz.\n\nAs salas vazias sÃ£o excluÃ­das automaticamente conforme o tempo configurado.',
  color: '#5865F2',
  banner: '',
  icon: '',
  footer: 'Call Priv â€¢ ConfiguraÃ§Ã£o dinÃ¢mica',
  defaultName: 'ðŸ”Šãƒ»{user}',
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

    '[TempVoice] Erro ao carregar configuraÃ§Ã£o:',

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

      '[TempVoice] Erro ao salvar configuraÃ§Ã£o:',

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
    transfer: 'Escolhe outro membro como dono da sala.', delete: 'Exclui imediatamente sua sala temporÃ¡ria.'
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
    title: 'ðŸ”Š Salas de Voz TemporÃ¡rias',
    description: 'Clique no menu abaixo para criar e administrar sua sala de voz.\n\nAs salas vazias sÃ£o excluÃ­das automaticamente conforme o tempo configurado.',
    color: '#5865F2', banner: '', icon: '', footer: 'Call Priv â€¢ ConfiguraÃ§Ã£o dinÃ¢mica',
    defaultName: 'ðŸ”Šãƒ»{user}', categoryId: TEMP_VOICE_CATEGORY_ID || '',
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

    '[Formulario] MÃ³dulo nÃ£o carregado:',

    e.message

  );

}



let dmCommand;



try {

  dmCommand = require('./commands/dm');

} catch (e) {

  console.warn(

    '[DM] MÃ³dulo nÃ£o carregado:',

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
  title: 'ðŸ† Ranking de Horas em Call',
  description: 'Acompanhe em tempo real quem mais permanece em call.',
  color: '#FEE75C',
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
    console.warn('[RankCall] Erro ao carregar configuraÃ§Ã£o:', e.message);
  }
}

function saveRankCallConfig() {
  try {
    fs.writeFileSync(RANK_CALL_CONFIG_FILE, JSON.stringify(rankCallConfig, null, 2), 'utf8');
  } catch (e) {
    console.warn('[RankCall] Erro ao salvar configuraÃ§Ã£o:', e.message);
  }
}

function loadVoiceHoursLocal() {
  try {
    if (!fs.existsSync(VOICE_HOURS_FILE)) return;
    const data = JSON.parse(fs.readFileSync(VOICE_HOURS_FILE, 'utf8'));
    for (const [key, value] of Object.entries(data || {})) {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds > 0) {
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
  } catch (e) {
    console.warn('[RankCall] Erro ao salvar horas locais:', e.message);
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
    console.warn('[RankCall] Erro ao carregar sessÃµes ativas:', e.message);
  }
}

function saveVoiceSessionsLocal() {
  try {
    fs.writeFileSync(VOICE_LIVE_SESSIONS_FILE, JSON.stringify(Object.fromEntries(voiceSessions), null, 2), 'utf8');
  } catch (e) {
    console.warn('[RankCall] Erro ao salvar sessÃµes ativas:', e.message);
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
    if (afkUsers.size) console.log(`[AFK] ${afkUsers.size} usuÃ¡rio(s) AFK carregado(s).`);
  } catch (e) {
    console.warn('[AFK] Erro ao carregar usuÃ¡rios AFK:', e.message);
  }
}

function saveAfkUsers() {
  try {
    fs.writeFileSync(AFK_USERS_FILE, JSON.stringify(Object.fromEntries(afkUsers), null, 2), 'utf8');
  } catch (e) {
    console.warn('[AFK] Erro ao salvar usuÃ¡rios AFK:', e.message);
  }
}

function getAfkKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function getAfkRecord(guildId, userId) {
  return afkUsers.get(getAfkKey(guildId, userId)) || null;
}

function formatAfkNickname(originalNickname, username) {
  const original = String(originalNickname || username || 'UsuÃ¡rio').replace(/^AFK\s*\|\s*/i, '').trim();
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
  const warning = await message.channel.send('o cego nÃ£o ta vendo o nome da pessoa nÃ£o? o nome ta afk burro,').catch(() => null);
  setTimeout(() => {
    message.delete().catch(() => {});
    warning?.delete().catch(() => {});
  }, AFK_WARNING_DELETE_MS);
}

async function handleAfkPrefixCommand(message) {
  const raw = String(message.content || '').trim();
  const match = raw.match(/^!(afk|unafk)(?:\s|$)/i);
  if (!match) return false;

  const command = match[1].toLowerCase();
  await message.delete().catch(() => {});
  if (!message.guild) return true;

  const guild = message.guild;
  const member = message.member || await guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return true;
  const key = getAfkKey(guild.id, member.id);

  if (command === 'afk') {
    if (afkUsers.has(key)) {
      await message.channel.send(`<a:luacancun2:1554021665934155796> <@${member.id}> jÃ¡ estÃ¡ no mundo AFK e nÃ£o pode ser perturbado.`).catch(() => {});
      return true;
    }

    const originalNickname = member.nickname ?? null;
    afkUsers.set(key, {
      guildId: guild.id,
      userId: member.id,
      originalNickname,
      activatedAt: Date.now()
    });
    saveAfkUsers();

    await member.setNickname(
      formatAfkNickname(originalNickname, member.user.username),
      'Entrou no modo AFK'
    ).catch(error => {
      console.warn('[AFK] NÃ£o foi possÃ­vel alterar o apelido:', error.message);
    });

    const afkChannel = guild.channels.cache.get(AFK_VOICE_CHANNEL_ID)
      || await guild.channels.fetch(AFK_VOICE_CHANNEL_ID).catch(() => null);

    const currentVoiceChannelId = member.voice?.channelId || null;

    if (currentVoiceChannelId && currentVoiceChannelId !== AFK_VOICE_CHANNEL_ID && afkChannel?.isVoiceBased?.()) {
      const confirmId = `${AFK_MOVE_CONFIRM_PREFIX}${guild.id}:${member.id}`;
      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${confirmId}:yes`)
          .setLabel('Sim')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`${confirmId}:no`)
          .setLabel('NÃ£o')
          .setStyle(ButtonStyle.Danger)
      );

      // A confirmaÃ§Ã£o precisa ser privada para quem executou !afk.
      // Prefix commands nÃ£o suportam mensagens ephemeral, entÃ£o enviamos a pergunta por DM.
      await message.channel.send(
        `<a:luacancun2:1554021665934155796> <@${member.id}> entrou no mundo AFK e nÃ£o pode ser perturbado.`
      ).catch(() => {});

      const prompt = await member.user.send({
        content: `<a:luacancun2:1554021665934155796> **@${member.displayName || member.user.username}** entrou no mundo AFK e nÃ£o pode ser perturbado.\n\nðŸ”Š VocÃª quer ser movido para **${afkChannel.name}**?`,
        components: [buttons]
      }).catch(error => {
        console.warn('[AFK] NÃ£o foi possÃ­vel enviar a confirmaÃ§Ã£o por DM:', error.message);
        return null;
      });

      if (prompt) {
        const timer = setTimeout(async () => {
          const pending = pendingAfkMoveConfirmations.get(confirmId);
          if (!pending || pending.messageId !== prompt.id) return;
          pendingAfkMoveConfirmations.delete(confirmId);
          const disabled = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`${confirmId}:yes`)
              .setLabel('Sim')
              .setStyle(ButtonStyle.Success)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId(`${confirmId}:no`)
              .setLabel('NÃ£o')
              .setStyle(ButtonStyle.Danger)
              .setDisabled(true)
          );
          await prompt.edit({
            content: `<a:luacancun2:1554021665934155796> VocÃª entrou no mundo AFK e nÃ£o pode ser perturbado.\n\nâ±ï¸ O tempo para escolher terminou. VocÃª permaneceu na call atual.`,
            components: [disabled]
          }).catch(() => {});
        }, AFK_MOVE_CONFIRM_TIMEOUT_MS);

        pendingAfkMoveConfirmations.set(confirmId, {
          guildId: guild.id,
          userId: member.id,
          messageId: prompt.id,
          timer
        });
      }
    } else {
      await message.channel.send(`<a:luacancun2:1554021665934155796> <@${member.id}> entrou no mundo AFK e nÃ£o pode ser perturbado.`).catch(() => {});
    }

    return true;
  }

  const record = afkUsers.get(key);
  if (!record) {
    await message.channel.send(`âœ… <@${member.id}>, vocÃª nÃ£o estÃ¡ no modo AFK.`).catch(() => {});
    return true;
  }

  const confirmId = `${AFK_MOVE_CONFIRM_PREFIX}${guild.id}:${member.id}`;
  const pending = pendingAfkMoveConfirmations.get(confirmId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingAfkMoveConfirmations.delete(confirmId);
  }

  afkUsers.delete(key);
  saveAfkUsers();

  await member.setNickname(record.originalNickname ?? null, 'Saiu do modo AFK').catch(error => {
    console.warn('[AFK] NÃ£o foi possÃ­vel restaurar o apelido:', error.message);
  });

  await message.channel.send(`â˜€ï¸ <@${member.id}> saiu do mundo AFK e jÃ¡ pode ser mencionado novamente.`).catch(() => {});
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
      content: 'â±ï¸ Essa confirmaÃ§Ã£o jÃ¡ expirou.'
    }).catch(() => {});
    return true;
  }

  if (interaction.user.id !== userId) {
    await interaction.reply({
      content: 'âŒ Somente a pessoa que ativou o AFK pode responder essa confirmaÃ§Ã£o.'
    }).catch(() => {});
    return true;
  }

  clearTimeout(pending.timer);
  pendingAfkMoveConfirmations.delete(confirmId);

  const guild = interaction.guild || client.guilds.cache.get(guildId);
  const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
  if (!guild || !member) {
    await interaction.update({
      content: 'âš ï¸ NÃ£o consegui localizar o servidor ou o membro.',
      components: []
    }).catch(() => {});
    return true;
  }

  if (choice === 'yes') {
    const afkChannel = guild.channels.cache.get(AFK_VOICE_CHANNEL_ID)
      || await guild.channels.fetch(AFK_VOICE_CHANNEL_ID).catch(() => null);

    if (!afkChannel?.isVoiceBased?.()) {
      await interaction.update({
        content: `âŒ NÃ£o encontrei o canal AFK <#${AFK_VOICE_CHANNEL_ID}>. VocÃª permaneceu na call atual.`,
        components: []
      }).catch(() => {});
      return true;
    }

    try {
      await member.voice.setChannel(afkChannel, 'ConfirmaÃ§Ã£o de entrada no modo AFK');
      await interaction.update({
        content: `<a:luacancun2:1554021665934155796> VocÃª entrou no mundo AFK e foi movido para <#${AFK_VOICE_CHANNEL_ID}>. NÃ£o pode ser perturbado.`,
        components: []
      }).catch(() => {});
    } catch (error) {
      console.warn('[AFK] NÃ£o foi possÃ­vel mover apÃ³s confirmaÃ§Ã£o:', error.message);
      await interaction.update({
        content: `âŒ NÃ£o consegui mover <@${member.id}> para <#${AFK_VOICE_CHANNEL_ID}>. Verifique a permissÃ£o **Mover Membros**.`,
        components: []
      }).catch(() => {});
    }
    return true;
  }

  await interaction.update({
    content: `<a:luacancun2:1554021665934155796> VocÃª entrou no mundo AFK e escolheu permanecer na call atual. NÃ£o pode ser perturbado.`,
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
    console.warn('[RankCall] Erro ao carregar sequÃªncias:', e.message);
  }
}

function saveRankCallStreaks() {
  try {
    fs.writeFileSync(RANK_CALL_STREAKS_FILE, JSON.stringify(Object.fromEntries(rankCallStreaks), null, 2), 'utf8');
  } catch (e) {
    console.warn('[RankCall] Erro ao salvar sequÃªncias:', e.message);
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
  const before = Number(record.dailySeconds[dateKey] || 0);
  const after = before + amount;
  record.dailySeconds[dateKey] = after;
  let qualified = false;
  if (before < RANK_CALL_STREAK_MIN_SECONDS && after >= RANK_CALL_STREAK_MIN_SECONDS) {
    qualified = addRankCallQualifiedDate(record, dateKey);
  }
  // O progresso diÃ¡rio tambÃ©m Ã© persistido antes dos 30 minutos,
  // para que um reinÃ­cio nÃ£o apague o que jÃ¡ foi feito naquele dia.
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
    await user.send(`${RANK_CALL_STREAK_EMOJI} **Sua sequÃªncia do RankCall foi perdida.**\n\nVocÃª tinha uma sequÃªncia de **${oldStreak} ${oldStreak === 1 ? 'dia' : 'dias'}**${guild ? ` no servidor **${guild.name}**` : ''}.\nNo dia **${prettyDate}**, vocÃª nÃ£o completou os **30 minutos mÃ­nimos em call**.\n\nEntre em qualquer canal de voz e fique pelo menos **30 minutos** no dia para comeÃ§ar uma nova sequÃªncia.`);
  } catch (error) {
    console.warn('[RankCall] NÃ£o foi possÃ­vel enviar DM de sequÃªncia:', error.message);
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

    // Se ontem nÃ£o foi cumprido, a sequÃªncia atual Ã© quebrada.
    // Isso nÃ£o impede que uma nova sequÃªncia seja iniciada hoje apÃ³s 30 min.
    if (Number(record.currentStreak) > 0 && !yesterdayQualified && record.missedDayNotified !== yesterday) {
      const oldStreak = Number(record.currentStreak) || 0;
      record.currentStreak = 0;
      record.missedDayNotified = yesterday;
      changed = true;
      await notifyRankCallStreakBroken(guildId, userId, yesterday, oldStreak);
    }

    // Ao atingir 30 min hoje, a data de hoje precisa estar qualificada.
    // Mesmo que ela jÃ¡ esteja em `dates`, recalculamos o currentStreak;
    // isso corrige o caso em que a sequÃªncia foi zerada no inÃ­cio do dia.
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

    // A sequÃªncia sÃ³ fica ATIVA no painel depois que a pessoa
    // completar 30 minutos acumulados de call no dia atual.
    const todaySeconds = Number(streak?.dailySeconds?.[today] || 0);
    const todayQualified = todaySeconds >= RANK_CALL_STREAK_MIN_SECONDS;

    // Repara automaticamente o painel caso o checkpoint tenha atualizado
    // dailySeconds mas a inclusÃ£o da data qualificada ainda nÃ£o tenha ocorrido.
    if (todayQualified && !streak.dates.includes(today)) {
      addRankCallQualifiedDate(streak, today);
      changed = true;
    }

    // MantÃ©m a sequÃªncia corrente coerente com as datas histÃ³ricas.
    const recalculated = calculateRankCallCurrentStreak(streak.dates);
    if (Number(streak.currentStreak) !== Number(recalculated.currentStreak)) {
      streak.currentStreak = recalculated.currentStreak;
      changed = true;
    }
    streak.bestStreak = Math.max(Number(streak.bestStreak) || 0, Number(recalculated.bestStreak) || 0);

    const currentStreak = Number(streak.currentStreak) || 0;

    // NÃ£o exibe a sequÃªncia como ativa antes dos 30 minutos do dia.
    // O histÃ³rico continua salvo normalmente; ao completar 30 min,
    // a data de hoje Ã© adicionada e a sequÃªncia volta a aparecer.
    if (todayQualified && currentStreak > 0) {
      rows.push({ userId, streak: currentStreak, bestStreak: Number(streak.bestStreak) || 0 });
    }
  }

  if (changed) saveRankCallStreaks();
  return rows.sort((a, b) => b.streak - a.streak || b.bestStreak - a.bestStreak || a.userId.localeCompare(b.userId));
}

function saveRankCallBackup(reason = 'auto') {
  try {
    fs.mkdirSync(RANK_CALL_BACKUP_DIR, { recursive: true });
    checkpointLocalVoiceSessions();

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
  saveRankCallBackup('startup');
  rankCallBackupTimer = setInterval(() => saveRankCallBackup('auto'), 60 * 60 * 1000);
}

function checkpointLocalVoiceSessions() {
  if (voiceSessions.size === 0) {
    if (!dbReady) saveVoiceSessionsLocal();
    void evaluateRankCallStreaks();
    return;
  }

  const now = Date.now();
  let sessionChanged = false;
  let voiceHoursChanged = false;
  let streakChanged = false;

  for (const [key, startedAtRaw] of voiceSessions) {
    const startedAt = Number(startedAtRaw);
    const elapsedSeconds = Math.floor((now - startedAt) / 1000);
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) continue;

    const [guildId, userId] = key.split(':');
    if (!guildId || !userId) continue;

    if (addRankCallDailySecondsForInterval(guildId, userId, startedAt, now)) {
      streakChanged = true;
    }

    if (!dbReady) {
      const current = Number(voiceHoursLocal.get(key) || 0);
      voiceHoursLocal.set(key, current + elapsedSeconds);
      voiceHoursChanged = true;
    }

    voiceSessions.set(key, startedAt + elapsedSeconds * 1000);
    sessionChanged = true;
  }

  if (voiceHoursChanged) saveVoiceHoursLocal();
  if (sessionChanged) saveVoiceSessionsLocal();
  if (streakChanged) saveRankCallStreaks();
  void evaluateRankCallStreaks(now);
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

  'moderation.clear',

  'rules.manage',

  'blocked.manage',

  'verification.manage',

  'stats.view',

  'dashboard.view'

];


// PermissÃµes locais: funcionam mesmo sem DATABASE_URL.
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
      '[PermissÃµes] Erro ao carregar permissÃµes locais:',
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
      '[PermissÃµes] Erro ao salvar permissÃµes locais:',
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



async function initDB() {

  if (

    !Pool ||

    !process.env.DATABASE_URL

  ) {

    console.warn(

      '[DB] DATABASE_URL nÃ£o configurada. Recursos de banco ficam em modo local/in-memory.'

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



async function askAI(

  prompt,

  systemExtra = ''

) {

  if (!hasOpenAIKey()) {

    throw new Error(

      'OPENAI_API_KEY nÃ£o configurada.'

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

                `Responda em portuguÃªs brasileiro, de forma clara, objetiva e educada. ${systemExtra}`

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

      : 'NÃ£o hÃ¡ regras cadastradas no banco.';



  return askAI(

    prompt,

    `Quando a pergunta for sobre regras do servidor, use somente as regras fornecidas abaixo. NÃ£o invente regras.\n${context}`

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

  if (!dbReady) {
    const current = Number(voiceHoursLocal.get(key) || 0);
    voiceHoursLocal.set(key, current + seconds);
    saveVoiceHoursLocal();
    saveRankCallStreaks();
    void evaluateRankCallStreaks(endedAt);
    return;
  }

  await q(`
    UPDATE bot_users
    SET voice_seconds = voice_seconds + $3
    WHERE guild_id = $1 AND user_id = $2
  `, [guild.id, member.id, seconds]);

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

        `,

        [

          guild.id

        ]

      );



    for (

      const row of

        result?.rows || []

    ) {

      ranking.set(

        row.user_id,

        Number(

          row.voice_seconds || 0

        )

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
  const userMention = `<@${row.userId}>`;
  const callLabel = channel
    ? `${isCallPriv ? 'ðŸ› ï¸ ' : ''}<#${channel.id}>${ownerId === row.userId ? ' â€¢ ðŸ‘‘ Dono' : ''}`
    : 'ðŸ”‡ Fora de call';

  return [
    `**${index + 1}.** ${userMention}`,
    `â•° â±ï¸ **${formatVoiceDuration(row.seconds)}** â€¢ ðŸ”Š ${callLabel}`
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
    : 'ðŸ“Š Nenhum usuÃ¡rio possui horas registradas em call.';

  const embed = createEmbed({
    title: String(rankCallConfig.title || DEFAULT_RANK_CALL_CONFIG.title).slice(0, 256),
    description: [String(rankCallConfig.description || '').trim(), description].filter(Boolean).join('\n\n'),
    color: normalizeHexColor(rankCallConfig.color),
    footer: `Ranking de horas â€¢ PÃ¡gina ${safePage + 1}/${totalPages} â€¢ Atualiza a cada 5 segundos â€¢ ${guild.name}`
  });

  if (rankCallConfig.icon && /^https?:\/\//i.test(rankCallConfig.icon)) embed.setThumbnail(rankCallConfig.icon);
  if (rankCallConfig.banner && /^https?:\/\//i.test(rankCallConfig.banner)) embed.setImage(rankCallConfig.banner);

  return { embed, totalPages, safePage, userIds: rows.map(row => row.userId) };
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
        `**${start + index + 1}.** <@${row.userId}> â€” ${RANK_CALL_STREAK_EMOJI} **SequÃªncia: ${row.streak} ${row.streak === 1 ? 'dia' : 'dias'}**`
      ).join('\n')
    : `${RANK_CALL_STREAK_EMOJI} Nenhum usuÃ¡rio possui uma sequÃªncia ativa no momento.`;

  const embed = createEmbed({
    title: `${RANK_CALL_STREAK_EMOJI} SequÃªncia de dias em Call`,
    description,
    color: normalizeHexColor(rankCallConfig.color),
    footer: `30 minutos acumulados em call por dia â€¢ Dias histÃ³ricos salvos â€¢ PÃ¡gina ${safePage + 1}/${totalPages} â€¢ ${guild.name}`
  });

  if (rankCallConfig.icon && /^https?:\/\//i.test(rankCallConfig.icon)) embed.setThumbnail(rankCallConfig.icon);
  if (rankCallConfig.banner && /^https?:\/\//i.test(rankCallConfig.banner)) embed.setImage(rankCallConfig.banner);

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
          `[RankCall] DEBUG mensagem ${message.id} | título="${message.embeds[0]?.title || ''}" | footer="${message.embeds[0]?.footer?.text || ''}"`
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
      `[RankCall] Painéis encontrados no canal: ${candidates.length} | IDs: ${candidates.map(m => m.id).join(', ')}`
    );

    const panel = candidates[0] || null;

    // Se existirem vários painéis antigos, mantém somente o mais recente.
    for (const duplicate of candidates.slice(1)) {
      try {
        await duplicate.delete();
        console.log(`[RankCall] Painel duplicado removido: ${duplicate.id}`);
      } catch (error) {
        console.error(
          `[RankCall] Não foi possível remover painel duplicado ${duplicate.id}:`,
          error?.message || error
        );
      }
    }

    return panel;
  } catch (error) {
    console.warn(
      '[RankCall] Não foi possível procurar painel existente:',
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
      `Canal RankCall ${RANK_CALL_CHANNEL_ID} não encontrado ou não é de texto.`
    );
  }

  // Usa somente a referência em memória.
  // Nenhum messageId é salvo no arquivo.
  let panel = rankCallPanelMessage;

  if (recreate && panel) {
    try {
      await panel.delete();
      console.log(`[RankCall] Painel anterior removido: ${panel.id}`);
    } catch (error) {
      console.error(
        '[RankCall] Não foi possível remover o painel anterior:',
        error?.message || error
      );
    }

    rankCallPanelMessage = null;
    panel = null;
  }

  // Só procura um painel existente quando ainda não temos
  // um painel guardado em memória.
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

  const components = [];

  if (hoursView.totalPages > 1) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rankcall_prev_${hoursView.safePage}`)
          .setLabel('? Horas')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(hoursView.safePage <= 0),
        new ButtonBuilder()
          .setCustomId(`rankcall_next_${hoursView.safePage}`)
          .setLabel('Horas ?')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(
            hoursView.safePage >= hoursView.totalPages - 1
          )
      )
    );
  }

  if (streakView.totalPages > 1) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rankstreak_prev_${streakView.safePage}`)
          .setLabel('? Sequências')
          .setStyle(ButtonStyle.Success)
          .setDisabled(streakView.safePage <= 0),
        new ButtonBuilder()
          .setCustomId(`rankstreak_next_${streakView.safePage}`)
          .setLabel('Sequências ?')
          .setStyle(ButtonStyle.Success)
          .setDisabled(
            streakView.safePage >= streakView.totalPages - 1
          )
      )
    );
  }

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
      // Limpa somente a referência em memória e recria uma vez.
      if (error?.code === 10008) {
        console.warn('[RankCall] Painel não existe mais. Criando um novo painel.');

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

  // Guarda somente em memória durante esta execução.
  // Nenhum messageId é salvo no arquivo.
  rankCallPanelMessage = panel;
  liveRankPanels.set(panel.id, {
    guildId: guild.id,
    channelId: channel.id
  });

  return panel;
}
function buildRankCallConfigEmbed() {
  return createEmbed({
    title: 'âš™ï¸ ConfiguraÃ§Ã£o do RankCall',
    description: 'Use os botÃµes abaixo para personalizar o painel de ranking. O ranking nÃ£o possui limite de usuÃ¡rios; quando necessÃ¡rio, usa pÃ¡ginas de 10 pessoas.',
    color: normalizeHexColor(rankCallConfig.color),
    fields: [
      { name: 'TÃ­tulo', value: String(rankCallConfig.title || 'â€”').slice(0, 1024) },
      { name: 'DescriÃ§Ã£o', value: String(rankCallConfig.description || 'â€”').slice(0, 1024) },
      { name: 'Cor', value: String(rankCallConfig.color || 'â€”'), inline: true },
      { name: 'Ãcone', value: rankCallConfig.icon ? 'Configurado' : 'NÃ£o configurado', inline: true },
      { name: 'Banner', value: rankCallConfig.banner ? 'Configurado' : 'NÃ£o configurado', inline: true }
    ],
    footer: 'RankCall â€¢ somente administradores'
  });
}

function buildRankCallConfigComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('rankconfig_title').setLabel('TÃ­tulo').setEmoji('âœï¸').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('rankconfig_description').setLabel('DescriÃ§Ã£o').setEmoji('ðŸ“').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('rankconfig_color').setLabel('Cor').setEmoji('ðŸŽ¨').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('rankconfig_icon').setLabel('Ãcone').setEmoji('ðŸ–¼ï¸').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('rankconfig_banner').setLabel('Banner').setEmoji('ðŸŒ„').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('rankconfig_reset').setLabel('Restaurar').setEmoji('â™»ï¸').setStyle(ButtonStyle.Danger)
    )
  ];
}

async function sendRankCallConfigPanel(guild) {
  const channel = await client.channels.fetch(RANK_CALL_CHANNEL_ID).catch(() => null);

  console.log(
  );
  if (!channel?.isTextBased()) throw new Error('Canal do RankCall nÃ£o encontrado.');
  const message = await channel.send({
    embeds: [buildRankCallConfigEmbed()],
    components: buildRankCallConfigComponents()
  });
  return message;
}

function openRankCallConfigModal(interaction, option) {
  const labels = {
    title: 'TÃ­tulo do painel',
    description: 'DescriÃ§Ã£o do painel',
    color: 'Cor HEX (#RRGGBB)',
    icon: 'URL do Ã­cone',
    banner: 'URL do banner'
  };
  const placeholders = {
    title: 'ðŸ† Ranking de Horas em Call',
    description: 'Acompanhe em tempo real quem mais permanece em call.',
    color: '#FEE75C',
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
  const modal = new ModalBuilder().setCustomId(`rankconfig_modal:${option}`).setTitle(`âš™ï¸ ${labels[option]}`);
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
    return interaction.reply({ content: 'âŒ VocÃª nÃ£o possui permissÃ£o para configurar o RankCall.', flags: MessageFlags.Ephemeral });
  }

  const option = interaction.customId.split(':')[1];
  const value = String(interaction.fields.getTextInputValue('value') || '').trim();

  if (option === 'color' && value && !/^#[0-9A-Fa-f]{6}$/.test(value)) {
    return interaction.reply({ content: 'âŒ A cor deve estar no formato #RRGGBB.', flags: MessageFlags.Ephemeral });
  }
  if ((option === 'icon' || option === 'banner') && value && !/^https?:\/\//i.test(value)) {
    return interaction.reply({ content: 'âŒ Informe uma URL comeÃ§ando com http:// ou https://.', flags: MessageFlags.Ephemeral });
  }

  rankCallConfig[option] = option === 'color' ? (value || DEFAULT_RANK_CALL_CONFIG.color) : value;
  saveRankCallConfig();
  saveRankCallBackup(`config-${option}`);
  await interaction.reply({ content: `âœ… ${option === 'title' ? 'TÃ­tulo' : option === 'description' ? 'DescriÃ§Ã£o' : option === 'color' ? 'Cor' : option === 'icon' ? 'Ãcone' : 'Banner'} atualizado.`, flags: MessageFlags.Ephemeral });
  await refreshRankCallPanel();
}

async function handleRankCallConfigButton(interaction) {
  if (!isTempVoicePanelAdmin(interaction.member)) {
    await interaction.reply({ content: 'âŒ VocÃª nÃ£o possui permissÃ£o para configurar o RankCall.', flags: MessageFlags.Ephemeral }).catch(() => {});
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
    // Primeiro sincroniza quem estÃ¡ realmente em voz e transforma o tempo
    // acumulado desde o Ãºltimo checkpoint em horas persistentes.
    syncRankCallVoiceSessionsFromVoiceStates();
    checkpointLocalVoiceSessions();
    await syncRankCallStreaksFromVoiceStates();

    const channel = await client.channels.fetch(RANK_CALL_CHANNEL_ID).catch(() => null);

  console.log(
  );
    if (!channel?.isTextBased() || !channel.guild) return;

    // O painel Ã© persistente, mas a mensagem pode ter sido apagada manualmente.
    // Nesse caso o bot recria automaticamente uma Ãºnica mensagem e grava o novo ID.
    await publishRankCallPanel(channel.guild, {
      page: rankCallConfig.page || 0,
      streakPage: rankCallConfig.streakPage || 0
    });

    // Log leve para confirmar no console que o relÃ³gio do RankCall continua
    // sendo processado, sem inundar o terminal.
    const active = [...voiceSessions.values()].length;
    console.log(`[RankCall] Heartbeat OK â€¢ ${active} sessÃ£o(Ãµes) ativas â€¢ ${new Date().toLocaleTimeString('pt-BR')}`);
  } catch (error) {
    console.error('[RankCall] AtualizaÃ§Ã£o automÃ¡tica:', error.message);
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

  console.log('[RankCall] AtualizaÃ§Ã£o automÃ¡tica a cada 5 segundos ativada.');
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
      await message.channel.send('âŒ VocÃª nÃ£o possui permissÃ£o para administrar o RankCall.').catch(() => {});
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
      const prefix = `${message.guild.id}:`;
      for (const key of [...voiceHoursLocal.keys()]) {
        if (key.startsWith(prefix)) voiceHoursLocal.delete(key);
      }
      const resetAt = Date.now();
      for (const key of [...voiceSessions.keys()]) {
        if (key.startsWith(prefix)) voiceSessions.set(key, resetAt);
      }
      saveVoiceHoursLocal();
      saveVoiceSessionsLocal();
      saveRankCallBackup('rankresetall');
      await refreshRankCallPanel();
      await message.channel.send('âœ… Todas as horas de call deste servidor foram zeradas. As sequÃªncias de dias continuam salvas.').catch(() => {});
      return true;
    }

    const target = message.mentions.users.first();
    if (!target) {
      await message.channel.send(`âŒ Use !${command} @usuario${command === 'rankreset' ? '' : ' horas'}`).catch(() => {});
      return true;
    }

    const key = `${message.guild.id}:${target.id}`;
    const current = Number(voiceHoursLocal.get(key) || 0);
    const rawHours = parts.find(value => /^\d+(?:[.,]\d+)?$/.test(value));
    const hours = Number.parseFloat(String(rawHours || '0').replace(',', '.'));

    if (command !== 'rankreset' && (!Number.isFinite(hours) || hours < 0)) {
      await message.channel.send('âŒ Informe uma quantidade de horas vÃ¡lida.').catch(() => {});
      return true;
    }

    if (command === 'rankreset') {
      voiceHoursLocal.delete(key);
      if (voiceSessions.has(key)) voiceSessions.set(key, Date.now());
    } else if (command === 'rankremove') {
      voiceHoursLocal.set(key, Math.max(0, current - Math.round(hours * 3600)));
    } else if (command === 'rankadd') {
      voiceHoursLocal.set(key, Math.max(0, current + Math.round(hours * 3600)));
    } else if (command === 'rankset') {
      voiceHoursLocal.set(key, Math.max(0, Math.round(hours * 3600)));
      if (voiceSessions.has(key)) voiceSessions.set(key, Date.now());
    }

    saveVoiceHoursLocal();
    saveRankCallBackup(command);
    await refreshRankCallPanel();
    await message.channel.send(`âœ… Horas de <@${target.id}> atualizadas no RankCall. As sequÃªncias de dias permanecem salvas.`).catch(() => {});
    return true;
  } catch (error) {
    console.error('[RankCall]', error);
    await message.channel.send(`âŒ Erro no RankCall: ${error.message}`).catch(() => {});
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

              } â€” ${

                item.message_count

              } mensagens`;

            }

          )

          .join('\n')

      : 'Sem dados ainda.';



  return createEmbed({

    title:

      'ðŸ“Š Painel de EstatÃ­sticas',

    description:

      'EstatÃ­sticas atualizadas do servidor.',

    color: '#5865F2',



    fields: [

      {

        name: 'ðŸ¤– BOT',

        value:

          'ðŸŸ¢ ONLINE',

        inline: true

      },



      {

        name: 'ðŸ‘¥ Membros',

        value:

          String(

            stats.members

          ),

        inline: true

      },



      {

        name: 'ðŸŸ¢ Online',

        value:

          String(

            stats.online

          ),

        inline: true

      },



      {

        name: 'ðŸŽ« Tickets',

        value:

          String(

            stats.tickets

          ),

        inline: true

      },



      {

        name: 'ðŸ’˜ Matches',

        value:

          String(

            stats.matches

          ),

        inline: true

      },



      {

        name: 'ðŸ”Š Em call',

        value:

          String(

            stats.voice

          ),

        inline: true

      },



      {

        name: 'ðŸ’¬ Mensagens',

        value:

          String(

            stats.messages

          ),

        inline: true

      },



      {

        name:

          'ðŸ“ˆ Canais mais utilizados',

        value:

          top

      }

    ],



    footer:

      'AtualizaÃ§Ã£o em tempo real'

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

        'Nenhum cÃ³digo de verificaÃ§Ã£o encontrado.'

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

        'O cÃ³digo expirou. Gere outro cÃ³digo.'

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

        'CÃ³digo incorreto.'

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

          `âš ï¸ ${message.author}, sua mensagem foi removida por conter uma palavra bloqueada.`

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

        `âš ï¸ Sua mensagem no servidor **${message.guild.name}** foi removida porque contÃ©m uma palavra que estÃ¡ na lista de bloqueio.`

    });

  } catch {}



  await sendLog(

    message.guild,

    `ðŸš« **Palavra bloqueada**\nUsuÃ¡rio: ${message.author.tag} (${message.author.id})\nCanal: <#${message.channel.id}>\nPalavra detectada: \`${found}\``

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

        `Analise esta mensagem de Discord e determine se ela parece exigir atenÃ§Ã£o da equipe de staff.



Mensagem:

"${content}"



Responda SOMENTE neste formato JSON:

{

  "attention": true ou false,

  "reason": "motivo curto",

  "severity": "low" ou "medium" ou "high"

}



NÃ£o considere simplesmente crÃ­ticas, opiniÃµes ou discussÃµes normais como motivo para intervenÃ§Ã£o.`,

        'VocÃª Ã© um detector de mensagens que podem precisar de atenÃ§Ã£o humana. VocÃª nÃ£o pune ninguÃ©m e nÃ£o deve inventar contexto.'

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

      `ðŸš¨ **AtenÃ§Ã£o da IA**\nUsuÃ¡rio: ${message.author} (${message.author.id})\nCanal: <#${message.channel.id}>\nSeveridade: **${data.severity || 'medium'}**\nMotivo: ${data.reason || 'A IA identificou uma possÃ­vel necessidade de atenÃ§Ã£o.'}\n\n> ${content.slice(0, 1000)}`

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

        'Anti-spam automÃ¡tico'

      );



      await logModeration(

        message.guild.id,

        message.author.id,

        client.user.id,

        'timeout',

        'Anti-spam automÃ¡tico'

      );



      await sendLog(

        message.guild,

        `ðŸ›¡ï¸ **Anti-spam**\n${message.author} recebeu timeout de 1 minuto.`

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

        'âœ… VerificaÃ§Ã£o',

      description:

        'Clique no botÃ£o abaixo para receber um cÃ³digo de verificaÃ§Ã£o por DM.',

      color: '#57F287'

    });



  const row =

    new ActionRowBuilder().addComponents(

      new ButtonBuilder()

        .setCustomId(

          'verification_start'

        )

        .setLabel(

          'ðŸ” Verificar'

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

        `ðŸ” **CÃ³digo de verificaÃ§Ã£o**\n\nSeu cÃ³digo para o servidor **${interaction.guild.name}** Ã©:\n\n**${result.code}**\n\nEste cÃ³digo expira em 10 minutos.`

    });



    await interaction.reply({

      content:

        'âœ… O cÃ³digo foi enviado para sua DM. Clique em **Inserir cÃ³digo** para finalizar.',

      ephemeral: true,

      components: [

        new ActionRowBuilder()

          .addComponents(

            new ButtonBuilder()

              .setCustomId(

                'verification_enter'

              )

              .setLabel(

                'ðŸ”¢ Inserir cÃ³digo'

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

        'âŒ NÃ£o consegui enviar DM. Ative as mensagens diretas para membros do servidor e tente novamente.',

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

        'CÃ³digo de verificaÃ§Ã£o'

      );



  const input =

    new TextInputBuilder()

      .setCustomId(

        'verification_code'

      )

      .setLabel(

        'Digite o cÃ³digo recebido'

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

        `âŒ ${result.reason}`,

      ephemeral: true

    });



    return;

  }



  await interaction.reply({

    content:

      'âœ… VerificaÃ§Ã£o concluÃ­da com sucesso!',

    ephemeral: true

  });



  await sendLog(

    interaction.guild,

    `âœ… ${interaction.user} concluiu a verificaÃ§Ã£o.`

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

        String(tempVoiceConfig.defaultName || 'ðŸ”Šãƒ»{user}')
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

  // Primeiro tenta a informaÃ§Ã£o persistida em temp-voice-rooms.json.
  const saved = tempRooms.get(channel.id);
  if (saved?.ownerId) {
    return saved.ownerId;
  }

  // Fallback para salas antigas: o dono recebe explicitamente
  // ManageChannels + MoveMembers na criaÃ§Ã£o.
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

        'Sala temporÃ¡ria vazia'

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
    if (!states) continue;

    for (const state of states.values()) {
      const userId = state?.id || state?.member?.id || null;
      if (!state?.channelId || !userId) continue;
      if (state?.member?.user?.bot) continue;

      const key = `${guild.id}:${userId}`;
      if (!voiceSessions.has(key)) {
        // Recupera sessÃµes que jÃ¡ estavam em call quando o bot terminou de conectar
        // ou quando um VoiceStateUpdate foi perdido temporariamente.
        voiceSessions.set(key, Date.now());
        changed = true;
      }
    }
  }

  if (changed) saveVoiceSessionsLocal();
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

      `âœ… Sua sala foi criada: ${channel}`,

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

        'âŒ VocÃª precisa estar em uma sala temporÃ¡ria.',

      ephemeral: true

    });

  }



  const data =

    getTempRoom(channel.id);



  if (!data) {

    return interaction.reply({

      content:

        'âŒ Esta nÃ£o Ã© uma sala temporÃ¡ria.',

      ephemeral: true

    });

  }



  if (

    data.ownerId !==

    interaction.user.id

  ) {

    return interaction.reply({

      content:

        'âŒ Somente o dono da sala pode alterar o nome.',

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

        'âŒ Sala nÃ£o encontrada.',

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

        'âŒ VocÃª nÃ£o Ã© o dono desta sala.',

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

        'âŒ Informe um nome vÃ¡lido.',

      ephemeral: true

    });

  }



  await channel

    .setName(name)

    .catch(() => {});



  await interaction.reply({

    content:

      `âœ… Nome alterado para **${name}**.`,

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

        'âŒ VocÃª precisa estar em uma sala temporÃ¡ria.',

      ephemeral: true

    });

  }



  const data =

    getTempRoom(channel.id);



  if (!data) {

    return interaction.reply({

      content:

        'âŒ Esta nÃ£o Ã© uma sala temporÃ¡ria.',

      ephemeral: true

    });

  }



  if (

    data.ownerId !==

    interaction.user.id

  ) {

    return interaction.reply({

      content:

        'âŒ Somente o dono da sala pode usar este controle.',

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

            'âŒ O bot nÃ£o tem permissÃ£o para alterar as permissÃµes desta sala. DÃª ao cargo do bot a permissÃ£o **Gerenciar canais** e verifique se a categoria nÃ£o possui uma negaÃ§Ã£o dessa permissÃ£o.',

          ephemeral: true

        });

      }

      throw e;

    }

    return interaction.reply({

      content:

        'ðŸ”’ Sala bloqueada.',

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

            'âŒ O bot nÃ£o tem permissÃ£o para alterar as permissÃµes desta sala. DÃª ao cargo do bot a permissÃ£o **Gerenciar canais** e verifique se a categoria nÃ£o possui uma negaÃ§Ã£o dessa permissÃ£o.',

          ephemeral: true

        });

      }

      throw e;

    }

    return interaction.reply({

      content:

        'ðŸ”“ Sala desbloqueada.',

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

        'ðŸ—‘ï¸ Sala excluÃ­da.',

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

          'Limite de usuÃ¡rios'

        );



    const input =

      new TextInputBuilder()

        .setCustomId(

          'limit'

        )

        .setLabel(

          'Quantidade de usuÃ¡rios'

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

          'âŒ NÃ£o hÃ¡ outros usuÃ¡rios na sala.',

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

        'ðŸ‘¢ Escolha o usuÃ¡rio:',

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

          'âŒ NÃ£o hÃ¡ outro usuÃ¡rio para receber a posse.',

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

        'ðŸ‘‘ Escolha o novo dono:',

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

        'âŒ VocÃª nÃ£o Ã© o dono desta sala ou ela nÃ£o existe mais.',


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

          'âŒ Informe um nÃºmero entre 0 e 99.',

  
      });

    }
    try {
      await channel.setUserLimit(value);
      return interaction.editReply({ content: `âœ… Limite definido para **${value === 0 ? 'sem limite' : value}**.` });
    } catch (error) {
      console.error('[TempVoice] Erro ao alterar limite:', error);
      return interaction.editReply({ content: error?.code === 50013 ? 'âŒ O bot nÃ£o tem permissÃ£o para alterar o limite desta sala. Verifique **Gerenciar canais**.' : 'âŒ NÃ£o foi possÃ­vel alterar o limite da sala.' });
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
    if (!name) return interaction.editReply({ content: 'âŒ Informe um nome vÃ¡lido para a sala.' });

    try {
      await channel.setName(name);
      return interaction.editReply({ content: `âœ… Sala renomeada para **${name}**.` });
    } catch (error) {
      console.error('[TempVoice] Erro ao renomear sala:', error);
      return interaction.editReply({ content: error?.code === 50013 ? 'âŒ O bot nÃ£o tem permissÃ£o para renomear esta sala. Verifique **Gerenciar canais** e as permissÃµes da categoria.' : 'âŒ NÃ£o foi possÃ­vel renomear a sala.' });
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

        'âŒ VocÃª nÃ£o Ã© o dono desta sala.',

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

        'âŒ UsuÃ¡rio nÃ£o encontrado.',

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

          'âŒ O usuÃ¡rio nÃ£o estÃ¡ mais na sala.',

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

        `ðŸ‘¢ ${member} foi removido da sala.`,

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

        `ðŸ‘‘ A posse da sala foi transferida para ${member}.`,

      components: []

    });

  }

}



function buildTempVoicePanelPayload() {
  const embed = createEmbed({
    title: tempVoiceConfig.title || 'ðŸ”Š Salas de Voz TemporÃ¡rias',
    description: tempVoiceConfig.description || 'Clique no menu abaixo para criar e administrar sua sala de voz.',
    color: tempVoiceConfig.color || '#5865F2',
    footer: tempVoiceConfig.footer || undefined
  });

  if (tempVoiceConfig.banner) embed.setImage(tempVoiceConfig.banner);
  if (tempVoiceConfig.icon) embed.setThumbnail(tempVoiceConfig.icon);

  const emojis = { create:'âž•', rename:'âœï¸', lock:'ðŸ”’', unlock:'ðŸ”“', limit:'ðŸ‘¥', kick:'ðŸ‘¢', transfer:'ðŸ‘‘', delete:'ðŸ—‘ï¸' };
  const actions = new StringSelectMenuBuilder()
    .setCustomId('tempvoice_action')
    .setPlaceholder('ðŸŽ™ï¸ Selecione uma aÃ§Ã£o para sua sala')
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
    .setPlaceholder('âš™ï¸ ConfiguraÃ§Ã£o do painel')
    .addOptions(
      ['description','title','color','banner','icon','footer','defaultName','categoryId','deleteAfterMinutes','userLimit','options','authorizedRoleId','reset'].map((value, i) => {
        const data = [
          ['DescriÃ§Ã£o','Altera a descriÃ§Ã£o do embed.','ðŸ“'], ['TÃ­tulo','Altera o tÃ­tulo do embed.','âœï¸'],
          ['Cor','Define a cor hexadecimal do embed.','ðŸŽ¨'], ['Banner','Adiciona ou altera a imagem principal.','ðŸ–¼ï¸'],
          ['Ãcone / Thumbnail','Adiciona ou altera a thumbnail.','ðŸ–¼ï¸'], ['RodapÃ©','Personaliza o footer do painel.','ðŸ“Œ'],
          ['Nome padrÃ£o das calls','Define o nome usado ao criar salas.','ðŸ”Š'], ['Categoria das calls','Define a categoria onde as salas serÃ£o criadas.','ðŸ“'],
          ['Tempo de exclusÃ£o automÃ¡tica','Define os minutos que uma sala vazia permanece.','â±ï¸'], ['Limite padrÃ£o','Define o limite de usuÃ¡rios das novas salas.','ðŸ‘¥'],
          ['OpÃ§Ãµes / botÃµes do painel','Ativa ou desativa as opÃ§Ãµes da Call Priv.','ðŸŽ›ï¸'], ['PermissÃ£o de configuraÃ§Ã£o','Define o cargo autorizado a configurar o painel.','ðŸ”'],
          ['Restaurar padrÃ£o','Volta todas as configuraÃ§Ãµes aos valores originais.','â™»ï¸']
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
    return interaction.reply({ content:'âŒ Esta opÃ§Ã£o estÃ¡ desativada no painel.', ephemeral:true });
  }

  if (action === 'create') {
    const existing = [...tempRooms.entries()].find(([, data]) => data.guildId === interaction.guild.id && data.ownerId === interaction.user.id);
    if (existing) {
      const existingChannel = interaction.guild.channels.cache.get(existing[0]);
      if (existingChannel) {
        if (interaction.member.voice?.channelId !== existingChannel.id) await interaction.member.voice.setChannel(existingChannel).catch(() => {});
        return interaction.reply({ content:`âš ï¸ VocÃª jÃ¡ possui uma sala: ${existingChannel}`, ephemeral:true });
      }
      tempRooms.delete(existing[0]);
      saveTempRooms();
    }

    // A criaÃ§Ã£o da sala pode passar de 3 segundos. ReconheÃ§a a interaÃ§Ã£o antes da API do Discord.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const channel = await createTempVoiceRoom(interaction.guild, interaction.member);
      if (interaction.member.voice?.channelId !== channel.id) {
        await interaction.member.voice.setChannel(channel).catch(() => {});
      }
      return interaction.editReply({ content:`âœ… Sua sala foi criada: ${channel}` });
    } catch (error) {
      console.error('[TempVoice] Erro ao criar sala:', error);
      return interaction.editReply({
        content: error?.code === 50013
          ? 'âŒ O bot nÃ£o tem permissÃ£o para criar/configurar a sala. Verifique **Gerenciar canais**, **Gerenciar permissÃµes** e as permissÃµes da categoria.'
          : 'âŒ NÃ£o foi possÃ­vel criar sua sala de voz. Verifique as permissÃµes do bot e a categoria configurada.'
      });
    }
  }
  return tempVoiceControl(interaction, action);
}

async function handleTempVoicePanelConfigSelect(interaction) {
  if (!isTempVoicePanelAdmin(interaction.member)) {
    const roleId = tempVoiceConfig.authorizedRoleId || COMMAND_ACCESS_ROLE_ID;
    return interaction.reply({ content:`âŒ Apenas Administrador ou membros com o cargo <@&${roleId}> podem configurar o painel.`, ephemeral:true });
  }

  const option = interaction.values[0];
  if (option === 'reset') {
    resetTempVoiceConfig();
    saveTempVoiceConfig();
    await refreshTempVoicePanel(interaction.guild);
    return interaction.reply({ content:'â™»ï¸ Todas as configuraÃ§Ãµes foram restauradas e o painel foi atualizado em tempo real.', ephemeral:true });
  }

  if (option === 'options') {
    const modal = new ModalBuilder().setCustomId('tempvoice_panel_config:options').setTitle('ðŸŽ›ï¸ OpÃ§Ãµes do painel');
    for (const [key,label] of [['create','Criar sala'],['rename','Renomear sala'],['lock','Bloquear sala'],['unlock','Desbloquear sala'],['limit','Alterar limite'],['kick','Expulsar membro'],['transfer','Transferir posse'],['delete','Excluir sala']]) {
      modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(key).setLabel(`${label} â€” ON/OFF`).setPlaceholder('ON ou OFF').setValue(tempVoiceConfig.options[key] ? 'ON':'OFF').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3)));
    }
    return interaction.showModal(modal);
  }

  const labels = { description:'DescriÃ§Ã£o do painel', banner:'URL do banner', icon:'URL do Ã­cone/thumbnail', title:'TÃ­tulo do painel', color:'Cor do embed', footer:'RodapÃ© do painel', defaultName:'Nome padrÃ£o das calls', categoryId:'ID da categoria das calls', deleteAfterMinutes:'Tempo para excluir sala vazia (minutos)', userLimit:'Limite padrÃ£o de usuÃ¡rios', authorizedRoleId:'ID do cargo autorizado' };
  const placeholders = { description:'Ex.: Crie e administre sua prÃ³pria sala...', banner:'https://exemplo.com/banner.png', icon:'https://exemplo.com/icone.png', title:'ðŸ”Š Salas de Voz TemporÃ¡rias', color:'#5865F2', footer:'Call Priv â€¢ ConfiguraÃ§Ã£o dinÃ¢mica', defaultName:'ðŸ”Šãƒ»{user}', categoryId:'ID da categoria do Discord', deleteAfterMinutes:'5', userLimit:'0 = ilimitado', authorizedRoleId:'ID do cargo autorizado' };
  const modal = new ModalBuilder().setCustomId(`tempvoice_panel_config:${option}`).setTitle(labels[option]);
  const input = new TextInputBuilder().setCustomId('value').setLabel(labels[option]).setPlaceholder(placeholders[option]).setStyle(option === 'description' || option === 'footer' ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(false).setMaxLength(option === 'description' ? 4000 : 1000);
  const current = String(tempVoiceConfig[option] ?? '');
  if (current) input.setValue(current.slice(0, option === 'description' ? 4000 : 1000));
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

async function handleTempVoicePanelConfigModal(interaction) {
  if (!isTempVoicePanelAdmin(interaction.member)) return interaction.reply({ content:'âŒ VocÃª nÃ£o possui permissÃ£o para configurar o painel.', ephemeral:true });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const option = interaction.customId.split(':')[1];

  if (option === 'options') {
    for (const key of ['create','rename','lock','unlock','limit','kick','transfer','delete']) {
      const value = interaction.fields.getTextInputValue(key).trim().toUpperCase();
      if (!['ON','OFF'].includes(value)) return interaction.editReply({ content:`âŒ O campo **${getTempVoiceOptionLabel(key)}** deve ser \`ON\` ou \`OFF\`.` });
      tempVoiceConfig.options[key] = value === 'ON';
    }
    tempVoiceConfig.options.create = true;
    saveTempVoiceConfig(); await refreshTempVoicePanel(interaction.guild);
    return interaction.editReply({ content:'ðŸŽ›ï¸ OpÃ§Ãµes do painel atualizadas em tempo real.' });
  }

  const value = interaction.fields.getTextInputValue('value').trim();
  if ((option === 'banner' || option === 'icon') && value && !/^https?:\/\//i.test(value)) return interaction.editReply({ content:'âŒ Para banner/Ã­cone, informe uma URL comeÃ§ando com `http://` ou `https://`.' });
  if (option === 'color' && value && !/^#[0-9A-Fa-f]{6}$/.test(value)) return interaction.editReply({ content:'âŒ A cor deve estar no formato hexadecimal, por exemplo `#5865F2`.' });

  if (option === 'deleteAfterMinutes') {
    const n = Number(value); if (!Number.isInteger(n) || n < 1 || n > 10080) return interaction.editReply({ content:'âŒ Informe um nÃºmero inteiro entre 1 e 10080 minutos.' });
    tempVoiceConfig[option] = n;
  } else if (option === 'userLimit') {
    const n = Number(value); if (!Number.isInteger(n) || n < 0 || n > 99) return interaction.editReply({ content:'âŒ O limite deve ser um nÃºmero entre 0 e 99. Use `0` para ilimitado.' });
    tempVoiceConfig[option] = n;
  } else if (option === 'categoryId') {
    if (value) { const c = interaction.guild.channels.cache.get(value); if (!c || c.type !== ChannelType.GuildCategory) return interaction.editReply({ content:'âŒ O ID informado nÃ£o pertence a uma categoria vÃ¡lida deste servidor.' }); }
    tempVoiceConfig[option] = value;
  } else if (option === 'authorizedRoleId') {
    if (value && !interaction.guild.roles.cache.get(value)) return interaction.editReply({ content:'âŒ NÃ£o encontrei esse cargo neste servidor.' });
    tempVoiceConfig[option] = value;
  } else {
    tempVoiceConfig[option] = value;
  }

  normalizeTempVoiceConfig(); saveTempVoiceConfig(); await refreshTempVoicePanel(interaction.guild);
  const names = { description:'DescriÃ§Ã£o', banner:'Banner', icon:'Ãcone/Thumbnail', title:'TÃ­tulo', color:'Cor', footer:'RodapÃ©', defaultName:'Nome padrÃ£o', categoryId:'Categoria', deleteAfterMinutes:'Tempo de exclusÃ£o automÃ¡tica', userLimit:'Limite padrÃ£o', authorizedRoleId:'PermissÃ£o de configuraÃ§Ã£o' };
  return interaction.editReply({ content:`âœ… ${names[option] || option} atualizado e aplicado em tempo real.` });
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

        'ðŸ“Š Ainda nÃ£o existem dados de call suficientes.',

      ephemeral: true

    });

  }



  const lines =

    ranking.map(

      (row, index) =>

        `**${index + 1}.** <@${row.user_id}> â€” **${formatHours(row.voice_seconds)}h**`

    );



  await interaction.reply({

    embeds: [

      createEmbed({

        title:

          'ðŸ† Ranking de Call',

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

        `ðŸ”Š <@${userId}> possui **${formatHours(seconds)} horas** em call.`

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

          'âŒ NÃ£o foi possÃ­vel consultar as horas em call.'

      });

    }



    return interaction.reply({

      content:

        'âŒ NÃ£o foi possÃ­vel consultar as horas em call.',

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

        `Perfil de Match â€” ${category}`

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

    ) || 'NÃ£o informado';



  const embed =

    createEmbed({

      title:

        `ðŸ’˜ Perfil de Match â€” ${nome}`,



      description:

        sobre,



      color:

        matchConfig.color,



      fields: [

        {

          name: 'ðŸ‘¤ Nome',

          value: nome,

          inline: true

        },

        {

          name: 'ðŸŽ‚ Idade',

          value: idade,

          inline: true

        },

        {

          name: 'ðŸ“‚ Categoria',

          value: category,

          inline: true

        },

        {

          name: 'ðŸŒ Rede Social',

          value: social,

          inline: true

        },

        {

          name: 'ðŸ’¬ Discord',

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

            'â¤ï¸ Dar Match'

          )

          .setStyle(

            ButtonStyle.Success

          ),



        new ButtonBuilder()

          .setCustomId(

            `match_block:${interaction.user.id}`

          )

          .setLabel(

            'ðŸš« Bloquear'

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

    content:      'âœ… Seu perfil foi criado e publicado no painel de Match.',

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

        'âŒ VocÃª nÃ£o pode dar Match no prÃ³prio perfil.',

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

        'âŒ Perfil nÃ£o encontrado.',

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

          `ðŸ’˜ **Match mÃºtuo!**\nVocÃª e ${target || `<@${targetId}>`} deram Match um no outro!`

      });

    } catch {}



    try {

      if (target) {

        await target.send({

          content:

            `ðŸ’˜ **Match mÃºtuo!**\nVocÃª e ${interaction.user} deram Match um no outro!`

        });

      }

    } catch {}



    return interaction.reply({

      content:

        'ðŸ’˜ **Match mÃºtuo!** As duas pessoas receberam uma notificaÃ§Ã£o por DM.',

      ephemeral: true

    });

  }



  await interaction.reply({

    content:

      'â¤ï¸ Interesse registrado! Se a outra pessoa tambÃ©m curtir seu perfil, serÃ¡ um Match mÃºtuo.',

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

      'ðŸš« Perfil bloqueado para vocÃª.',

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

        'Crie seu perfil e encontre novas conexÃµes.'

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

        'Verifica se o bot estÃ¡ online.'

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

      .setName('kick')

      .setDescription(

        'Expulsa um membro.'

      )

      .addUserOption(option =>

        option

          .setName('usuario')

          .setDescription(

            'UsuÃ¡rio.'

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

            'UsuÃ¡rio.'

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

                'UsuÃ¡rio.'

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

                'UsuÃ¡rio.'

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

        'Mostra o painel de estatÃ­sticas.'

      ),



    new SlashCommandBuilder()

      .setName('verify')

      .setDescription(

        'Envia o painel de verificaÃ§Ã£o.'

      ),



    new SlashCommandBuilder()

      .setName('voicepanel')

      .setDescription(

        'Envia o painel de salas temporÃ¡rias.'

      ),



    new SlashCommandBuilder()

      .setName('rankcall')

      .setDescription(

        'Mostra o ranking de horas em call.'

      ),



    new SlashCommandBuilder()

      .setName('horascall')

      .setDescription(

        'Mostra as horas de call de um usuÃ¡rio.'

      )

      .addUserOption(option =>

        option

          .setName('usuario')

          .setDescription(

            'UsuÃ¡rio.'

          )

          .setRequired(false)

      ),



    new SlashCommandBuilder()

      .setName('call')

      .setDescription(

        'Mostra as horas de call de um usuÃ¡rio.'

      )

      .addUserOption(option =>

        option

          .setName('usuario')

          .setDescription(

            'UsuÃ¡rio.'

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

                'TÃ­tulo.'

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

        'Gerencia permissÃµes personalizadas.'

      )

      .addSubcommand(sub =>

        sub

          .setName('grant')

          .setDescription(

            'Concede uma permissÃ£o a um cargo.'

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

                'PermissÃ£o.'

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

            'Remove uma permissÃ£o.'

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

                'PermissÃ£o.'

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

            'Lista as permissÃµes de um cargo.'

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

        `ðŸ“ Pong! ${client.ws.ping}ms`,

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

          'âŒ VocÃª nÃ£o possui a permissÃ£o `dashboard.view`.',

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

          'âŒ VocÃª nÃ£o possui a permissÃ£o `verification.manage`.',

        ephemeral: true

      });

    }



    await sendVerificationPanel(

      interaction.channel

    );



    return interaction.reply({

      content:

        'âœ… Painel de verificaÃ§Ã£o enviado.',

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

          'âŒ VocÃª nÃ£o possui a permissÃ£o `voice.manage`.',

        ephemeral: true

      });

    }



    await sendTempVoicePanel(

      interaction.channel

    );



    return interaction.reply({

      content:

        'âœ… Painel de voz enviado.',

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

          'âŒ VocÃª nÃ£o possui a permissÃ£o `match.manage`.',

        ephemeral: true

      });

    }



    await sendMatchPanel(

      interaction.channel

    );



    return interaction.reply({

      content:

        'âœ… Painel de Match enviado.',

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

        `âŒ ${e.message}`

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

          'âŒ VocÃª nÃ£o possui a permissÃ£o `rules.manage`.',

        ephemeral: true

      });

    }



    const sub =

      interaction.options.getSubcommand();


    if (sub === 'panel') {
      const ok = await refreshRulesPanel(interaction.guild);
      return interaction.reply({
        content: ok ? `âœ… Painel de regras enviado/renovado no canal <#${RULES_CHANNEL_ID}>.` : 'âŒ NÃ£o consegui acessar o canal configurado para as regras.',
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

            'ðŸ“œ Nenhuma regra cadastrada.',

          ephemeral: true

        });

      }



      const text =

        rules

          .map(

            rule =>

              `**#${rule.rule_id} â€” ${rule.title}**\n${rule.content}`

          )

          .join('\n\n');



      return interaction.reply({

        embeds: [

          createEmbed({

            title:

              'ðŸ“œ Regras do servidor',

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

          'âœ… Regra adicionada.',

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

          'âœ… Regra removida, caso existisse.',

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

          'âŒ Somente administradores do Discord podem configurar permissÃµes personalizadas.',

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

          `âœ… \`${permission}\` concedida ao cargo ${role}.`,

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

          `âœ… \`${permission}\` removida do cargo ${role}.`,

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

            ? `ðŸ” PermissÃµes de ${role}:\n${permissions.map(p => `â€¢ \`${p}\``).join('\n')}`

            : `â„¹ï¸ O cargo ${role} nÃ£o possui permissÃµes personalizadas.`,

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

          'âŒ VocÃª nÃ£o possui `moderation.clear`.',

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

      `ðŸ§¹ ${deleted.size} mensagens apagadas.`

    );

  }



  if (

    command === 'kick' ||

    command === 'ban'

  ) {

    const permission =

      command === 'kick'

        ? 'moderation.kick'

        : 'moderation.ban';



    if (

      !(await requirePermission(

        interaction.member,

        permission

      ))

    ) {

      return interaction.reply({

        content:

          `âŒ VocÃª nÃ£o possui \`${permission}\`.`,

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



    const member =

      await interaction.guild.members

        .fetch(user.id)

        .catch(() => null);



    if (!member) {

      return interaction.reply({

        content:

          'âŒ Membro nÃ£o encontrado.',

        ephemeral: true

      });

    }



    try {

      if (command === 'kick') {

        await member.kick(reason);

      } else {

        await member.ban({

          reason

        });

      }



      await logModeration(

        interaction.guild.id,

        user.id,

        interaction.user.id,

        command,

        reason

      );



      await sendLog(

        interaction.guild,

        `ðŸ›¡ï¸ **${command.toUpperCase()}**\nUsuÃ¡rio: ${user}\nModerador: ${interaction.user}\nMotivo: ${reason}`

      );



      return interaction.reply({

        content:

          `âœ… ${user.tag} foi ${command === 'kick' ? 'expulso' : 'banido'}.`,

        ephemeral: true

      });

    } catch (e) {

      return interaction.reply({

        content:

          `âŒ NÃ£o foi possÃ­vel executar a aÃ§Ã£o: ${e.message}`,

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

          'âŒ VocÃª precisa ser administrador para usar este comando.',

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

          'âŒ Membro nÃ£o encontrado.',

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

          `âœ… Cargo ${role} ${sub === 'add' ? 'adicionado a' : 'removido de'} ${member}.`,

        ephemeral: true

      });

    } catch (e) {

      return interaction.reply({

        content:

          `âŒ Erro ao gerenciar cargo: ${e.message}`,

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

          'âŒ VocÃª nÃ£o possui `ticket.manage`.',

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

        `ðŸŽ« ${interaction.user}, seu ticket foi criado.\nUse **/close** quando quiser fechÃ¡-lo.`

    });



    return interaction.reply({

      content:

        `âœ… Ticket criado: ${channel}`,

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

          'âŒ VocÃª nÃ£o possui permissÃ£o para fechar este ticket.',

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

        'ðŸ”’ Ticket fechado.'

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

          : 'nÃ£o'

      }`

    );



    await initDB();



    await registerCommands();

    await recoverTempVoiceRooms();
    startRulesAutoRefresh();
    await startRules2AutoRefresh();

    initializeRankCallVoiceSessions();
    syncRankCallVoiceSessionsFromVoiceStates();
    checkpointLocalVoiceSessions();
    startRankCallBackupScheduler();
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
            console.warn('[Voice] Erro na conexÃ£o de voz:', error?.message || error);
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
          console.error('[RankCall] PaginaÃ§Ã£o de horas:', error.message);
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
          console.error('[RankCall] PaginaÃ§Ã£o de sequÃªncias:', error.message);
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

              'âŒ Ocorreu um erro ao processar esta aÃ§Ã£o.',

            ephemeral: true

          });

        } else {

          await interaction.reply({

            content:

              'âŒ Ocorreu um erro ao processar esta aÃ§Ã£o.',

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
      console.warn(`[DM Log] Canal ${DM_LOG_CHANNEL_ID} nÃ£o encontrado ou nÃ£o Ã© de texto.`);
      return true;
    }

    const content = message.content?.trim() || '*Sem texto â€” veja os anexos abaixo.*';
    const attachmentLines = [...message.attachments.values()].map(
      attachment => `ðŸ“Ž [${attachment.name || 'arquivo'}](${attachment.url})`
    );

    const description = [
      `ðŸ‘¤ **UsuÃ¡rio:** ${message.author.tag || message.author.username}`,
      `ðŸ†” **ID:** \`${message.author.id}\``,
      '',
      'ðŸ’¬ **Mensagem:**',
      content,
      attachmentLines.length ? `\n${attachmentLines.join('\n')}` : ''
    ].filter(Boolean).join('\n').slice(0, 4096);

    const embed = new EmbedBuilder()
      .setTitle('ðŸ“© Nova mensagem recebida no PV')
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

          `ðŸ“ Pong! ${client.ws.ping}ms`

        );



        return;

      }



      if (

        content ===

          '!oi'

      ) {

        await message.reply(

          `ðŸ‘‹ OlÃ¡, ${message.author}!`

        );



        return;

      }



      if (

        content ===

          '!regras2'

      ) {
        await refreshRules2Panel(message.guild);
        await message.reply('âœ… Painel de regras 2 publicado/atualizado neste canal.');
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

        const mentioned =

          message.mentions.users.first();



        const target =

          mentioned ||

          message.author;



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
              console.warn('[Voice] Erro na conexÃ£o de voz:', error?.message || error);
              try { voiceConnection?.destroy(); } catch {}
              voiceConnection = null;
            });



            await message.reply(

              `ðŸ”Š Entrei em **${channel.name}**.`

            );

          } catch (e) {

            await message.reply(

              `âŒ Erro ao entrar na call: ${e.message}`

            );

          }

        } else {

          await message.reply(

            'âŒ Entre em um canal de voz primeiro.'

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

            'ðŸ‘‹ SaÃ­ da call.'

          );

        }



        return;

      }



      if (/^!dm(?:\s|$)/i.test(content)) {

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

          await message.reply('âŒ O comando de DM nÃ£o estÃ¡ disponÃ­vel no momento.').catch(() => {});

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

            'âŒ VocÃª nÃ£o possui `match.manage`.'

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

            'âŒ VocÃª precisa ser administrador.'

          );



          return;

        }



        const cloned =

          await message.channel.clone();



        await message.channel.delete();



        await cloned.send(

          'ðŸ’¥ Canal recriado com sucesso.'

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

            'âŒ VocÃª nÃ£o possui `moderation.clear`.'

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

            `ðŸ§¹ ${deleted.size} mensagens apagadas.`

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

            'âŒ VocÃª nÃ£o possui `moderation.ban`.'

          );



          return;

        }



        const user =

          message.mentions.users.first();



        if (!user) {

          await message.reply(

            'âŒ Mencione um usuÃ¡rio.'

          );



          return;

        }



        const member =

          await message.guild.members

            .fetch(user.id)

            .catch(() => null);



        if (!member) {

          await message.reply(

            'âŒ UsuÃ¡rio nÃ£o encontrado.'

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

          `ðŸ”¨ ${user.tag} foi banido.`

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

            'âŒ VocÃª nÃ£o possui `moderation.kick`.'

          );



          return;

        }



        const user =

          message.mentions.users.first();



        if (!user) {

          await message.reply(

            'âŒ Mencione um usuÃ¡rio.'

          );



          return;

        }



        const member =

          await message.guild.members

            .fetch(user.id)

            .catch(() => null);



        if (!member) {

          await message.reply(

            'âŒ UsuÃ¡rio nÃ£o encontrado.'

          );



          return;

        }



        await member.kick(

          'Comando !kick'

        );



        await message.reply(

          `ðŸ‘¢ ${user.tag} foi expulso.`

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

            'ðŸ‘‹ Como posso ajudar?'

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

            `âŒ Erro na IA: ${e.message}`

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

    `ðŸ”Š <@${userId}> possui **${formatHours(seconds)} horas** em call.`

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

              'Bot nÃ£o estÃ¡ em nenhum servidor.'

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

function persistRankCallStateOnShutdown() {
  if (persistenceShutdownStarted) return;
  persistenceShutdownStarted = true;
  try {
    checkpointLocalVoiceSessions();
    saveVoiceHoursLocal();
    saveVoiceSessionsLocal();
    saveRankCallStreaks();
    saveRankCallBackup('shutdown');
  } catch {}
}

process.on('SIGINT', () => {
  persistRankCallStateOnShutdown();
  process.exit(0);
});

process.on('SIGTERM', () => {
  persistRankCallStateOnShutdown();
  process.exit(0);
});

client.login(token);








