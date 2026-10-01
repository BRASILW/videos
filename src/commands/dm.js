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

function markMessageAsHandled(messageId) {
  if (!messageId || handledMessages.has(messageId)) return false;

  handledMessages.add(messageId);
  setTimeout(() => handledMessages.delete(messageId), 60000).unref?.();
  return true;
}

async function notifyPrivately(message, content) {
  try {
    await message.author.send(content);
    return true;
  } catch (error) {
    console.warn('[DM] Não foi possível enviar uma resposta privada ao moderador:', error.message);
    return false;
  }
}

function parseUserId(value) {
  const match = String(value || '').trim().match(/^(?:<@!?(\d{15,22})>|(\d{15,22}))$/);
  return match?.[1] || match?.[2] || null;
}

async function execute(message, args = [], client = message?.client) {
  if (!message?.guild || !message.member) return;
  if (!markMessageAsHandled(message.id)) return;

  try {
    await message.delete();
  } catch (error) {
    console.warn('[DM] Não foi possível apagar o comando:', error.message);
    await notifyPrivately(message, '❌ Não enviei o PV porque não consegui apagar o comando do canal. O bot precisa da permissão **Gerenciar mensagens** nesse canal.');
    return;
  }

  if (!canUseDmCommand(message.member)) {
    await notifyPrivately(message, '❌ Você não possui permissão para usar o comando `!dm`.');
    return;
  }

  const [targetToken, ...textParts] = args;
  const targetId = parseUserId(targetToken);
  const target = targetId
    ? message.mentions.users.get(targetId) ||
      await client.users.fetch(targetId).catch(() => null)
    : null;

  if (!target) {
    await notifyPrivately(message, '❌ Use: `!dm <menção ou ID> sua mensagem aqui`.');
    return;
  }

  const messageText = textParts.join(' ').trim();
  if (!messageText) {
    await notifyPrivately(message, '❌ Informe a mensagem a enviar. Exemplo: `!dm 123456789012345678 Olá, tudo bem?`.');
    return;
  }

  try {
    await target.send({ content: messageText });
    await notifyPrivately(message, `✅ Mensagem enviada por PV para ${target.tag || target.username}.`);
  } catch (error) {
    if (error?.code === 50007) {
      await notifyPrivately(message, '❌ Não foi possível enviar o PV. A pessoa pode estar com as mensagens diretas fechadas.');
      return;
    }

    console.error('[DM] Erro ao enviar PV:', error);
    await notifyPrivately(message, '❌ Não foi possível enviar a mensagem por DM.');
  }
}

module.exports = {
  execute
};
