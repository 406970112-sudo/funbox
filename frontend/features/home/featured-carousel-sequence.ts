export type CarouselDirection = -1 | 1;

export type CarouselStep = {
  direction: CarouselDirection;
  index: number;
};

export function getNextCarouselStep(
  index: number,
  direction: CarouselDirection,
  itemCount: number,
): CarouselStep {
  if (itemCount < 2) {
    return { direction: 1, index: 0 };
  }

  const lastIndex = itemCount - 1;
  const normalizedIndex = Math.max(0, Math.min(index, lastIndex));

  if (normalizedIndex === 0) {
    return { direction: 1, index: 1 };
  }

  if (normalizedIndex === lastIndex) {
    return { direction: -1, index: lastIndex - 1 };
  }

  return { direction, index: normalizedIndex + direction };
}
