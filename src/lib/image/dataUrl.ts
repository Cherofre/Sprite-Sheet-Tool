const DATA_URL_PREFIX = 'data:'

const decodeBase64 = (payload: string): Uint8Array => {
  const decoded = atob(payload)
  const bytes = new Uint8Array(decoded.length)

  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index)
  }

  return bytes
}

const decodeTextPayload = (payload: string): Uint8Array => {
  const decoded = decodeURIComponent(payload)
  return new TextEncoder().encode(decoded)
}

const bytesToArrayBuffer = (bytes: Uint8Array): ArrayBuffer => Uint8Array.from(bytes).buffer

export const dataUrlToBytes = (dataUrl: string): Uint8Array => {
  if (!dataUrl.startsWith(DATA_URL_PREFIX)) {
    throw new Error('Unsupported data URL')
  }

  const separatorIndex = dataUrl.indexOf(',')
  if (separatorIndex < 0) {
    throw new Error('Malformed data URL')
  }

  const metadata = dataUrl.slice(DATA_URL_PREFIX.length, separatorIndex)
  const payload = dataUrl.slice(separatorIndex + 1)
  const isBase64 = metadata.split(';').includes('base64')

  return isBase64 ? decodeBase64(payload) : decodeTextPayload(payload)
}

export const dataUrlToArrayBuffer = (dataUrl: string): ArrayBuffer => bytesToArrayBuffer(dataUrlToBytes(dataUrl))

export const dataUrlToBlob = (dataUrl: string): Blob => {
  const separatorIndex = dataUrl.indexOf(',')
  const metadata = separatorIndex >= 0 ? dataUrl.slice(DATA_URL_PREFIX.length, separatorIndex) : ''
  const mimeType = metadata.split(';')[0] || 'application/octet-stream'

  return new Blob([dataUrlToArrayBuffer(dataUrl)], { type: mimeType })
}
