const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  EmbedBuilder,
  FileUploadBuilder,
  LabelBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const defaultPanelTitle = 'Painel de Influenciadores';
const defaultPanelDescription =
  'Clique no botão para enviar sua publicação. Informe seus links do TikTok e Instagram e anexe o vídeo no formulário.';
const defaultPanelFooter = 'Publique apenas vídeos que você tem autorização para divulgar.';
const buttonStyles = {
  Primary: ButtonStyle.Primary,
  Secondary: ButtonStyle.Secondary,
  Success: ButtonStyle.Success,
  Danger: ButtonStyle.Danger
};

const commands = [
  new SlashCommandBuilder()
    .setName('painel')
    .setDescription('Envia o painel para publicar vídeos')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('configurar-painel')
    .setDescription('Abre as configurações do painel de influenciadores')
];

function createInfluencerFeature({ client, getDb, configRoleId, postChannelId }) {
  let databaseReady = false;

  function getDatabase() {
    const db = getDb();
    if (!databaseReady || !db) {
      throw new Error('O PostgreSQL do bot ainda não está disponível para o painel de influenciadores.');
    }
    return db;
  }

  async function init() {
    const db = getDb();
    if (!db) {
      console.warn('[Influenciadores] Recurso desativado: configure DATABASE_URL para persistir publicações.');
      return;
    }

    await db.query(`
      CREATE TABLE IF NOT EXISTS influencer_posts (
        id BIGSERIAL PRIMARY KEY,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT,
        author_id TEXT NOT NULL,
        discord_nick TEXT NOT NULL DEFAULT '',
        video_url TEXT NOT NULL,
        video_name TEXT NOT NULL,
        tiktok_url TEXT,
        instagram_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS influencer_likes (
        post_id BIGINT NOT NULL,
        user_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (post_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS influencer_comments (
        id BIGSERIAL PRIMARY KEY,
        post_id BIGINT NOT NULL,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS influencer_guild_settings (
        guild_id TEXT NOT NULL,
        setting_key TEXT NOT NULL,
        setting_value TEXT NOT NULL,
        PRIMARY KEY (guild_id, setting_key)
      );
      CREATE TABLE IF NOT EXISTS influencer_panel_messages (
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        PRIMARY KEY (guild_id, message_id)
      );
      CREATE INDEX IF NOT EXISTS influencer_comments_post_created_idx
        ON influencer_comments (post_id, created_at DESC);
    `);
    databaseReady = true;
  }

  async function getGuildConfig(guildId) {
    const db = getDatabase();
    const result = await db.query(
      'SELECT setting_key, setting_value FROM influencer_guild_settings WHERE guild_id = $1',
      [guildId]
    );
    const settings = Object.fromEntries(
      result.rows.map(row => [row.setting_key, row.setting_value])
    );
    const buttonStyleName = Object.hasOwn(buttonStyles, settings.button_style)
      ? settings.button_style
      : 'Primary';

    return {
      postChannelId: settings.post_channel_id || postChannelId || '',
      panelTitle: settings.panel_title === undefined ? defaultPanelTitle : settings.panel_title,
      panelDescription: settings.panel_description === undefined
        ? defaultPanelDescription
        : settings.panel_description,
      panelColor: settings.panel_color ? Number.parseInt(settings.panel_color, 16) : 0x000000,
      panelBanner: settings.panel_banner || '',
      panelThumbnail: settings.panel_thumbnail || '',
      panelFooter: settings.panel_footer === undefined ? defaultPanelFooter : settings.panel_footer,
      buttonStyle: buttonStyles[buttonStyleName],
      buttonStyleName
    };
  }

  async function setGuildSetting(guildId, key, value) {
    await getDatabase().query(`
      INSERT INTO influencer_guild_settings (guild_id, setting_key, setting_value)
      VALUES ($1, $2, $3)
      ON CONFLICT (guild_id, setting_key)
      DO UPDATE SET setting_value = EXCLUDED.setting_value
    `, [guildId, key, value]);
  }

  function hasConfigPermission(interactionOrMember) {
    const member = interactionOrMember.member || interactionOrMember;
    const roles = member?.roles;
    if (roles?.cache?.has && roles.cache.has(configRoleId)) return true;
    if (Array.isArray(roles) && roles.includes(configRoleId)) return true;
    return Boolean(
      interactionOrMember.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild) ||
      member?.permissions?.has?.(PermissionFlagsBits.ManageGuild)
    );
  }

  function fitsDiscordEmbedTextLimit(title, description, footer) {
    return title.length + description.length + footer.length <= 6000;
  }

  async function registerPanelMessage(guildId, channelId, messageId) {
    await getDatabase().query(`
      INSERT INTO influencer_panel_messages (guild_id, channel_id, message_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (guild_id, message_id) DO NOTHING
    `, [guildId, channelId, messageId]);
  }

  async function createPanelPayload(guildId) {
    const config = await getGuildConfig(guildId);
    const embed = new EmbedBuilder()
      .setColor(config.panelColor)
      .setTitle(config.panelTitle)
      .setDescription(config.panelDescription);
    if (config.panelBanner) embed.setImage(config.panelBanner);
    if (config.panelThumbnail) embed.setThumbnail(config.panelThumbnail);
    if (config.panelFooter) embed.setFooter({ text: config.panelFooter });

    return {
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('influencer:open_publish')
            .setLabel('Publicar vídeo')
            .setStyle(config.buttonStyle)
        )
      ]
    };
  }

  async function sendPanel(channel, guildId) {
    const sent = await channel.send(await createPanelPayload(guildId));
    await registerPanelMessage(guildId, channel.id, sent.id);
    return sent;
  }

  async function trackPanel(channel, guildId) {
    if (!channel?.isTextBased() || !channel.messages) return;
    try {
      const messages = await channel.messages.fetch({ limit: 100 });
      for (const message of messages.values()) {
        const isPanel = message.author.id === client.user.id &&
          message.components.some(row =>
            row.components.some(component => component.customId === 'influencer:open_publish')
          );
        if (isPanel) await registerPanelMessage(guildId, channel.id, message.id);
      }
    } catch (error) {
      console.error('[Influenciadores] Não foi possível localizar painéis antigos:', error);
    }
  }

  async function createConfigDashboardPayload(guildId) {
    const config = await getGuildConfig(guildId);
    const colorNames = {
      Primary: 'Azul',
      Secondary: 'Cinza',
      Success: 'Verde',
      Danger: 'Vermelho'
    };
    return {
      content: [
        '**Configurações do painel de influenciadores**',
        `Título: ${config.panelTitle || '(vazio)'} · Rodapé: ${config.panelFooter || '(vazio)'}`,
        `Botão: ${colorNames[config.buttonStyleName]}`
      ].join('\n'),
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('influencer:config:content')
            .setLabel('Título, descrição e rodapé')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('influencer:config:images')
            .setLabel('Banner e thumbnail')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('influencer:config:channel')
            .setLabel('Canal de publicações')
            .setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('influencer:config:button_style')
            .setPlaceholder('Escolha a cor dos botões')
            .addOptions(
              { label: 'Azul', value: 'Primary' },
              { label: 'Cinza', value: 'Secondary' },
              { label: 'Verde', value: 'Success' },
              { label: 'Vermelho', value: 'Danger' }
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
      .setPlaceholder('Deixe vazio para usar o padrão ou limpar este campo.');
    if (value) input.setValue(value.slice(0, maxLength));
    return new LabelBuilder().setLabel(label).setTextInputComponent(input);
  }

  async function createSettingsModal(kind, guildId) {
    const config = await getGuildConfig(guildId);
    const modal = new ModalBuilder();
    if (kind === 'content') {
      modal.setCustomId('influencer:config_modal:content').setTitle('Texto do painel')
        .addLabelComponents(
          createSettingsTextInput('title', 'Título', config.panelTitle, 256),
          createSettingsTextInput(
            'description',
            'Descrição',
            config.panelDescription,
            4000,
            TextInputStyle.Paragraph
          ),
          createSettingsTextInput('footer', 'Rodapé', config.panelFooter, 2048)
        );
    } else if (kind === 'images') {
      modal.setCustomId('influencer:config_modal:images').setTitle('Imagens do painel')
        .addLabelComponents(
          createSettingsTextInput('banner', 'URL do banner', config.panelBanner, 1000),
          createSettingsTextInput('thumbnail', 'URL da thumbnail', config.panelThumbnail, 1000)
        );
    } else if (kind === 'channel') {
      modal.setCustomId('influencer:config_modal:channel').setTitle('Canal de publicações')
        .addLabelComponents(
          createSettingsTextInput('channel', 'Canal ou ID (vazio remove)', config.postChannelId, 100)
        );
    }
    return modal;
  }

  function isValidSocialUrl(value, host) {
    if (!value) return true;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' &&
        (url.hostname === host || url.hostname.endsWith(`.${host}`));
    } catch {
      return false;
    }
  }

  function isValidHttpsUrl(value) {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }

  function isValidVideoAttachment(attachment) {
    return Boolean(
      attachment.contentType?.startsWith('video/') ||
      /\.(mp4|mov|webm|m4v)$/i.test(attachment.name || '')
    );
  }

  async function getLikeCount(postId) {
    const result = await getDatabase().query(
      'SELECT COUNT(*)::int AS total FROM influencer_likes WHERE post_id = $1',
      [postId]
    );
    return result.rows[0].total;
  }

  async function postButtons(post) {
    const config = await getGuildConfig(post.guild_id);
    const rows = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`influencer:like:${post.id}`)
          .setLabel(String(await getLikeCount(post.id)))
          .setEmoji('❤️')
          .setStyle(config.buttonStyle),
        new ButtonBuilder()
          .setCustomId(`influencer:comment:${post.id}`)
          .setLabel('Comentar')
          .setEmoji('💬')
          .setStyle(config.buttonStyle),
        new ButtonBuilder()
          .setCustomId(`influencer:viewcomments:${post.id}`)
          .setLabel('Ver comentários')
          .setEmoji('🗨️')
          .setStyle(config.buttonStyle),
        new ButtonBuilder()
          .setCustomId(`influencer:viewlikes:${post.id}`)
          .setLabel('Ver curtidas')
          .setEmoji('👥')
          .setStyle(config.buttonStyle)
      )
    ];
    const socials = [];
    if (post.instagram_url) {
      socials.push(
        new ButtonBuilder()
          .setLabel('Instagram')
          .setEmoji('📸')
          .setStyle(ButtonStyle.Link)
          .setURL(post.instagram_url)
      );
    }
    if (post.tiktok_url) {
      socials.push(
        new ButtonBuilder()
          .setLabel('TikTok')
          .setEmoji('🎵')
          .setStyle(ButtonStyle.Link)
          .setURL(post.tiktok_url)
      );
    }
    if (socials.length) rows.push(new ActionRowBuilder().addComponents(...socials));
    return rows;
  }

  async function createPostComponents(post, videoUrl) {
    const discordNick = (post.discord_nick || `<@${post.author_id}>`)
      .replace(/[\r\n]/g, ' ')
      .replace(/@everyone|@here/g, '@​$&');
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
      .addActionRowComponents(...await postButtons(post));

    return [
      new TextDisplayBuilder().setContent(`Nova publicação de <@${post.author_id}>`),
      card
    ];
  }

  async function refreshPost(postId) {
    const db = getDatabase();
    const result = await db.query('SELECT * FROM influencer_posts WHERE id = $1', [postId]);
    const post = result.rows[0];
    if (!post?.message_id) return;

    try {
      const channel = await client.channels.fetch(post.channel_id);
      if (!channel?.isTextBased()) return;
      const message = await channel.messages.fetch(post.message_id);
      if (message.flags.has(MessageFlags.IsComponentsV2)) {
        const attachment = message.attachments.first();
        await message.edit({
          flags: MessageFlags.IsComponentsV2,
          components: await createPostComponents(
            post,
            attachment ? `attachment://${attachment.name}` : post.video_url
          ),
          attachments: [...message.attachments.values()],
          allowedMentions: { parse: [] }
        });
      }
    } catch (error) {
      console.error(`[Influenciadores] Não foi possível atualizar a publicação ${postId}:`, error);
    }
  }

  async function refreshGuildConfiguration(guildId) {
    const db = getDatabase();
    const panelResult = await db.query(
      'SELECT channel_id, message_id FROM influencer_panel_messages WHERE guild_id = $1',
      [guildId]
    );
    for (const panel of panelResult.rows) {
      try {
        const channel = await client.channels.fetch(panel.channel_id);
        if (!channel?.isTextBased()) throw new Error('Canal do painel indisponível.');
        const message = await channel.messages.fetch(panel.message_id);
        await message.edit(await createPanelPayload(guildId));
      } catch (error) {
        console.error(
          `[Influenciadores] Não foi possível atualizar o painel ${panel.message_id}:`,
          error
        );
      }
    }

    const posts = await db.query(
      'SELECT id FROM influencer_posts WHERE guild_id = $1',
      [guildId]
    );
    for (const post of posts.rows) await refreshPost(post.id);
  }

  async function getLikesPagePayload(postId, requestedPage = 0) {
    const db = getDatabase();
    const result = await db.query(
      'SELECT user_id FROM influencer_likes WHERE post_id = $1 ORDER BY created_at, user_id',
      [postId]
    );
    const likes = result.rows;
    const pageSize = 50;
    const pageCount = Math.max(1, Math.ceil(likes.length / pageSize));
    const page = Math.min(Math.max(requestedPage, 0), pageCount - 1);
    const pageLikes = likes.slice(page * pageSize, (page + 1) * pageSize);
    const embed = new EmbedBuilder()
      .setColor(0x000000)
      .setTitle(`❤️ Quem curtiu (${likes.length})`)
      .setDescription(
        pageLikes.length
          ? pageLikes.map(like => `• <@${like.user_id}>`).join('\n')
          : 'Ainda ninguém curtiu esta publicação.'
      )
      .setFooter({
        text: pageCount > 1
          ? `Página ${page + 1} de ${pageCount}. As menções não enviam notificações.`
          : 'As menções não enviam notificações.'
      });

    const components = pageCount > 1
      ? [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`influencer:likespage:${postId}:${page - 1}`)
              .setLabel('Anterior')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(page === 0),
            new ButtonBuilder()
              .setCustomId(`influencer:likespage:${postId}:${page + 1}`)
              .setLabel('Próxima')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(page === pageCount - 1)
          )
        ]
      : [];
    return { embeds: [embed], components };
  }

  async function getPost(postId) {
    const result = await getDatabase().query(
      'SELECT * FROM influencer_posts WHERE id = $1',
      [postId]
    );
    return result.rows[0] || null;
  }

  async function replyDatabaseUnavailable(interaction) {
    const content = 'O painel de influenciadores precisa do PostgreSQL. Configure DATABASE_URL no serviço do bot no Render.';
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content, ephemeral: true });
    }
  }

  async function handlePublishModal(interaction) {
    const tiktokUrl = interaction.fields.getTextInputValue('tiktok').trim();
    const instagramUrl = interaction.fields.getTextInputValue('instagram').trim();
    if (!isValidSocialUrl(tiktokUrl, 'tiktok.com')) {
      await interaction.reply({ content: 'O link do TikTok não parece válido.', ephemeral: true });
      return;
    }
    if (!isValidSocialUrl(instagramUrl, 'instagram.com')) {
      await interaction.reply({ content: 'O link do Instagram não parece válido.', ephemeral: true });
      return;
    }

    const attachment = interaction.fields.getUploadedFiles('video')?.first();
    if (!attachment || !isValidVideoAttachment(attachment)) {
      await interaction.reply({
        content: 'Anexe um vídeo válido nos formatos MP4, MOV, WEBM ou M4V.',
        ephemeral: true
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    let postId;
    let sentMessageId;
    try {
      const config = await getGuildConfig(interaction.guildId);
      if (!config.postChannelId) {
        await interaction.editReply(
          'Nenhum canal de publicações foi configurado. Use `/configurar-painel` para escolher um.'
        );
        return;
      }

      const postChannel = await client.channels.fetch(config.postChannelId);
      if (!postChannel?.isTextBased()) {
        await interaction.editReply('O canal de publicações configurado não foi encontrado.');
        return;
      }

      const videoResponse = await fetch(attachment.url);
      if (!videoResponse.ok) throw new Error(`Download do vídeo falhou com HTTP ${videoResponse.status}.`);
      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
      const discordNick = interaction.member?.displayName ||
        interaction.member?.nick ||
        interaction.user.globalName ||
        interaction.user.username;
      const videoName = attachment.name || 'video.mp4';
      const insert = await getDatabase().query(`
        INSERT INTO influencer_posts
          (guild_id, channel_id, author_id, discord_nick, video_url, video_name, tiktok_url, instagram_url)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, [
        interaction.guildId,
        postChannel.id,
        interaction.user.id,
        discordNick,
        attachment.url,
        videoName,
        tiktokUrl || null,
        instagramUrl || null
      ]);
      const post = insert.rows[0];
      postId = post.id;

      const sent = await postChannel.send({
        flags: MessageFlags.IsComponentsV2,
        components: await createPostComponents(post, `attachment://${videoName}`),
        files: [new AttachmentBuilder(videoBuffer, { name: videoName })],
        allowedMentions: { users: [interaction.user.id] }
      });
      sentMessageId = sent.id;
      await getDatabase().query(
        'UPDATE influencer_posts SET message_id = $1 WHERE id = $2',
        [sent.id, postId]
      );
      await interaction.editReply('Seu vídeo foi publicado com sucesso! 🎉');
    } catch (error) {
      if (postId && !sentMessageId) {
        await getDatabase().query('DELETE FROM influencer_posts WHERE id = $1', [postId])
          .catch(cleanupError => {
            console.error('[Influenciadores] Falha ao remover publicação incompleta:', cleanupError);
          });
      } else if (postId && sentMessageId) {
        await getDatabase().query(
          'UPDATE influencer_posts SET message_id = $1 WHERE id = $2',
          [sentMessageId, postId]
        ).catch(persistError => {
          console.error('[Influenciadores] Não foi possível vincular a publicação enviada ao banco:', persistError);
        });
      }
      console.error('[Influenciadores] Erro ao publicar vídeo:', error);
      await interaction.editReply(
        'Não consegui publicar o vídeo. Verifique as permissões e o limite de tamanho do Discord.'
      );
    }
  }

  async function handleInteraction(interaction) {
    const isInfluencerCommand = interaction.isChatInputCommand() &&
      ['painel', 'configurar-painel'].includes(interaction.commandName);
    const isInfluencerComponent = (
      interaction.isButton() ||
      interaction.isModalSubmit() ||
      interaction.isStringSelectMenu()
    ) && interaction.customId.startsWith('influencer:');
    if (!isInfluencerCommand && !isInfluencerComponent) return false;

    if (!databaseReady) {
      await replyDatabaseUnavailable(interaction);
      return true;
    }

    if (interaction.isChatInputCommand()) {
      if (!interaction.inGuild()) {
        await interaction.reply({ content: 'Use este comando em um servidor.', ephemeral: true });
        return true;
      }
      if (interaction.commandName === 'painel') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
          await interaction.reply({ content: 'Somente administradores podem usar este comando.', ephemeral: true });
          return true;
        }
        await interaction.reply({ content: 'Painel enviado.', ephemeral: true });
        await sendPanel(interaction.channel, interaction.guildId);
        return true;
      }
      if (interaction.commandName === 'configurar-painel') {
        if (!hasConfigPermission(interaction)) {
          await interaction.reply({
            content: 'Somente o cargo autorizado ou um gerente do servidor pode alterar as configurações.',
            ephemeral: true
          });
          return true;
        }
        await trackPanel(interaction.channel, interaction.guildId);
        await interaction.reply({
          ...await createConfigDashboardPayload(interaction.guildId),
          ephemeral: true
        });
        return true;
      }
    }

    if (interaction.isButton() && interaction.customId === 'influencer:open_publish') {
      if (!interaction.inGuild()) {
        await interaction.reply({ content: 'Use este painel em um servidor.', ephemeral: true });
        return true;
      }
      await registerPanelMessage(interaction.guildId, interaction.channelId, interaction.message.id);
      const modal = new ModalBuilder()
        .setCustomId('influencer:publish_modal')
        .setTitle('Enviar publicação');
      const tiktok = new TextInputBuilder()
        .setCustomId('tiktok')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(300)
        .setPlaceholder('https://www.tiktok.com/@usuario/video/...');
      const instagram = new TextInputBuilder()
        .setCustomId('instagram')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(300)
        .setPlaceholder('https://www.instagram.com/...');
      const video = new FileUploadBuilder()
        .setCustomId('video')
        .setRequired(true)
        .setMinValues(1)
        .setMaxValues(1);
      modal.addLabelComponents(
        new LabelBuilder().setLabel('Link do TikTok (opcional)').setTextInputComponent(tiktok),
        new LabelBuilder().setLabel('Link do Instagram (opcional)').setTextInputComponent(instagram),
        new LabelBuilder()
          .setLabel('Vídeo')
          .setDescription('Anexe um vídeo MP4, MOV, WEBM ou M4V.')
          .setFileUploadComponent(video)
      );
      await interaction.showModal(modal);
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith('influencer:config:')) {
      if (!interaction.inGuild() || !hasConfigPermission(interaction)) {
        await interaction.reply({
          content: 'Somente o cargo autorizado ou um gerente do servidor pode alterar as configurações.',
          ephemeral: true
        });
        return true;
      }
      const kind = interaction.customId.slice('influencer:config:'.length);
      if (kind === 'button_style') return true;
      if (!['content', 'images', 'channel'].includes(kind)) return true;
      await interaction.showModal(await createSettingsModal(kind, interaction.guildId));
      return true;
    }

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === 'influencer:config:button_style'
    ) {
      if (!interaction.inGuild() || !hasConfigPermission(interaction)) {
        await interaction.reply({
          content: 'Somente o cargo autorizado ou um gerente do servidor pode alterar as configurações.',
          ephemeral: true
        });
        return true;
      }
      const style = interaction.values[0];
      if (!Object.hasOwn(buttonStyles, style)) {
        await interaction.reply({ content: 'A cor selecionada não é válida.', ephemeral: true });
        return true;
      }
      await interaction.deferUpdate();
      await setGuildSetting(interaction.guildId, 'button_style', style);
      await refreshGuildConfiguration(interaction.guildId);
      await interaction.editReply(await createConfigDashboardPayload(interaction.guildId));
      return true;
    }

    if (
      interaction.isModalSubmit() &&
      interaction.customId === 'influencer:publish_modal'
    ) {
      await handlePublishModal(interaction);
      return true;
    }

    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith('influencer:config_modal:')
    ) {
      if (!interaction.inGuild() || !hasConfigPermission(interaction)) {
        await interaction.reply({
          content: 'Somente o cargo autorizado ou um gerente do servidor pode alterar as configurações.',
          ephemeral: true
        });
        return true;
      }
      const kind = interaction.customId.slice('influencer:config_modal:'.length);
      await interaction.deferReply({ ephemeral: true });
      if (kind === 'content') {
        const title = interaction.fields.getTextInputValue('title').trim();
        const description = interaction.fields.getTextInputValue('description').trim();
        const footer = interaction.fields.getTextInputValue('footer').trim();
        const nextTitle = title || defaultPanelTitle;
        const nextDescription = description || defaultPanelDescription;
        if (!fitsDiscordEmbedTextLimit(nextTitle, nextDescription, footer)) {
          await interaction.editReply(
            'O título, a descrição e o rodapé juntos não podem ultrapassar 6.000 caracteres.'
          );
          return true;
        }
        await setGuildSetting(interaction.guildId, 'panel_title', nextTitle);
        await setGuildSetting(interaction.guildId, 'panel_description', nextDescription);
        await setGuildSetting(interaction.guildId, 'panel_footer', footer);
      } else if (kind === 'images') {
        const banner = interaction.fields.getTextInputValue('banner').trim();
        const thumbnail = interaction.fields.getTextInputValue('thumbnail').trim();
        if ((banner && !isValidHttpsUrl(banner)) || (thumbnail && !isValidHttpsUrl(thumbnail))) {
          await interaction.editReply('Banner e thumbnail precisam ser URLs HTTPS válidas.');
          return true;
        }
        await setGuildSetting(interaction.guildId, 'panel_banner', banner);
        await setGuildSetting(interaction.guildId, 'panel_thumbnail', thumbnail);
      } else if (kind === 'channel') {
        const value = interaction.fields.getTextInputValue('channel').trim();
        if (value) {
          const channelId = value.match(/^<#(\d+)>$/)?.[1] || value;
          if (!/^\d{17,20}$/.test(channelId)) {
            await interaction.editReply('Informe a menção ou o ID de um canal de texto válido.');
            return true;
          }
          const channel = await interaction.guild.channels.fetch(channelId);
          if (!channel?.isTextBased()) {
            await interaction.editReply('O canal informado não existe ou não aceita mensagens.');
            return true;
          }
          await setGuildSetting(interaction.guildId, 'post_channel_id', channel.id);
        } else {
          await getDatabase().query(`
            DELETE FROM influencer_guild_settings
            WHERE guild_id = $1 AND setting_key = 'post_channel_id'
          `, [interaction.guildId]);
        }
      } else {
        await interaction.editReply('Essa opção de configuração não é válida.');
        return true;
      }

      await refreshGuildConfiguration(interaction.guildId);
      await interaction.editReply('Configuração salva e aplicada às mensagens existentes.');
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith('influencer:')) {
      const [, action, postIdText, pageText] = interaction.customId.split(':');
      const postId = Number(postIdText);
      if (!Number.isSafeInteger(postId) || postId < 1) {
        await interaction.reply({ content: 'Essa publicação não é válida.', ephemeral: true });
        return true;
      }
      const post = await getPost(postId);
      if (!post) {
        await interaction.reply({ content: 'Essa publicação não foi encontrada.', ephemeral: true });
        return true;
      }

      if (action === 'viewlikes' || action === 'likespage') {
        const page = action === 'likespage' ? Number(pageText) : 0;
        if (!Number.isInteger(page) || page < 0) {
          await interaction.reply({ content: 'Essa página de curtidas não é válida.', ephemeral: true });
          return true;
        }
        const payload = {
          ...await getLikesPagePayload(postId, page),
          allowedMentions: { parse: [] }
        };
        if (action === 'likespage') await interaction.update(payload);
        else await interaction.reply({ ...payload, ephemeral: true });
        return true;
      }

      if (action === 'like') {
        const db = getDatabase();
        const existing = await db.query(
          'SELECT 1 FROM influencer_likes WHERE post_id = $1 AND user_id = $2',
          [postId, interaction.user.id]
        );
        if (existing.rowCount) {
          await db.query(
            'DELETE FROM influencer_likes WHERE post_id = $1 AND user_id = $2',
            [postId, interaction.user.id]
          );
        } else {
          await db.query(`
            INSERT INTO influencer_likes (post_id, user_id)
            VALUES ($1, $2)
            ON CONFLICT (post_id, user_id) DO NOTHING
          `, [postId, interaction.user.id]);
        }
        await refreshPost(postId);
        await interaction.reply({
          content: existing.rowCount ? 'Você removeu sua curtida.' : 'Você curtiu esta publicação! ❤️',
          ephemeral: true
        });
        return true;
      }

      if (action === 'comment') {
        const modal = new ModalBuilder()
          .setCustomId(`influencer:comment_modal:${postId}`)
          .setTitle('Adicionar comentário');
        const input = new TextInputBuilder()
          .setCustomId('comment_text')
          .setLabel('Escreva seu comentário')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(800)
          .setPlaceholder('Digite seu comentário...');
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        return true;
      }

      if (action === 'viewcomments') {
        const result = await getDatabase().query(`
          SELECT user_id, content, created_at
          FROM influencer_comments
          WHERE post_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT 10
        `, [postId]);
        const comments = result.rows.reverse();
        if (!comments.length) {
          await interaction.reply({
            content: 'Ainda não há comentários nesta publicação.',
            ephemeral: true
          });
          return true;
        }
        const description = comments.map(comment =>
          `**<@${comment.user_id}>**\n${comment.content.replace(/@everyone|@here/g, '@​$&')}`
        ).join('\n\n').slice(0, 4000);
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x000000)
              .setTitle(`💬 Comentários da publicação #${postId}`)
              .setDescription(description)
              .setFooter({ text: 'Mostrando os 10 comentários mais recentes.' })
          ],
          allowedMentions: { parse: [] },
          ephemeral: true
        });
        return true;
      }
    }

    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith('influencer:comment_modal:')
    ) {
      const postId = Number(interaction.customId.split(':')[2]);
      if (!Number.isSafeInteger(postId) || !await getPost(postId)) {
        await interaction.reply({ content: 'Essa publicação não foi encontrada.', ephemeral: true });
        return true;
      }
      const content = interaction.fields.getTextInputValue('comment_text').trim();
      if (!content) {
        await interaction.reply({ content: 'O comentário não pode ficar vazio.', ephemeral: true });
        return true;
      }
      await getDatabase().query(
        'INSERT INTO influencer_comments (post_id, user_id, content) VALUES ($1, $2, $3)',
        [postId, interaction.user.id, content]
      );
      await refreshPost(postId);
      await interaction.reply({ content: 'Comentário publicado! 💬', ephemeral: true });
      return true;
    }

    return true;
  }

  async function handleMessage(message) {
    const match = message.content.match(/^!painel(?:\s+([\s\S]*))?$/i);
    if (!match) return false;
    if (!databaseReady) {
      await message.reply(
        'O painel de influenciadores precisa do PostgreSQL. Configure DATABASE_URL no serviço do bot no Render.'
      );
      return true;
    }
    if (match[1]?.trim()) {
      await message.reply('Use `/configurar-painel` para configurar o painel.');
      return true;
    }
    if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
      await message.reply('Somente administradores podem usar este comando.');
      return true;
    }
    await sendPanel(message.channel, message.guild.id);
    await message.reply('Painel enviado.');
    return true;
  }

  return { init, handleInteraction, handleMessage };
}

module.exports = { commands, createInfluencerFeature };
