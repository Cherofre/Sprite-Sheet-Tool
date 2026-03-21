import { describe, expect, it } from 'vitest'

import { buildExportFileName, buildSampledIndices } from '@features/export/plans'
import { recommendSheetLayout } from '@features/merge/layout'
import { advanceSequencePosition, buildFrameSequence } from '@features/preview/frameSequence'
import { buildSplitPreviewSampleIndices } from '@features/split/preview'
import { detectGridHintFromName, detectRegularGrid, scoreCandidateWithInkProfiles } from '@lib/grid/detectRegularGrid'
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
