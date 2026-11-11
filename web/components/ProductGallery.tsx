'use client';

import { useState } from 'react';
import { SafeImage } from './SafeImage';

/**
 * Main image + thumbnail strip for a product's detail page. Kept as its own client component
 * (rather than inline in the server-rendered detail page) because switching the active image
 * needs state — everything else on that page is static per request.
 */
export function ProductGallery({ images, title }: { images: string[]; title: string }) {
  const [active, setActive] = useState(0);

  if (images.length === 0) {
    return (
      <div className="surface flex aspect-[4/3] items-center justify-center text-faint">
        <PlaceholderIcon />
      </div>
    );
  }

  return (
    <div>
      <div className="surface aspect-[4/3] overflow-hidden">
        <div className="relative h-full w-full">
          <SafeImage
            key={images[active]}
            src={images[active]}
            alt={title}
            width={640}
            sizes="(max-width: 1024px) 100vw, 50vw"
            priority
            className="object-cover"
            fallback={<div className="flex h-full w-full items-center justify-center text-faint"><PlaceholderIcon /></div>}
          />
        </div>
      </div>

      {images.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {images.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`${i + 1}-rasm`}
              aria-current={i === active}
              className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition ${
                i === active ? 'border-accent' : 'border-transparent opacity-70 hover:opacity-100'
              }`}
            >
              <span className="relative block h-full w-full">
                <SafeImage src={url} alt="" width={64} sizes="64px" className="object-cover" fallback={<span className="block h-full w-full bg-raised" />} />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PlaceholderIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8.5" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="m5 17 4.5-4.5a1.5 1.5 0 0 1 2 0L15 16l1.2-1.2a1.5 1.5 0 0 1 2 0L21 17.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
