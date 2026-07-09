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

export function SafeImage({
  src,
  alt,
  className,
  placeholderClassName,
  placeholder = '📦',
  loading = 'lazy',
  decoding = 'async',
  fetchPriority,
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

  return (
    <img
      className={className}
      src={fallbackSrc || src}
      alt={alt}
      loading={loading}
      decoding={decoding}
      fetchPriority={fetchPriority}
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
