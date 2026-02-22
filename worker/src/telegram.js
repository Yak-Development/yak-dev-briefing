// ─── Telegram Bot API Helpers ─────────────────────────────────────

const API_BASE = "https://api.telegram.org/bot";

/**
 * Parse an incoming Telegram webhook update into a simple object.
 * Returns null if the update doesn't contain a usable text message.
 */
export function parseUpdate(body) {
  const message = body.message || body.edited_message;
  if (!message?.text) return null;
  return {
    chatId: String(message.chat.id),
    text: message.text,
    messageId: message.message_id,
    firstName: message.from?.first_name || "Unknown",
  };
}

/**
 * Send a text message. Automatically splits if over Telegram's 4096 char limit.
 */
export async function sendMessage(token, chatId, text) {
  const chunks = splitMessage(text, 4096);
  for (const chunk of chunks) {
    await fetch(`${API_BASE}${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: chunk }),
    });
  }
}

/**
 * Show a "typing…" indicator in the chat.
 */
export async function sendTyping(token, chatId) {
  await fetch(`${API_BASE}${token}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  });
}

// ─── Internals ────────────────────────────────────────────────────

function splitMessage(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Prefer splitting at a newline within the last 50% of the chunk
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen * 0.5) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}
