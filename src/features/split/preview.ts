export const buildSplitPreviewSampleIndices = (frameCount: number, limit = 6): number[] => {
  if (frameCount <= 0 || limit <= 0) {
    return []
  }

  if (frameCount <= limit) {
    return Array.from({ length: frameCount }, (_, index) => index)
  }

  const indices = new Set<number>()

  for (let slot = 0; slot < limit; slot += 1) {
    const position = Math.round((slot * (frameCount - 1)) / Math.max(1, limit - 1))
    indices.add(position)
  }

  return [...indices].sort((left, right) => left - right)
}
