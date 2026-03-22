import { describe, expect, it } from 'vitest'

import { buildExportFileName, buildSampledIndices } from '@features/export/plans'
import { recommendSheetLayout } from '@features/merge/layout'
import { advanceSequencePosition, buildFrameSequence } from '@features/preview/frameSequence'
import { buildSplitPreviewSampleIndices } from '@features/split/preview'
import {
  detectGridHintFromName,
  detectRegularGrid,
  rankGridCandidatesWithInkProfiles,
  scoreCandidateWithCellCenters,
  scoreCandidateWithInkProfiles
} from '@lib/grid/detectRegularGrid'
import { naturalSort } from '@lib/sort/naturalSort'

describe('naturalSort', () => {
  it('sorts numbered frame names naturally', () => {
    const sorted = naturalSort(['frame_10.png', 'frame_2.png', 'frame_1.png'], (value) => value)
    expect(sorted).toEqual(['frame_1.png', 'frame_2.png', 'frame_10.png'])
  })
})

describe('detectRegularGrid', () => {
  it('offers common evenly divided sheet candidates', () => {
    const candidates = detectRegularGrid(1024, 1024)
    expect(candidates.some((candidate) => candidate.rows === 8 && candidate.columns === 8)).toBe(true)
  })
})

describe('detectGridHintFromName', () => {
  it('prefers a filename-provided 16x4 hint when the source divides cleanly', () => {
    const candidate = detectGridHintFromName('DiscSmoke01_16x4.png', 2048, 1024)
    expect(candidate).toMatchObject({
      columns: 16,
      rows: 4
    })
  })
})

describe('scoreCandidateWithInkProfiles', () => {
  it('rewards candidates whose boundaries align with whitespace gutters', () => {
    const columnInk = [0.9, 0.92, 0.12, 0.88, 0.95, 0.1, 0.9, 0.93]
    const rowInk = [0.85, 0.9, 0.08, 0.86, 0.91, 0.09, 0.89, 0.9]
    const meanInk = 0.68

    const aligned = scoreCandidateWithInkProfiles(
      {
        columns: 4,
        rows: 4
      },
      { columnInk, meanInk, rowInk }
    )

    const misaligned = scoreCandidateWithInkProfiles(
      {
        columns: 2,
        rows: 2
      },
      { columnInk, meanInk, rowInk }
    )

    expect(aligned).toBeGreaterThan(misaligned)
  })
})

describe('scoreCandidateWithCellCenters', () => {
  it('prefers a grid whose cell centers look like full frames instead of partial tiles', () => {
    const sampleWidth = 16
    const sampleHeight = 16
    const inkMap = new Array<number>(sampleWidth * sampleHeight).fill(0.01)

    for (let cellRow = 0; cellRow < 4; cellRow += 1) {
      for (let cellColumn = 0; cellColumn < 4; cellColumn += 1) {
        for (let y = cellRow * 4 + 1; y <= cellRow * 4 + 2; y += 1) {
          for (let x = cellColumn * 4 + 1; x <= cellColumn * 4 + 2; x += 1) {
            inkMap[y * sampleWidth + x] = 0.92
          }
        }
      }
    }

    const aligned = scoreCandidateWithCellCenters(
      {
        columns: 4,
        rows: 4
      },
      {
        columnInk: new Array(sampleWidth).fill(0.2),
        inkMap,
        meanInk: 0.18,
        rowInk: new Array(sampleHeight).fill(0.2),
        sampleHeight,
        sampleWidth
      }
    )

    const overlyFine = scoreCandidateWithCellCenters(
      {
        columns: 8,
        rows: 8
      },
      {
        columnInk: new Array(sampleWidth).fill(0.2),
        inkMap,
        meanInk: 0.18,
        rowInk: new Array(sampleHeight).fill(0.2),
        sampleHeight,
        sampleWidth
      }
    )

    expect(aligned).toBeGreaterThan(overlyFine)
  })
})

describe('rankGridCandidatesWithInkProfiles', () => {
  it('uses center occupancy to keep the correct 4x4 candidate above a noisier 8x8 split', () => {
    const sampleWidth = 16
    const sampleHeight = 16
    const inkMap = new Array<number>(sampleWidth * sampleHeight).fill(0.01)

    for (let cellRow = 0; cellRow < 4; cellRow += 1) {
      for (let cellColumn = 0; cellColumn < 4; cellColumn += 1) {
        for (let y = cellRow * 4 + 1; y <= cellRow * 4 + 2; y += 1) {
          for (let x = cellColumn * 4 + 1; x <= cellColumn * 4 + 2; x += 1) {
            inkMap[y * sampleWidth + x] = 0.92
          }
        }
      }
    }

    const ranked = rankGridCandidatesWithInkProfiles(
      [
        {
          columns: 8,
          confidence: 0.72,
          frameHeight: 32,
          frameWidth: 32,
          label: '8 x 8 grid (32 x 32)',
          rows: 8,
          score: 0.84
        },
        {
          columns: 4,
          confidence: 0.69,
          frameHeight: 64,
          frameWidth: 64,
          label: '4 x 4 grid (64 x 64)',
          rows: 4,
          score: 0.78
        }
      ],
      {
        columnInk: new Array(sampleWidth).fill(0.2),
        inkMap,
        meanInk: 0.18,
        rowInk: new Array(sampleHeight).fill(0.2),
        sampleHeight,
        sampleWidth
      }
    )

    expect(ranked[0]).toMatchObject({
      columns: 4,
      rows: 4
    })
  })
})

describe('buildFrameSequence', () => {
  it('filters the range with skip applied', () => {
    expect(buildFrameSequence(8, 1, 6, 1, false)).toEqual([1, 3, 5])
  })

  it('reverses the playback order when requested', () => {
    expect(buildFrameSequence(6, 0, 5, 2, true)).toEqual([3, 0])
  })
})

describe('advanceSequencePosition', () => {
  it('bounces in ping-pong mode', () => {
    const result = advanceSequencePosition(4, 3, 1, 'pingpong')
    expect(result).toEqual({
      direction: -1,
      position: 2,
      shouldStop: false
    })
  })
})

describe('recommendSheetLayout', () => {
  it('picks a near-square layout', () => {
    expect(recommendSheetLayout(10)).toEqual({
      columns: 4,
      rows: 3
    })
  })
})

describe('buildExportFileName', () => {
  it('pads sequence file names', () => {
    expect(buildExportFileName('burst', 3, 4, 'png')).toBe('burst_0004.png')
  })
})

describe('buildSampledIndices', () => {
  it('returns evenly skipped export positions', () => {
    expect(buildSampledIndices(10, 2)).toEqual([0, 3, 6, 9])
  })
})

describe('buildSplitPreviewSampleIndices', () => {
  it('returns all frames when the count is below the preview limit', () => {
    expect(buildSplitPreviewSampleIndices(4, 6)).toEqual([0, 1, 2, 3])
  })

  it('spreads preview indices across the full sequence', () => {
    expect(buildSplitPreviewSampleIndices(16, 6)).toEqual([0, 3, 6, 9, 12, 15])
  })
})
