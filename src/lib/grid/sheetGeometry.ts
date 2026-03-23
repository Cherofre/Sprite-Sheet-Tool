export interface GridSliceRect {
  column: number
  height: number
  index: number
  row: number
  width: number
  x: number
  y: number
}

export interface GridFrameMetrics {
  canApply: boolean
  frameHeight: number
  frameWidth: number
}

export const getGridFrameMetrics = (
  sourceWidth: number,
  sourceHeight: number,
  rows: number,
  columns: number
): GridFrameMetrics => {
  const canApply =
    rows > 0 &&
    columns > 0 &&
    Math.floor(sourceWidth / columns) > 0 &&
    Math.floor(sourceHeight / rows) > 0

  return {
    canApply,
    frameHeight: canApply ? Math.max(1, Math.round(sourceHeight / rows)) : 0,
    frameWidth: canApply ? Math.max(1, Math.round(sourceWidth / columns)) : 0
  }
}

const buildAxisBoundaries = (size: number, segments: number): number[] => {
  const boundaries = new Array<number>(segments + 1).fill(0)

  for (let index = 0; index <= segments; index += 1) {
    boundaries[index] = index === segments ? size : Math.round((index / segments) * size)
  }

  return boundaries
}

export const buildGridSliceRects = (
  sourceWidth: number,
  sourceHeight: number,
  rows: number,
  columns: number
): GridSliceRect[] => {
  const { canApply } = getGridFrameMetrics(sourceWidth, sourceHeight, rows, columns)
  if (!canApply) {
    return []
  }

  const xBoundaries = buildAxisBoundaries(sourceWidth, columns)
  const yBoundaries = buildAxisBoundaries(sourceHeight, rows)
  const rects: GridSliceRect[] = []

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      rects.push({
        column,
        height: yBoundaries[row + 1] - yBoundaries[row],
        index: row * columns + column,
        row,
        width: xBoundaries[column + 1] - xBoundaries[column],
        x: xBoundaries[column],
        y: yBoundaries[row]
      })
    }
  }

  return rects
}
