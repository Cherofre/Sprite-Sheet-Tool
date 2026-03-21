import { GRID_CANDIDATE_LIMIT } from '@shared/constants'
import type { GridCandidate } from '@shared/types'

const COMMON_SQUARE_GRIDS = new Set([2, 3, 4, 5, 6, 8, 10, 12, 16])
const GRID_HINT_PATTERN = /(\d{1,2})\s*[xX*]\s*(\d{1,2})/
const EPSILON = 0.0001

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

  if (sourceHeight % rows !== 0 || sourceWidth % columns !== 0) {
    return null
  }

  const frameCount = rows * columns
  if (frameCount <= 1) {
    return null
  }

  const frameWidth = sourceWidth / columns
  const frameHeight = sourceHeight / rows
  if (frameWidth < 4 || frameHeight < 4) {
    return null
  }

  const score = scoreCandidate(rows, columns, frameWidth, frameHeight) + scoreBoost
  const confidence = clamp(score / 1.15, 0, 0.99)

  return {
    columns,
    confidence,
    frameHeight,
    frameWidth,
    label: labelPrefix ? `${labelPrefix}: ${rows} x ${columns} grid (${frameWidth} x ${frameHeight})` : `${rows} x ${columns} grid (${frameWidth} x ${frameHeight})`,
    rows,
    score
  }
}

export const detectRegularGrid = (sourceWidth: number, sourceHeight: number, maxDivisions = 16): GridCandidate[] => {
  const candidates: GridCandidate[] = []

  for (let rows = 1; rows <= maxDivisions; rows += 1) {
    for (let columns = 1; columns <= maxDivisions; columns += 1) {
      const candidate = buildGridCandidate(rows, columns, sourceWidth, sourceHeight)
      if (candidate) {
        candidates.push(candidate)
      }
    }
  }

  return candidates.sort((left, right) => right.score - left.score).slice(0, GRID_CANDIDATE_LIMIT)
}

export interface InkProfiles {
  columnInk: number[]
  meanInk: number
  rowInk: number[]
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

export const scoreCandidateWithInkProfiles = (
  candidate: Pick<GridCandidate, 'columns' | 'rows'>,
  profiles: InkProfiles
): number => {
  const columnScore = scoreProfileAxis(profiles.columnInk, candidate.columns, profiles.meanInk)
  const rowScore = scoreProfileAxis(profiles.rowInk, candidate.rows, profiles.meanInk)
  const combined = (columnScore + rowScore) / 2

  return clamp(combined, -1, 2) * 0.6
}

export const rankGridCandidatesWithInkProfiles = (
  candidates: GridCandidate[],
  profiles: InkProfiles
): GridCandidate[] =>
  candidates
    .map((candidate) => {
      const scoreBoost = scoreCandidateWithInkProfiles(candidate, profiles)
      const score = candidate.score + scoreBoost
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

  return best.confidence >= 0.8 && (gap >= 0.08 || commonSquare)
}
