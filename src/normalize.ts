export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeTitle(title: string): string {
  return normalizeWhitespace(title.replace(/\s+-\s+[^-]+$/, '').trim());
}

export function normalizeSource(source?: string): string {
  return normalizeWhitespace(source ?? '');
}

export function makeKey(title: string, source?: string): string {
  return `${normalizeTitle(title).toLowerCase()} || ${normalizeSource(source).toLowerCase()}`;
}
