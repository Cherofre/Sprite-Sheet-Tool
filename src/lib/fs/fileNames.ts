export const stripExtension = (fileName: string): string => {
  const lastDotIndex = fileName.lastIndexOf('.')
  return lastDotIndex === -1 ? fileName : fileName.slice(0, lastDotIndex)
}

export const buildPaddedIndex = (index: number, padding: number): string =>
  String(index).padStart(Math.max(1, padding), '0')
