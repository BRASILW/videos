async function deleteBotMessagesFromDM(channel, botUserId, { allHistory = true } = {}) {
  if (!channel?.isDMBased?.() || !channel.messages?.fetch || !botUserId) {
    throw new TypeError('É necessário um canal de PV válido e o ID do bot.');
  }

  let deleted = 0;
  let failed = 0;
  let before;
  let previousOldest;

  do {
    const options = { limit: 100 };
    if (before) options.before = before;
    const messages = await channel.messages.fetch(options);
    if (messages.size === 0) break;

    const page = [...messages.values()];
    const oldest = page.reduce((result, message) =>
      BigInt(message.id) < BigInt(result.id) ? message : result
    );
    if (oldest.id === previousOldest) break;
    previousOldest = oldest.id;

    for (const message of page) {
      if (message.author.id !== botUserId) continue;
      try {
        await message.delete();
        deleted += 1;
      } catch (error) {
        failed += 1;
        console.warn(`[DM Cleanup] Não foi possível apagar a mensagem ${message.id}: ${error.message}`);
      }
    }

    if (!allHistory || messages.size < 100) break;
    before = oldest.id;
  } while (before);

  return { deleted, failed };
}

module.exports = { deleteBotMessagesFromDM };
