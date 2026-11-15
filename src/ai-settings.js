const AI_RESPONSE_CHANNEL_ID =
  process.env.AI_RESPONSE_CHANNEL_ID?.trim() || '1571164355855253544';
const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

function isAIResponseChannel(channelId) {
  return channelId === AI_RESPONSE_CHANNEL_ID;
}

module.exports = {
  AI_RESPONSE_CHANNEL_ID,
  DEFAULT_GEMINI_MODEL,
  isAIResponseChannel
};
