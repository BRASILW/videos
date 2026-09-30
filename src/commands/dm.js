const { PermissionFlagsBits } = require('discord.js');

const COMMAND_ACCESS_ROLE_ID =
  process.env.COMMAND_ACCESS_ROLE_ID ||
  '1552018175736946690';

function canUseDmCommand(member) {
  return Boolean(
    member?.permissions?.has(PermissionFlagsBits.Administrator) ||
    member?.roles?.cache?.has(COMMAND_ACCESS_ROLE_ID)
  );
}

async function execute(message, args = []) {
  if (!message?.guild || !message.member) {
    await message?.reply?.('❌ Este comando só pode ser usado dentro do servidor.').catch(() => {});
    return;
  }

  if (!canUseDmCommand(message.member)) {
    await message.reply('❌ Você não possui permissão para usar o comando `!DM`.').catch(() => {});
    return;
  }

  const target = message.mentions?.users?.first?.() || null;

  if (!target) {
    await message.reply('❌ Use: `!DM @Pessoa sua mensagem aqui`').catch(() => {});
    return;
  }

  // O primeiro argumento é a menção; o restante é o texto da mensagem.
  const messageText = args.slice(1).join(' ').trim();

  if (!messageText) {
    await message.reply(
      '❌ Informe a mensagem que será enviada. Exemplo: `!DM @Pessoa Olá, tudo bem?`'
    ).catch(() => {});
    return;
  }

  try {
    await target.send({ content: messageText });

    await message.reply(`✅ Mensagem enviada por PV para <@${target.id}>.`).catch(() => {});
  } catch (error) {
    if (error?.code === 50007) {
      await message.reply(
        '❌ Não foi possível enviar o PV. A pessoa pode estar com as mensagens diretas fechadas.'
      ).catch(() => {});
      return;
    }

    console.error('[DM] Erro ao enviar PV:', error);
    await message.reply('❌ Não foi possível enviar a mensagem por PV.').catch(() => {});
  }
}

module.exports = { execute };
