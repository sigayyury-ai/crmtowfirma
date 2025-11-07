function normalizeWhitespace(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeName(value) {
  if (!value) return null;
  const trimmed = normalizeWhitespace(String(value));
  if (!trimmed) return null;

  return trimmed
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s\.\-_/]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  normalizeWhitespace,
  normalizeName
};

