/**
 * Prepares a photo for upload: fixes its orientation, shrinks it and re-encodes it as JPEG.
 *
 * Phone cameras produce 3-8 MB files, which is over what the hosting platform lets through one
 * request (about 4.5 MB) and needlessly slow on mobile data. A listing photo never needs more
 * than ~1600 px on its long edge, so the result is typically 200-600 KB.
 */

export class ImageError extends Error {}

const MAX_EDGE = 1600;
const SMALLER_EDGE = 1280;
const MAX_INPUT_BYTES = 30 * 1024 * 1024;
/** What may be sent; the server enforces its own, tighter, limit as well. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const EXTENSION_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

/** Some browsers report an empty or odd MIME type for valid photos; fall back to the extension. */
function detectType(file: File): string {
  const reported = file.type === 'image/jpg' ? 'image/jpeg' : file.type;
  if (reported) return reported;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_TYPES[ext] ?? '';
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ImageError('Rasmni tayyorlab bo‘lmadi'))), 'image/jpeg', quality)
  );
}

async function render(bitmap: ImageBitmap, maxEdge: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new ImageError('Brauzer rasmni qayta ishlay olmadi');
  // JPEG has no transparency: paint white first so a transparent PNG does not turn black.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  return toBlob(canvas, quality);
}

export async function prepareImage(file: File): Promise<File> {
  const type = detectType(file);
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(type)) {
    throw new ImageError('Faqat JPG, PNG yoki WEBP rasm yuklash mumkin');
  }
  if (file.size > MAX_INPUT_BYTES) throw new ImageError('Rasm juda katta, kichikroq rasm tanlang');

  let bitmap: ImageBitmap;
  try {
    // 'from-image' applies the EXIF rotation, so a portrait phone photo is not uploaded sideways.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ImageError(
      type.startsWith('image/hei')
        ? 'Bu format qo‘llab-quvvatlanmaydi, JPG yoki PNG tanlang'
        : 'Rasmni o‘qib bo‘lmadi. Boshqa rasm tanlang'
    );
  }

  try {
    let blob = await render(bitmap, MAX_EDGE, 0.82);
    if (blob.size > MAX_UPLOAD_BYTES) blob = await render(bitmap, SMALLER_EDGE, 0.7);
    if (blob.size > MAX_UPLOAD_BYTES) throw new ImageError('Rasm juda katta, kichikroq rasm tanlang');
    const base = file.name.replace(/\.[^.]+$/, '') || 'rasm';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}
