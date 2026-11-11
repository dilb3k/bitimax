'use client';

import Image from 'next/image';
import { useState, type ReactNode } from 'react';
import { cdnImage } from '@/lib/api';

/**
 * Product photo that falls back to `fallback` when the file is gone or fails to load, instead
 * of leaving a broken-image icon. Delivery goes through Cloudinary's own resizing (f_auto picks
 * WebP/AVIF, q_auto the quality) so the browser downloads a few tens of KB, not the full upload.
 */
export function SafeImage({
  src,
  alt,
  width,
  fallback,
  className,
  sizes,
  priority,
}: {
  src: string;
  alt: string;
  /** Requested delivery width in CSS pixels (doubled internally for sharp high-DPI screens). */
  width: number;
  fallback: ReactNode;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <Image
      src={cdnImage(src, width * 2)}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      // Cloudinary already resized and compressed it; skipping Next's optimizer avoids a second
      // pass and the platform's image-optimization quota.
      unoptimized
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
