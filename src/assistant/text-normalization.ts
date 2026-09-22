/** Normalize readable multiline text without loading React Native or storage modules. */
export function normalizeMultilineText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim().replace(/\s+/g, ' '))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
