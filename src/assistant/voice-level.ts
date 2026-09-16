const VOICE_BAR_FACTORS = [0.48, 0.78, 1, 0.72, 0.44] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Speech recognition reports -2...10; values at or below zero are effectively silent. */
export function normalizeVoiceLevel(rawValue: number): number {
  if (!Number.isFinite(rawValue)) return 0;
  return clamp(rawValue / 10, 0, 1);
}

/** Rise quickly when the user speaks and decay more gently between samples. */
export function smoothVoiceLevel(previous: number, rawValue: number): number {
  const current = clamp(previous, 0, 1);
  const target = normalizeVoiceLevel(rawValue);
  const targetWeight = target >= current ? 0.72 : 0.38;
  return clamp((current * (1 - targetWeight)) + (target * targetWeight), 0, 1);
}

export function voiceLevelBarHeights(level: number): number[] {
  const safeLevel = clamp(level, 0, 1);
  return VOICE_BAR_FACTORS.map(factor => Math.round(4 + (20 * safeLevel * factor)));
}
