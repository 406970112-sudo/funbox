export function getNextCarouselIndex(index: number, itemCount: number): number {
  if (itemCount < 2) {
    return 0;
  }

  const lastIndex = itemCount - 1;
  const normalizedIndex = Math.max(0, Math.min(index, lastIndex));
  return normalizedIndex === lastIndex ? 0 : normalizedIndex + 1;
}
