import { GRID_CANDIDATE_LIMIT } from '@shared/constants'
import type { GridCandidate } from '@shared/types'
import { getGridFrameMetrics } from '@lib/grid/sheetGeometry'

const COMMON_SQUARE_GRIDS = new Set([2, 3, 4, 5, 6, 8, 10, 12, 16])
const GRID_HINT_PATTERN = /(\d{1,2})\s*[xX*]\s*(\d{1,2})/
const EPSILON = 0.0001
const MAX_AUTO_DIVISIONS = 24
const PRE_RANK_CANDIDATE_LIMIT = 16
const PRIORITY_SQUARE_GRIDS = [5, 6, 7]

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const scoreCandidate = (rows: number, columns: number, frameWidth: number, frameHeight: number): number => {
  const frameCount = rows * columns
  const ratio = frameWidth / frameHeight
  const squareBonus = 1 - clamp(Math.abs(Math.log(ratio)) / 2.5, 0, 1)
  const gridBalanceBonus = 1 / (Math.abs(rows - columns) + 1)
  const frameCountBonus = clamp(frameCount / 64, 0, 1)
  const commonGridBonus =
    rows === columns ? 0.2 + (COMMON_SQUARE_GRIDS.has(rows) ? 0.25 : 0) : COMMON_SQUARE_GRIDS.has(frameCount) ? 0.08 : 0

  return squareBonus * 0.45 + gridBalanceBonus * 0.2 + frameCountBonus * 0.15 + commonGridBonus + 0.1
}

const buildGridCandidate = (
  rows: number,
  columns: number,
  sourceWidth: number,
  sourceHeight: number,
  labelPrefix?: string,
  scoreBoost = 0
): GridCandidate | null => {
  if (rows <= 0 || columns <= 0) {
    return null
  }

  const frameCount = rows * columns
  if (frameCount <= 1) {
    return null
  }

  const { canApply, frameHeight, frameWidth } = getGridFrameMetrics(sourceWidth, sourceHeight, rows, columns)
  if (!canApply) {
    return null
  }

  const exactFrameWidth = sourceWidth / columns
  const exactFrameHeight = sourceHeight / rows
  if (frameWidth < 4 || frameHeight < 4) {
    return null
  }

  const score = scoreCandidate(rows, columns, exactFrameWidth, exactFrameHeight) + scoreBoost
  const confidence = clamp(score / 1.15, 0, 0.99)
  const approximate = !Number.isInteger(exactFrameWidth) || !Number.isInteger(exactFrameHeight)
  const sizeLabel = approximate ? `~${frameWidth} x ${frameHeight}` : `${frameWidth} x ${frameHeight}`

  return {
    approximate,
    columns,
    confidence,
    frameHeight,
    frameWidth,
    label: labelPrefix ? `${labelPrefix}: ${rows} x ${columns} grid (${sizeLabel})` : `${rows} x ${columns} grid (${sizeLabel})`,
    rows,
    score
  }
}

export const detectRegularGrid = (sourceWidth: number, sourceHeight: number, maxDivisions = 16): GridCandidate[] => {
  const candidates: GridCandidate[] = []
  const adaptiveDivisions = clamp(
    Math.floor(Math.min(sourceWidth, sourceHeight) / 16),
    maxDivisions,
    MAX_AUTO_DIVISIONS
  )

  for (let rows = 1; rows <= adaptiveDivisions; rows += 1) {
    for (let columns = 1; columns <= adaptiveDivisions; columns += 1) {
      const candidate = buildGridCandidate(rows, columns, sourceWidth, sourceHeight)
      if (candidate) {
        candidates.push(candidate)
      }
    }
  }

  const sortedCandidates = candidates.sort((left, right) => right.score - left.score)
  const selectedCandidates = sortedCandidates.slice(0, PRE_RANK_CANDIDATE_LIMIT)

  for (const size of PRIORITY_SQUARE_GRIDS) {
    if (selectedCandidates.some((candidate) => candidate.rows === size && candidate.columns === size)) {
      continue
    }

    const priorityCandidate = sortedCandidates.find((candidate) => candidate.rows === size && candidate.columns === size)
    if (!priorityCandidate) {
      continue
    }

    const replacementIndex = [...selectedCandidates]
      .map((candidate, index) => ({ candidate, index }))
      .reverse()
      .find(({ candidate }) => !PRIORITY_SQUARE_GRIDS.includes(candidate.rows) || candidate.rows !== candidate.columns)?.index

    if (typeof replacementIndex === 'number') {
      selectedCandidates[replacementIndex] = priorityCandidate
    }
  }

  return selectedCandidates.sort((left, right) => right.score - left.score)
}

