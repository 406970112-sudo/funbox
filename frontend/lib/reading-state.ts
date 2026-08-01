export type ReaderTheme = 'paper' | 'white' | 'sepia' | 'night';

export type ReaderSettings = {
  fontSize: number;
  lineHeight: number;
  textWidth: number;
  theme: ReaderTheme;
};

export type ProgressSnapshot = {
  chapterId: string;
  chapterProgress: number;
  updatedAt: string;
};

export type ReaderSettingsAction =
  | { type: 'increase-font' }
  | { type: 'decrease-font' }
  | { type: 'set-font-size'; fontSize: number }
  | { type: 'set-line-height'; lineHeight: number }
  | { type: 'set-text-width'; textWidth: number }
  | { type: 'set-theme'; theme: ReaderTheme };

export function clampChapterProgress(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function shouldReplaceReadingProgress(
  current: ProgressSnapshot | null | undefined,
  incoming: ProgressSnapshot,
) {
  if (!current) return true;
  return Date.parse(incoming.updatedAt) >= Date.parse(current.updatedAt);
}

export function createReaderSettings(
  value: Partial<ReaderSettings> = {},
): ReaderSettings {
  return {
    fontSize: clamp(value.fontSize ?? 19, 15, 28),
    lineHeight: clamp(value.lineHeight ?? 1.85, 1.5, 2.2),
    textWidth: clamp(value.textWidth ?? 680, 520, 880),
    theme: value.theme ?? 'paper',
  };
}

export function readerSettingsReducer(
  settings: ReaderSettings,
  action: ReaderSettingsAction,
): ReaderSettings {
  switch (action.type) {
    case 'increase-font':
      return { ...settings, fontSize: clamp(settings.fontSize + 1, 15, 28) };
    case 'decrease-font':
      return { ...settings, fontSize: clamp(settings.fontSize - 1, 15, 28) };
    case 'set-font-size':
      return { ...settings, fontSize: clamp(action.fontSize, 15, 28) };
    case 'set-line-height':
      return { ...settings, lineHeight: clamp(action.lineHeight, 1.5, 2.2) };
    case 'set-text-width':
      return { ...settings, textWidth: clamp(action.textWidth, 520, 880) };
    case 'set-theme':
      return { ...settings, theme: action.theme };
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
