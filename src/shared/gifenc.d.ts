declare module 'gifenc' {
  export type GifPalette = Array<[number, number, number] | [number, number, number, number]>

  export interface GifEncoderOptions {
    auto?: boolean
    initialCapacity?: number
  }

  export interface GifFrameOptions {
    colorDepth?: number
    delay?: number
    dispose?: number
    first?: boolean
    palette?: GifPalette | null
    repeat?: number
    transparent?: boolean
    transparentIndex?: number
  }

  export interface GifEncoderInstance {
    bytes(): Uint8Array
    bytesView(): Uint8Array
    finish(): void
    reset(): void
    writeFrame(index: Uint8Array, width: number, height: number, options?: GifFrameOptions): void
  }

  export function GIFEncoder(options?: GifEncoderOptions): GifEncoderInstance

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: {
      clearAlpha?: boolean
      clearAlphaColor?: number
      clearAlphaThreshold?: number
      format?: 'rgb565' | 'rgb444' | 'rgba4444'
      oneBitAlpha?: boolean | number
    }
  ): GifPalette

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: 'rgb565' | 'rgb444' | 'rgba4444'
  ): Uint8Array
}
