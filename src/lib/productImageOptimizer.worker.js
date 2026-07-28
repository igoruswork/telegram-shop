const MAX_DIMENSION = 1440;
const WEBP_QUALITY = 0.8;

self.onmessage = async (event) => {
  const { file } = event.data || {};
  const type = String(file?.type || '').toLowerCase();

  if (!file || type.includes('gif') || type.includes('svg') || !self.OffscreenCanvas || !self.createImageBitmap) {
    self.postMessage({ useOriginal: true });
    return;
  }

  try {
    const bitmap = await self.createImageBitmap(file);
    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;
    const scale = Math.min(1, MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { alpha: false });

    if (!context) {
      bitmap.close();
      self.postMessage({ useOriginal: true });
      return;
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
    if (!blob || (scale === 1 && blob.size >= file.size)) {
      self.postMessage({ useOriginal: true });
      return;
    }

    self.postMessage({ blob, width, height });
  } catch {
    self.postMessage({ useOriginal: true });
  }
};
