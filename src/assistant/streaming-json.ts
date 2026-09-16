/**
 * Reads a JSON string field before the surrounding JSON document is complete.
 * Used only for optimistic display; the complete document is still parsed by protocol.ts.
 */
export function extractPartialJsonStringField(source: string, field: string): string {
  const marker = new RegExp(`"${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*"`);
  const match = marker.exec(source);
  if (!match) return '';
  let output = '';
  let index = match.index + match[0].length;

  while (index < source.length) {
    const char = source[index++];
    if (char === '"') break;
    if (char !== '\\') {
      output += char;
      continue;
    }
    if (index >= source.length) break;
    const escaped = source[index++];
    const simple: Record<string, string> = {
      '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t',
    };
    if (escaped in simple) {
      output += simple[escaped];
      continue;
    }
    if (escaped !== 'u' || index + 4 > source.length) break;
    const hex = source.slice(index, index + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
    output += String.fromCharCode(Number.parseInt(hex, 16));
    index += 4;
  }

  return output;
}
