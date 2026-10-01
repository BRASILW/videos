const { Connectors, Shoukaku } = require('shoukaku');

const MAX_QUEUE_SIZE = 100;
const MAX_PLAYLIST_SIZE = 50;
const DEFAULT_VOLUME = 70;

function formatTrackDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return 'Ao vivo';
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function tracksFromResult(result) {
  if (!result || result.loadType === 'empty') return [];
  if (result.loadType === 'error') {
    throw new Error(result.data?.message || 'O servidor de música não conseguiu carregar essa faixa.');
  }
  if (result.loadType === 'track') return [result.data];
  if (result.loadType === 'search') return result.data || [];
  if (result.loadType === 'playlist') return result.data?.tracks || [];
  return [];
}

function shuffleItems(items, random = Math.random) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function nodeAddress(host, port) {
  const normalizedHost = host
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^wss?:\/\//i, '')
    .replace(/\/+$/, '');
  return normalizedHost.includes(':') ? normalizedHost : `${normalizedHost}:${port}`;
}

class MusicController {
  constructor(client, env = process.env) {
    this.client = client;
    this.queues = new Map();
    this.manager = null;

    const host = env.LAVALINK_HOST?.trim();
    const password = env.LAVALINK_PASSWORD?.trim();
    if (!host || !password) {
      console.warn('[Music] Lavalink não configurado; comandos de música ficam indisponíveis.');
      return;
    }

    const port = Number(env.LAVALINK_PORT || 2333);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('LAVALINK_PORT deve ser um número entre 1 e 65535.');
    }

    const secure = String(env.LAVALINK_SECURE || '').toLowerCase() === 'true';
    this.searchPrefix = env.LAVALINK_SEARCH_PREFIX?.trim() || 'ytsearch:';
    this.manager = new Shoukaku(
      new Connectors.DiscordJS(client),
      [{
        name: 'primary',
        url: nodeAddress(host, port),
        auth: password,
        secure
      }],
      {
        resume: true,
        resumeTimeout: 60,
        reconnectTries: 10,
        reconnectInterval: 5
      }
    );

