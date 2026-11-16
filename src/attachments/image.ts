import { ATTACHMENT_LIMITS } from '../../shared/attachments';

const JPEG_QUALITY = 0.82;

/** Size that fits within `maxSide` on the longest side, never upscaling. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** JPEG data URL of the canvas, on a white background (JPEG has no transparency). */
export function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

/** Downscales an image file and re-encodes it as JPEG: smaller upload, no metadata (EXIF, location). */
export async function imageFileToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, ATTACHMENT_LIMITS.imageMaxSide);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas not available');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return canvasToDataUrl(canvas);
  } finally {
    bitmap.close();
  }
}
