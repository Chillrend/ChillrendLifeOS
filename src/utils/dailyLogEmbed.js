const { EmbedBuilder } = require('discord.js');

// Discord Embed API limits
const MAX_TITLE = 256;
const MAX_DESCRIPTION = 4096;
const MAX_FIELD_NAME = 256;
const MAX_FIELD_VALUE = 1024;
const MAX_FOOTER = 2048;
const MAX_FIELDS_PER_EMBED = 25;
const MAX_EMBED_TOTAL_CHARS = 5800; // Safe margin below Discord's 6,000-char per-message total

function cleanTaskDescription(raw) {
  if (!raw || typeof raw !== 'string') return 'No description';

  const text = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text || 'No description';
}

function truncateCleanly(text, maxLen) {
  if (!text || text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen - 1);
  const lastSpace = slice.lastIndexOf(' ');
  const cutoff = lastSpace > Math.floor(maxLen * 0.6) ? lastSpace : maxLen - 1;
  return `${slice.slice(0, cutoff).trimEnd()}…`;
}

/**
 * Splits a long string into chunks <= maxLen, preferring paragraph, newline,
 * sentence, or word boundaries so text is never cut mid-word.
 */
function splitIntoChunks(text, maxLen = MAX_FIELD_VALUE) {
  if (!text) return ['No description'];
  if (text.length <= maxLen) return [text];

  const chunks = [];
  let remaining = text.trim();

  while (remaining.length > maxLen) {
    const window = remaining.slice(0, maxLen);
    const minBreak = Math.floor(maxLen * 0.5);

    let splitAt = window.lastIndexOf('\n\n');
    if (splitAt < minBreak) splitAt = window.lastIndexOf('\n');
    if (splitAt < minBreak) splitAt = window.lastIndexOf('. ');
    if (splitAt >= minBreak && window.slice(splitAt, splitAt + 2) === '. ') {
      splitAt += 1; // Keep the period with the current chunk
    }
    if (splitAt < minBreak) splitAt = window.lastIndexOf(' ');
    if (splitAt < minBreak) splitAt = maxLen;

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

/**
 * Builds one or more Discord EmbedBuilder objects for a list of daily log tasks.
 * Each task gets its own field(s) so full descriptions render without arbitrary
 * truncation while strictly respecting Discord's embed character and field limits.
 *
 * Callers should send each returned embed in its own message if embeds.length > 1
 * because Discord enforces the 6,000-character limit across all embeds in a message.
 */
function buildDailyLogEmbeds({
  title,
  description = '',
  footerText = '',
  tasks = [],
  color = 0x00FF00
}) {
  const safeTitle = truncateCleanly(title || 'Daily Work Log', MAX_TITLE - 15);
  const safeDescription = truncateCleanly(description, MAX_DESCRIPTION);
  const safeFooter = truncateCleanly(footerText, MAX_FOOTER);

  const fields = [];
  if (!Array.isArray(tasks) || tasks.length === 0) {
    fields.push({ name: 'Tasks', value: 'No tasks found.', inline: false });
  } else {
    tasks.forEach((t, idx) => {
      const statusIcon = t.statusName === 'Done' ? '✅' : '🔄';
      const statusSuffix = t.statusName ? ` (${t.statusName})` : '';
      const baseName = `${idx + 1}. ${statusIcon} ${t.title || 'Untitled Task'}${statusSuffix}`;
      const cleanDesc = cleanTaskDescription(t.description);
      const chunks = splitIntoChunks(cleanDesc, MAX_FIELD_VALUE);

      chunks.forEach((chunk, chunkIdx) => {
        const fieldName = chunkIdx === 0
          ? truncateCleanly(baseName, MAX_FIELD_NAME)
          : truncateCleanly(`${idx + 1}. ${t.title || 'Untitled Task'} (cont.)`, MAX_FIELD_NAME);
        fields.push({
          name: fieldName,
          value: chunk,
          inline: false
        });
      });
    });
  }

  // Pack fields into pages that respect both 25-field and 6,000-char limits
  const pages = [];
  let currentFields = [];
  const baseOverhead = safeTitle.length + 15 + safeFooter.length;
  let currentChars = baseOverhead + safeDescription.length;

  for (const field of fields) {
    const fieldChars = field.name.length + field.value.length;
    const exceedsFields = currentFields.length >= MAX_FIELDS_PER_EMBED;
    const exceedsChars = currentFields.length > 0 && (currentChars + fieldChars > MAX_EMBED_TOTAL_CHARS);

    if (exceedsFields || exceedsChars) {
      pages.push(currentFields);
      currentFields = [];
      currentChars = baseOverhead; // Continuation pages don't repeat description
    }

    currentFields.push(field);
    currentChars += fieldChars;
  }

  if (currentFields.length > 0) {
    pages.push(currentFields);
  }

  return pages.map((pageFields, pageIdx) => {
    const pageTitle = pages.length > 1
      ? `${safeTitle} (${pageIdx + 1}/${pages.length})`
      : safeTitle;

    const embed = new EmbedBuilder()
      .setTitle(pageTitle)
      .setColor(color)
      .addFields(pageFields);

    if (pageIdx === 0 && safeDescription) {
      embed.setDescription(safeDescription);
    }

    if (safeFooter) {
      embed.setFooter({ text: safeFooter });
    }

    return embed;
  });
}

module.exports = {
  buildDailyLogEmbeds,
  cleanTaskDescription,
  splitIntoChunks
};
