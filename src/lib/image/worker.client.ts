import type { ProgressCallback } from '@shared/types'

import type { ImageWorkerRequest, ImageWorkerResponse } from './imageWorkerTypes'

type ImageWorkerTaskInput = ImageWorkerRequest extends infer Request
  ? Request extends { id: string }
    ? Omit<Request, 'id'>
    : never
  : never

const canUseImageWorker = (): boolean =>
  typeof Worker !== 'undefined' &&
  typeof OffscreenCanvas !== 'undefined' &&
  typeof createImageBitmap === 'function'

const createImageWorker = (): Worker => new Worker(new URL('./imageWorker.ts', import.meta.url), { type: 'module' })

export const supportsImageWorker = (): boolean => canUseImageWorker()

export const runImageWorkerTask = async<T>(
  request: ImageWorkerTaskInput,
  onProgress?: ProgressCallback
): Promise<T> => {
  if (!canUseImageWorker()) {
    throw new Error('Image worker is unavailable')
  }

  const worker = createImageWorker()
  const id = crypto.randomUUID()

  return new Promise<T>((resolve, reject) => {
    worker.addEventListener('message', async (event: MessageEvent<ImageWorkerResponse>) => {
      const message = event.data
      if (message.id !== id) {
        return
      }

      if (message.type === 'progress') {
        await onProgress?.(message.progress)
        return
      }

      worker.terminate()

      if (message.type === 'error') {
        reject(new Error(message.error))
        return
      }

      resolve(message.result as T)
    })

    worker.addEventListener('error', (event) => {
      worker.terminate()
      reject(event.error instanceof Error ? event.error : new Error('Image worker failed'))
    })

    worker.postMessage({
      ...request,
      id
    } as ImageWorkerRequest)
  })
}