    this.manager.on('ready', name => {
      console.log(`[Music] Nó Lavalink conectado: ${name}`);
    });
    this.manager.on('error', (name, error) => {
      console.error(`[Music] Erro no nó Lavalink ${name}:`, error.message);
    });
    this.manager.on('close', (name, code, reason) => {
      console.warn(`[Music] Nó Lavalink ${name} desconectado (${code}): ${reason}`);
    });
  }

  getState(guildId) {
    let state = this.queues.get(guildId);
    if (!state) {
      state = {
        queue: [],
        current: null,
        player: null,
        voiceChannelId: null,
        textChannelId: null,
        volume: DEFAULT_VOLUME,
        stopping: false
      };
      this.queues.set(guildId, state);
    }
    return state;
  }

  async notify(state, content) {
    if (!state.textChannelId) return;
    const channel = await this.client.channels.fetch(state.textChannelId).catch(() => null);
    if (channel?.isTextBased()) {
      await channel.send({ content, allowedMentions: { parse: [] } }).catch(error => {
        console.warn('[Music] Não foi possível enviar atualização da fila:', error.message);
      });
    }
  }

  async startNext(guildId, state, notifyPlayback = true) {
    if (state.current || state.stopping) return false;
    const next = state.queue.shift();
    if (!next) {
      state.textChannelId = null;
      return false;
    }

    state.current = next;
    try {
      await state.player.setGlobalVolume(state.volume);
      await state.player.playTrack({ track: { encoded: next.track.encoded } });
      if (notifyPlayback) {
        await this.notify(state, `▶️ Tocando **${next.track.info.title}** — pedido por <@${next.requesterId}>.`);
      }
      return true;
    } catch (error) {
      state.current = null;
      await this.notify(state, `❌ Não consegui iniciar **${next.track.info.title}**: ${error.message}`);
      return this.startNext(guildId, state, notifyPlayback);
    }
  }

  attachPlayer(guildId, state, player) {
    state.player = player;
    player.on('end', async event => {
      if (state.stopping) {
        state.stopping = false;
        state.current = null;
        await this.manager.leaveVoiceChannel(guildId).catch(error => {
          console.warn(`[Music] Não foi possível sair do canal de voz: ${error.message}`);
        });
        this.queues.delete(guildId);
        return;
      }

      if (event.reason === 'finished' || event.reason === 'loadFailed' || event.reason === 'stopped') {
        state.current = null;
        await this.startNext(guildId, state);
      }
    });
    player.on('exception', event => {
      console.error(`[Music] Erro ao tocar faixa em ${guildId}:`, event.exception?.message || 'erro desconhecido');
    });
    player.on('stuck', event => {
      console.warn(`[Music] Faixa travada em ${guildId} por ${event.thresholdMs}ms.`);
    });
  }

  async run(context, action, value) {
    const { guild, member, user, send } = context;
    if (!guild) return send('❌ Os comandos de música só funcionam dentro de um servidor.');
    if (!this.manager) {
      return send('🎵 O player ainda não está configurado. Defina `LAVALINK_HOST`, `LAVALINK_PORT` e `LAVALINK_PASSWORD` no serviço do bot.');
    }

    const state = this.queues.get(guild.id);
    if (action === 'play') {
      const query = String(value || '').trim();
      if (!query) return send('Use `!play <nome ou link da música>` ou `/play`.');
      if (query.length > 500) return send('❌ A busca/link é muito longo.');
      const voiceChannel = member?.voice?.channel;
      if (!voiceChannel) return send('❌ Entre em um canal de voz antes de pedir uma música.');

      let currentState = state || this.getState(guild.id);
      if (currentState.player && currentState.voiceChannelId !== voiceChannel.id) {
        return send(`❌ Já estou tocando em <#${currentState.voiceChannelId}>.`);
      }

      try {
        const node = currentState.player?.node || this.manager.getIdealNode();
        if (!node) throw new Error('Nenhum nó Lavalink está conectado.');
        const identifier = /^https?:\/\//i.test(query) ? query : `${this.searchPrefix}${query}`;
        const result = await node.rest.resolve(identifier);
        const tracks = tracksFromResult(result);
        if (!tracks.length) return send('🔎 Não encontrei nenhuma música para essa busca.');

        const addedTracks = tracks.slice(0, MAX_PLAYLIST_SIZE);
        if (currentState.queue.length + addedTracks.length > MAX_QUEUE_SIZE) {
          return send(`❌ A fila aceita no máximo ${MAX_QUEUE_SIZE} músicas.`);
        }

        const player = currentState.player || await this.manager.joinVoiceChannel({
          guildId: guild.id,
          channelId: voiceChannel.id,
          shardId: guild.shardId,
          deaf: true
        });
        if (!currentState.player) {
          currentState.voiceChannelId = voiceChannel.id;
          this.attachPlayer(guild.id, currentState, player);
        }

        for (const track of addedTracks) {
          currentState.queue.push({
            track,
            requesterId: user.id
          });
        }
        currentState.textChannelId = context.textChannelId;

        if (!currentState.current) {
          const started = await this.startNext(guild.id, currentState, false);
          if (started && currentState.current) {
            const nowPlaying = `▶️ Tocando **${currentState.current.track.info.title}**.`;
            const remaining = currentState.queue.length
              ? ` Mais ${currentState.queue.length} música(s) adicionada(s) à fila.`
              : '';
            return send(nowPlaying + remaining);
          }
          return send('❌ A busca foi adicionada, mas nenhuma faixa conseguiu iniciar.');
        } else if (addedTracks.length === 1) {
          await send(`➕ Adicionada à fila: **${addedTracks[0].info.title}**.`);
        } else {
          await send(`➕ Adicionadas **${addedTracks.length}** músicas à fila.`);
        }
      } catch (error) {
        console.error('[Music] Falha no comando play:', error);
        await send(`❌ Não consegui carregar a música. Verifique o Lavalink e os plugins de fontes: ${error.message}`);
      }
      return;
    }

    if (!state?.player) return send('🎵 Não há player ativo neste servidor.');
    const memberVoiceChannelId = member?.voice?.channelId;
    if (!memberVoiceChannelId || memberVoiceChannelId !== state.voiceChannelId) {
      return send(`❌ Entre em <#${state.voiceChannelId}> para controlar a música.`);
    }

    try {
      if (action === 'pause' || action === 'resume') {
        if (!state.current) return send('🎵 Não há música tocando agora.');
        const paused = action === 'pause';
        await state.player.setPaused(paused);
        return send(paused ? '⏸️ Música pausada.' : '▶️ Música retomada.');
      }

      if (action === 'skip') {
        if (!state.current) return send('🎵 Não há música tocando agora.');
        await send('⏭️ Pulando para a próxima música.');
        await state.player.stopTrack();
        return;
      }

      if (action === 'stop') {
        state.queue = [];
        if (!state.current) {
          await this.manager.leaveVoiceChannel(guild.id);
          this.queues.delete(guild.id);
          return send('⏹️ Reprodução encerrada e fila limpa.');
        }
        state.stopping = true;
        await state.player.stopTrack();
        return send('⏹️ Reprodução encerrada e fila limpa.');
      }

      if (action === 'queue') {
        const lines = state.queue.slice(0, 10).map((item, index) =>
          `**${index + 1}.** ${item.track.info.title} (${formatTrackDuration(item.track.info.length)})`
        );
        const nowPlaying = state.current
          ? `▶️ **Tocando:** ${state.current.track.info.title} (${formatTrackDuration(state.current.track.info.length)})`
          : '⏹️ Nada tocando agora.';
        return send([nowPlaying, ...lines, state.queue.length > lines.length ? `… e mais ${state.queue.length - lines.length} na fila.` : '']
          .filter(Boolean)
          .join('\n'));
      }

      if (action === 'volume') {
        const volume = Number(value);
        if (!Number.isInteger(volume) || volume < 1 || volume > 100) {
          return send('❌ Informe um volume inteiro entre 1 e 100.');
        }
        state.volume = volume;
        await state.player.setGlobalVolume(volume);
        return send(`🔊 Volume ajustado para **${volume}%**.`);
      }

      if (action === 'shuffle') {
        if (state.queue.length < 2) return send('❌ Adicione pelo menos duas músicas antes de embaralhar.');
        shuffleItems(state.queue);
        return send('🔀 Fila embaralhada.');
      }
    } catch (error) {
      console.error(`[Music] Falha no comando ${action}:`, error);
      await send(`❌ Não consegui executar o comando de música: ${error.message}`);
    }
  }

  async handlePrefix(message, action) {
    const args = message.content.trim().split(/\s+/).slice(1);
    const value = action === 'play' ? args.join(' ') : args[0];
    return this.run({
      guild: message.guild,
      member: message.member,
      user: message.author,
      textChannelId: message.channel.id,
      send: content => message.channel.send({ content, allowedMentions: { parse: [] } })
    }, action, value);
  }

  async handleInteraction(interaction) {
    const member = interaction.guild
      ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null)
      : null;
    await interaction.deferReply({ ephemeral: true });
    const value = interaction.commandName === 'play'
      ? interaction.options.getString('busca')
      : interaction.commandName === 'volume'
        ? interaction.options.getInteger('nivel')
        : undefined;
    return this.run({
      guild: interaction.guild,
      member,
      user: interaction.user,
      textChannelId: interaction.channelId,
      send: content => interaction.editReply({ content, allowedMentions: { parse: [] } })
    }, interaction.commandName, value);
  }
}

module.exports = {
  MusicController,
  formatTrackDuration,
  nodeAddress,
  shuffleItems,
  tracksFromResult
};
