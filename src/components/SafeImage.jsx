import React, { useEffect, useState } from 'react';

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

  useEffect(() => {
    setFailed(false);
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
      src={src}
      alt={alt}
      loading={loading}
      decoding={decoding}
      fetchPriority={fetchPriority}
      onError={() => setFailed(true)}
      {...props}
    />
  );
}
