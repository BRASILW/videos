const assert = require('node:assert/strict');
const test = require('node:test');
const { createInfluencerFeature } = require('./influencers');

test('!painel sends and records the panel when PostgreSQL is ready', async () => {
  const queries = [];
  const db = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes('SELECT setting_key, setting_value')) return { rows: [] };
      return { rows: [], rowCount: 1 };
    }
  };
  const sentPanels = [];
  const replies = [];
  const feature = createInfluencerFeature({
    client: { user: { id: 'bot-id' } },
    getDb: () => db,
    configRoleId: 'config-role'
  });
  const channel = {
    id: 'channel-id',
    async send(payload) {
      sentPanels.push(payload);
      return { id: 'panel-message-id' };
    }
  };
  const message = {
    content: '!painel',
    member: { permissions: { has: () => true } },
    guild: { id: 'guild-id' },
    channel,
    async reply(content) {
      replies.push(content);
    }
  };

  await feature.init();
  assert.equal(await feature.handleMessage(message), true);
  assert.equal(sentPanels.length, 1);
  assert.equal(sentPanels[0].embeds.length, 1);
  assert.ok(queries.some(sql => sql.includes('INSERT INTO influencer_panel_messages')));
  assert.deepEqual(replies, ['Painel enviado.']);
});

test('!painel explains that PostgreSQL is required when the database is unavailable', async () => {
  const replies = [];
  const feature = createInfluencerFeature({
    client: {},
    getDb: () => null,
    configRoleId: 'config-role'
  });
  const message = {
    content: '!painel',
    async reply(content) {
      replies.push(content);
    }
  };

  await feature.init();
  assert.equal(await feature.handleMessage(message), true);
  assert.match(replies[0], /PostgreSQL/);
});

test('the publish button opens a modal that accepts a video attachment', async () => {
  const db = {
    async query() {
      return { rows: [], rowCount: 1 };
    }
  };
  let modal;
  const feature = createInfluencerFeature({
    client: { user: { id: 'bot-id' } },
    getDb: () => db,
    configRoleId: 'config-role'
  });
  const interaction = {
    customId: 'influencer:open_publish',
    isButton: () => true,
    isModalSubmit: () => false,
    isStringSelectMenu: () => false,
    isChatInputCommand: () => false,
    inGuild: () => true,
    guildId: 'guild-id',
    channelId: 'channel-id',
    message: { id: 'panel-message-id' },
    async showModal(value) {
      modal = value;
    }
  };

  await feature.init();
  assert.equal(await feature.handleInteraction(interaction), true);
  const modalJson = modal.toJSON();
  assert.equal(modalJson.custom_id, 'influencer:publish_modal');
  assert.ok(JSON.stringify(modalJson).includes('video'));
});

test('a valid video modal submission posts a Components V2 publication', async t => {
  const previousFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async arrayBuffer() {
      return Uint8Array.from([1, 2, 3]).buffer;
    }
  });
  t.after(() => {
    global.fetch = previousFetch;
  });

  const queries = [];
  const post = {
    id: '1',
    guild_id: 'guild-id',
    channel_id: 'post-channel-id',
    author_id: 'user-id',
    discord_nick: 'Member',
    video_url: 'https://cdn.discordapp.com/attachment.mp4',
    video_name: 'clip.mp4',
    tiktok_url: null,
    instagram_url: null
  };
  const db = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes('SELECT setting_key, setting_value')) return { rows: [] };
      if (sql.includes('INSERT INTO influencer_posts')) return { rows: [post], rowCount: 1 };
      if (sql.includes('SELECT COUNT(*)::int')) return { rows: [{ total: 0 }] };
      return { rows: [], rowCount: 1 };
    }
  };
  let sentPayload;
  const postChannel = {
    id: 'post-channel-id',
    isTextBased: () => true,
    async send(payload) {
      sentPayload = payload;
      return { id: 'post-message-id' };
    }
  };
  const replies = [];
  const feature = createInfluencerFeature({
    client: {
      user: { id: 'bot-id' },
      channels: {
        async fetch() {
          return postChannel;
        }
      }
    },
    getDb: () => db,
    configRoleId: 'config-role',
    postChannelId: 'post-channel-id'
  });
  const interaction = {
    customId: 'influencer:publish_modal',
    isButton: () => false,
    isModalSubmit: () => true,
    isStringSelectMenu: () => false,
    isChatInputCommand: () => false,
    inGuild: () => true,
    guildId: 'guild-id',
    user: { id: 'user-id', username: 'member' },
    member: { displayName: 'Member' },
    fields: {
      getTextInputValue: () => '',
      getUploadedFiles: () => ({
        first: () => ({
          url: 'https://cdn.discordapp.com/attachment.mp4',
          name: 'clip.mp4',
          contentType: 'video/mp4'
        })
      })
    },
    async deferReply() {},
    async editReply(content) {
      replies.push(content);
    }
  };

  await feature.init();
  assert.equal(await feature.handleInteraction(interaction), true);
  assert.equal(sentPayload.flags, require('discord.js').MessageFlags.IsComponentsV2);
  assert.equal(sentPayload.files.length, 1);
  assert.equal(sentPayload.components.length, 2);
  assert.ok(queries.some(sql => sql.includes('UPDATE influencer_posts SET message_id')));
  assert.deepEqual(replies, ['Seu vídeo foi publicado com sucesso! 🎉']);
});
