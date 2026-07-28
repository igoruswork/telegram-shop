import React, { useEffect, useState } from 'react';

function getStorageObjectFallback(src) {
  try {
    const url = new URL(src);
    const marker = '/storage/v1/render/image/public/';
    const index = url.pathname.indexOf(marker);

    if (index === -1) return '';

    const path = url.pathname.slice(index + marker.length);
    return `${url.origin}/storage/v1/object/public/${path}`;
  } catch {
    return '';
  }
}

function getResponsiveStorageSrcSet(src) {
  try {
    const url = new URL(src);
    if (!url.pathname.includes('/storage/v1/render/image/public/')) return undefined;

    return [320, 480, 640, 960]
      .map((width) => {
        const candidate = new URL(url);
        candidate.searchParams.set('width', String(width));
        return `${candidate.toString()} ${width}w`;
      })
      .join(', ');
  } catch {
    return undefined;
  }
}

export function SafeImage({
  src,
  alt,
  className,
  placeholderClassName,
  placeholder = '📦',
  loading = 'lazy',
  decoding = 'async',
  fetchPriority,
  sizes,
  ...props
}) {
  const [failed, setFailed] = useState(false);
  const [fallbackSrc, setFallbackSrc] = useState('');

  useEffect(() => {
    setFailed(false);
    setFallbackSrc('');
  }, [src]);

  if (!src || failed) {
    return (
      <div
        className={placeholderClassName || className}
        role="img"
        aria-label={alt || 'Зображення недоступне'}
        data-image-placeholder="true"
      >
        {placeholder}
      </div>
    );
  }

  const activeSrc = fallbackSrc || src;
  const responsiveSrcSet = fallbackSrc ? undefined : getResponsiveStorageSrcSet(src);

  return (
    <img
      className={className}
      src={activeSrc}
      alt={alt}
      loading={loading}
      decoding={decoding}
      fetchPriority={fetchPriority}
      srcSet={responsiveSrcSet}
      sizes={responsiveSrcSet ? (sizes || '100vw') : undefined}
      onError={() => {
        const nextFallback = fallbackSrc ? '' : getStorageObjectFallback(src);
        if (nextFallback && nextFallback !== src) {
          setFallbackSrc(nextFallback);
          return;
        }

        setFailed(true);
      }}
      {...props}
    />
  );
}
