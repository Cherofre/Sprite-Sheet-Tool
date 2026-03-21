export interface SheetLayout {
  columns: number
  rows: number
}

export const recommendSheetLayout = (frameCount: number): SheetLayout => {
  if (frameCount <= 0) {
    return {
      columns: 0,
      rows: 0
    }
  }

  let bestLayout: SheetLayout = {
    columns: frameCount,
    rows: 1
  }
  let bestScore = Number.POSITIVE_INFINITY

  for (let rows = 1; rows <= frameCount; rows += 1) {
    const columns = Math.ceil(frameCount / rows)
    const emptySlots = rows * columns - frameCount
    const aspectPenalty = Math.abs(columns - rows)
    const score = aspectPenalty * 3 + emptySlots

    if (score < bestScore) {
      bestScore = score
      bestLayout = { columns, rows }
    }
  }

  return bestLayout
}

export const normalizeSheetLayout = (frameCount: number, rows: number, columns: number): SheetLayout => {
  if (frameCount <= 0) {
    return {
      columns: 0,
      rows: 0
    }
  }

  if (rows > 0 && columns > 0) {
    return {
      columns,
      rows
    }
  }

  return recommendSheetLayout(frameCount)
}
