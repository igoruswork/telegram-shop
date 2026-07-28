const OPTIMIZER_TIMEOUT_MS = 30000;

export async function optimizeProductImageFile(file) {
  const type = String(file?.type || '').toLowerCase();
  const supportsWorkerOptimization = (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof createImageBitmap !== 'undefined' &&
    !type.includes('gif') &&
    !type.includes('svg')
  );

  if (!supportsWorkerOptimization) return file;

  return new Promise((resolve) => {
    const worker = new Worker(new URL('./productImageOptimizer.worker.js', import.meta.url), { type: 'module' });
    const timeout = window.setTimeout(() => {
      worker.terminate();
      resolve(file);
    }, OPTIMIZER_TIMEOUT_MS);

    worker.onmessage = ({ data }) => {
      window.clearTimeout(timeout);
      worker.terminate();

      if (!data?.blob || data.useOriginal) {
        resolve(file);
        return;
      }

      const originalName = String(file.name || 'product-image').replace(/\.[^.]+$/, '') || 'product-image';
      resolve(new File([data.blob], `${originalName}.webp`, {
        type: 'image/webp',
        lastModified: Date.now(),
      }));
    };

    worker.onerror = () => {
      window.clearTimeout(timeout);
      worker.terminate();
      resolve(file);
    };

    worker.postMessage({ file });
  });
}
