const { PermissionFlagsBits } = require('discord.js');

const COMMAND_ACCESS_ROLE_ID =
  process.env.COMMAND_ACCESS_ROLE_ID ||
  '1552018175736946690';

const handledMessages = new Set();

function canUseDmCommand(member) {
  return Boolean(
    member?.permissions?.has(PermissionFlagsBits.Administrator) ||
    member?.roles?.cache?.has(COMMAND_ACCESS_ROLE_ID)
  );
}

function markMessageAsHandled(message) {
  const messageId = String(message?.id || '');

  if (!messageId) {
    return true;
  }

  if (handledMessages.has(messageId)) {
    return false;
  }

  handledMessages.add(messageId);

  setTimeout(() => {
    handledMessages.delete(messageId);
  }, 60000);

  return true;
}

async function replyTemporary(message, content, delay = 5000) {
  try {
    const reply = await message.reply(content);

    setTimeout(() => {
      reply.delete().catch(() => {});
    }, delay);

    return reply;
  } catch {
    return null;
  }
}

async function execute(message, args = []) {
  if (!markMessageAsHandled(message)) {
    return;
  }

  if (!message?.guild || !message.member) {
    await replyTemporary(
      message,
      '❌ Este comando só pode ser usado dentro do servidor.'
    );
    return;
  }

  if (!canUseDmCommand(message.member)) {
    await replyTemporary(
      message,
      '❌ Você não possui permissão para usar o comando `!DM`.'
    );
    return;
  }

  const target =
    message.mentions?.users?.first?.() ||
    null;

  if (!target) {
    await replyTemporary(
      message,
      '❌ Use: `!DM @Pessoa sua mensagem aqui`'
    );
    return;
  }

  const messageText =
    args
      .slice(1)
      .join(' ')
      .trim();

  if (!messageText) {
    await replyTemporary(
      message,
      '❌ Informe a mensagem que será enviada. Exemplo: `!DM @Pessoa Olá, tudo bem?`'
    );
    return;
  }

  try {
    await target.send({
      content: messageText
    });

    await replyTemporary(
      message,
      `✅ Mensagem enviada por PV para <@${target.id}>.`,
      3000
    );
  } catch (error) {
    if (error?.code === 50007) {
      await replyTemporary(
        message,
        '❌ Não foi possível enviar o PV. A pessoa pode estar com as mensagens diretas fechadas.'
      );
      return;
    }

    console.error(
      '[DM] Erro ao enviar PV:',
      error
    );

    await replyTemporary(
      message,
      '❌ Não foi possível enviar a mensagem por DM.'
    );
  }
}

module.exports = {
  execute
};