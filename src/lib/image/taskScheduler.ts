const PROGRESS_REPORT_INTERVAL = 4
const YIELD_INTERVAL = 12

export const shouldReportProgress = (processed: number, total: number): boolean =>
  processed === 1 || processed === total || processed % PROGRESS_REPORT_INTERVAL === 0

export const yieldToBrowser = async (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve())
      return
    }

    setTimeout(resolve, 0)
  })

export const maybeYieldToBrowser = async (processed: number): Promise<void> => {
  if (processed % YIELD_INTERVAL !== 0) {
    return
  }

  await yieldToBrowser()
}
