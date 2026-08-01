export type DoubleColorBallHubColorScheme = 'light' | 'dark';

const HUB_PALETTES = {
  light: {
    reference: {
      background: '#ffffff',
      border: '#dde6fb',
      iconBackground: '#fff0f3',
    },
    labV2: {
      background: '#f5f8ff',
      border: '#c7d6ff',
      iconBackground: '#e8edff',
    },
    labV1: {
      background: '#fffaf0',
      border: '#f0d9b0',
      iconBackground: '#fff7e8',
    },
  },
  dark: {
    reference: {
      background: '#151b20',
      border: '#29323b',
      iconBackground: '#34242b',
    },
    labV2: {
      background: '#151d2b',
      border: '#2b4267',
      iconBackground: '#1d3153',
    },
    labV1: {
      background: '#211c14',
      border: '#4b3a21',
      iconBackground: '#302514',
    },
  },
} as const;

export function getDoubleColorBallHubPalette(colorScheme: DoubleColorBallHubColorScheme) {
  return HUB_PALETTES[colorScheme];
}