export interface InkProfiles {
  columnInk: number[]
  inkMap?: number[]
  meanInk: number
  rowInk: number[]
  sampleHeight?: number
  sampleWidth?: number
}

const averageBand = (values: number[], center: number, radius: number): number => {
  const start = Math.max(0, Math.floor(center - radius))
  const end = Math.min(values.length - 1, Math.ceil(center + radius))
  if (end < start) {
    return 0
  }

  let total = 0
  let count = 0

  for (let index = start; index <= end; index += 1) {
    total += values[index]
    count += 1
  }

  return count > 0 ? total / count : 0
}

const scoreProfileAxis = (profile: number[], segments: number, meanInk: number): number => {
  if (segments <= 1 || profile.length === 0) {
    return 0
  }

  const segmentSize = profile.length / segments
  const boundaryRadius = Math.max(1, segmentSize * 0.08)
  const centerRadius = Math.max(1, segmentSize * 0.12)

  let boundaryInkTotal = 0
  let centerInkTotal = 0

  for (let boundary = 1; boundary < segments; boundary += 1) {
    boundaryInkTotal += averageBand(profile, boundary * segmentSize, boundaryRadius)
  }

  for (let segment = 0; segment < segments; segment += 1) {
    centerInkTotal += averageBand(profile, (segment + 0.5) * segmentSize, centerRadius)
  }

  const boundaryInk = boundaryInkTotal / Math.max(1, segments - 1)
  const centerInk = centerInkTotal / segments
  const boundaryGap = clamp((meanInk - boundaryInk) / Math.max(meanInk, EPSILON), -1, 1)
  const centerDensity = clamp((centerInk - meanInk) / Math.max(meanInk, EPSILON), -1, 2)

  return boundaryGap * 0.75 + Math.max(0, centerDensity) * 0.25
}

const sampleRegionAverage = (
  inkMap: number[],
  sampleWidth: number,
  sampleHeight: number,
  startX: number,
  endX: number,
  startY: number,
  endY: number
): number => {
  const clampedStartX = clamp(Math.floor(startX), 0, sampleWidth - 1)
  const clampedEndX = clamp(Math.ceil(endX), 0, sampleWidth - 1)
  const clampedStartY = clamp(Math.floor(startY), 0, sampleHeight - 1)
  const clampedEndY = clamp(Math.ceil(endY), 0, sampleHeight - 1)

  if (clampedEndX < clampedStartX || clampedEndY < clampedStartY) {
    return 0
  }

  let total = 0
  let count = 0

  for (let y = clampedStartY; y <= clampedEndY; y += 1) {
    for (let x = clampedStartX; x <= clampedEndX; x += 1) {
      total += inkMap[y * sampleWidth + x] ?? 0
      count += 1
    }
  }

  return count > 0 ? total / count : 0
}

export const scoreCandidateWithInkProfiles = (
  candidate: Pick<GridCandidate, 'columns' | 'rows'>,
  profiles: InkProfiles
): number => {
  const columnScore = scoreProfileAxis(profiles.columnInk, candidate.columns, profiles.meanInk)
  const rowScore = scoreProfileAxis(profiles.rowInk, candidate.rows, profiles.meanInk)
  const combined = (columnScore + rowScore) / 2

  return clamp(combined, -1, 2) * 0.6
}

