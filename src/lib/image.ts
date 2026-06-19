/**
 * Downscale + recompress an image file entirely in the browser before upload,
 * so phone photos (often several MB) become a few hundred KB. Returns a JPEG
 * `data:` URL ready to send to the server. Respects EXIF orientation.
 */
export async function resizeImageToDataUrl(
  file: Blob,
  maxDim = 1280,
  quality = 0.82,
): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    let { width, height } = bitmap
    const scale = Math.min(1, maxDim / Math.max(width, height))
    width = Math.max(1, Math.round(width * scale))
    height = Math.max(1, Math.round(height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Kunne ikke behandle bildet.')
    // White backdrop so transparent PNGs don't turn black when flattened to JPEG.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)

    return canvas.toDataURL('image/jpeg', quality)
  } finally {
    bitmap.close()
  }
}

/** Pull the first image file out of a paste/drop, if any. */
export function imageFileFromDataTransfer(
  dt: DataTransfer | null,
): File | null {
  if (!dt) return null
  for (const item of dt.items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) return file
    }
  }
  for (const file of dt.files) {
    if (file.type.startsWith('image/')) return file
  }
  return null
}
