// src/components/workout/EquipmentThumb.jsx
//
// Thumbnail for a piece of equipment, running the image fallback chain:
// this space's photo → an approved photo of the same model → an
// openly-licensed reference photo → a drawn silhouette. The chain always
// terminates, so this never renders an empty box.
//
// Lives in its own module rather than inside ImplementPicker because the
// gym page's equipment tab needs it too, and importing it from the
// picker dragged a 31 KB chunk — camera capture, image compression, the
// Storage upload path, the gym-floor queries — onto a page that just
// wants to draw a 40px image.

import React, { useState } from 'react';
import { resolveEquipmentImage } from '@/lib/equipmentImage';
import EquipmentSilhouette from './equipmentSilhouettes';

export default function EquipmentThumb({ implement, size = 36 }) {
  const [broken, setBroken] = useState(false);
  const resolved = resolveEquipmentImage({
    spacePhotoUrl: broken ? null : implement?.photoUrl,
    modelPhotoUrl: broken ? null : implement?.modelPhotoUrl,
    implementType: implement?.implementType,
  });

  const box = 'rounded-md bg-secondary/70 shrink-0 flex items-center justify-center overflow-hidden';
  const style = { width: size, height: size };

  if (resolved.url) {
    return (
      <span className={box} style={style}>
        <img
          src={resolved.url}
          alt=""
          loading="lazy"
          // A dead Storage URL must degrade to the silhouette rather
          // than a broken-image glyph.
          onError={() => setBroken(true)}
          className="w-full h-full object-cover"
        />
      </span>
    );
  }

  return (
    <span className={`${box} text-muted-foreground`} style={style}>
      <EquipmentSilhouette
        implementType={implement?.implementType}
        className="w-3/4 h-3/4"
      />
    </span>
  );
}