export const scoreCandidateWithCellCenters = (
  candidate: Pick<GridCandidate, 'columns' | 'rows'>,
  profiles: InkProfiles
): number => {
  const { inkMap = [], meanInk, sampleHeight = 0, sampleWidth = 0 } = profiles
  if (inkMap.length === 0 || sampleWidth <= 0 || sampleHeight <= 0) {
    return 0
  }

  const cellWidth = sampleWidth / candidate.columns
  const cellHeight = sampleHeight / candidate.rows
  if (cellWidth < 3 || cellHeight < 3) {
    return 0
  }

  const centerValues: number[] = []

  for (let row = 0; row < candidate.rows; row += 1) {
    for (let column = 0; column < candidate.columns; column += 1) {
      const startX = column * cellWidth + cellWidth * 0.28
      const endX = column * cellWidth + cellWidth * 0.72
      const startY = row * cellHeight + cellHeight * 0.28
      const endY = row * cellHeight + cellHeight * 0.72

      centerValues.push(sampleRegionAverage(inkMap, sampleWidth, sampleHeight, startX, endX, startY, endY))
    }
  }

  if (centerValues.length === 0) {
    return 0
  }

  const activationThreshold = Math.max(meanInk * 0.42, 0.018)
  const activeRatio = centerValues.filter((value) => value >= activationThreshold).length / centerValues.length
  const meanCenterInk = centerValues.reduce((total, value) => total + value, 0) / centerValues.length
  const variance =
    centerValues.reduce((total, value) => total + (value - meanCenterInk) ** 2, 0) / centerValues.length
  const normalizedDeviation = Math.sqrt(variance) / Math.max(meanCenterInk, EPSILON)
  const consistency = 1 - clamp(normalizedDeviation, 0, 1)
  const density = clamp((meanCenterInk - activationThreshold) / Math.max(meanInk, 0.02), -1, 2)

  return activeRatio * 0.26 + Math.max(0, consistency) * 0.18 + Math.max(0, density) * 0.16
}

export const rankGridCandidatesWithInkProfiles = (
  candidates: GridCandidate[],
  profiles: InkProfiles
): GridCandidate[] =>
  candidates
    .map((candidate) => {
      const boundaryScore = scoreCandidateWithInkProfiles(candidate, profiles)
      const centerScore = scoreCandidateWithCellCenters(candidate, profiles)
      const score = candidate.score + boundaryScore + centerScore
      const confidence = clamp(score / 1.15, 0, 0.99)

      return {
        ...candidate,
        confidence,
        score
      }
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, GRID_CANDIDATE_LIMIT)

export const detectGridHintFromName = (fileName: string, sourceWidth: number, sourceHeight: number): GridCandidate | null => {
  const match = GRID_HINT_PATTERN.exec(fileName)
  if (!match) {
    return null
  }

  const left = Number.parseInt(match[1], 10)
  const right = Number.parseInt(match[2], 10)

  const candidates = [
    buildGridCandidate(right, left, sourceWidth, sourceHeight, 'Filename hint', 1.4),
    left === right ? null : buildGridCandidate(left, right, sourceWidth, sourceHeight, 'Filename hint', 1.2)
  ].filter((candidate): candidate is GridCandidate => Boolean(candidate))

  return candidates.sort((first, second) => second.score - first.score)[0] ?? null
}

export const shouldAutoApplyGrid = (candidates: GridCandidate[]): boolean => {
  const [best, second] = candidates
  if (!best) {
    return false
  }

  const gap = best.score - (second?.score ?? best.score - 0.2)
  const commonSquare = best.rows === best.columns && COMMON_SQUARE_GRIDS.has(best.rows)
  const denseApproximateGrid = best.approximate && best.rows * best.columns > 64

  if (denseApproximateGrid) {
    return false
  }

  return best.confidence >= 0.8 && (gap >= 0.08 || commonSquare)
}
