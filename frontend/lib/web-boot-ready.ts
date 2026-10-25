declare global {
  interface Window {
    __funboxMarkBootReady?: () => void;
  }
}

export function markWebBootReady() {
  if (typeof window !== 'undefined') {
    window.__funboxMarkBootReady?.();
  }
}
