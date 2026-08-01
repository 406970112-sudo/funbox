export function backFallbackForPathname(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);

  if (segments[0] === 'tools') return '/tools';
  if (segments[0] === 'profile') return '/profile';
  if (segments[0] === 'admin') return segments.length <= 1 ? '/profile' : '/admin';
  if (segments[0] === 'reading') {
    if (segments[1] === 'books' && segments[2] && segments[3] === 'chapters') {
      return `/reading/books/${segments[2]}`;
    }
    return '/tools/reading';
  }
  if (segments[0] === 'social') return '/messages';
  if (segments[0] === 'games') return '/';
  return '/';
}
