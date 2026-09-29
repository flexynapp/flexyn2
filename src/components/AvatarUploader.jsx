// src/components/AvatarUploader.jsx
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Camera, Loader2, Plus } from 'lucide-react';
import { db } from '@/api/db';
import { supabase } from '@/api/supabaseClient';
import { update as updateMe } from '@/lib/data/me';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { reportError } from '@/lib/reportError';
import { compressImage } from '@/lib/imageCompress';
import { toast } from '@/lib/toast';
import { getAvatarGradient } from '@/lib/avatarGradient';

/**
 * Circular avatar with optional edit affordance.
 *
 * Props:
 *   src       — current avatar URL (null/undefined renders initials)
 *   initials  — 1–2 char fallback shown when no src
 *   editable  — when true, shows an edit affordance that opens a file picker
 *   variant   — how that affordance is drawn:
 *                 'badge'   (default) a camera pip on the bottom-end corner
 *                 'overlay' the whole circle dims and takes a white plus,
 *                           and the circle itself is the click target
 *               'overlay' exists because a corner pip has to compete for that
 *               corner: on the profile header the "Add to story" camera
 *               already owns it, which is why avatar upload had been exiled to
 *               a separate "Tap to change avatar" row in the edit panel. Making
 *               the photo itself the control removes the collision instead of
 *               routing around it, and it is the shape people expect from
 *               every other app that edits an avatar.
 *   size      — pixel size of the rendered circle (default 64)
 *   onChange  — optional callback called with the new URL after successful upload
 *   frameCss  — optional inline-style object from a LootFrame's `css` field.
 *               Applied to a wrapper around the circle so gradient/animated
 *               frames render correctly without competing with the avatar's
 *               own border. When omitted the default `border-card` border
 *               is used (no frame equipped).
 *   frameAnimation — optional CSS animation name for animated frames
 *               (e.g. "frame-pulse", "frame-rainbow"). Wired up in src/index.css.
 */
export default function AvatarUploader({ src, initials = '?', seed = '', neutral = false, editable = false, variant = 'badge', size = 64, onChange, frameCss = null, frameAnimation = null }) {
  const { t, tFallback } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error(t('avatar.error.fileType'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('avatar.error.tooLarge'));
      return;
    }
    setUploading(true);
    try {
      // Downscale + re-encode before upload — a 12MP iPhone photo
      // shouldn't burn through 4 MB of mobile data when the rendered
      // avatar is 96px on screen.
      const compressed = await compressImage(file, { maxWidth: 800, maxHeight: 800, quality: 0.85 });

      // 1. Upload to Supabase Storage
      const { file_url } = await db.integrations.Core.UploadFile({ file: compressed });
      if (!file_url) throw new Error('No URL returned');

      // 2. Save to profile
      await updateMe({ avatar_url: file_url });

      // 3. Backfill hub posts so the avatar updates on all previous posts
      if (user?.email) {
        await supabase
          .from('hub_posts')
          .update({ author_avatar_url: file_url })
          .eq('author_email', user.email)
          .catch(() => {}); // non-critical — posts will still resolve via live lookup
      }

      // 4. Invalidate all caches that carry avatar data
      queryClient.invalidateQueries({ queryKey: ['userProfile'] });
      queryClient.invalidateQueries({ queryKey: ['hubProfileLookup'] });
      queryClient.invalidateQueries({ queryKey: ['hubAuthorsList'] });
      queryClient.invalidateQueries({ queryKey: ['hubFeed'] });

      if (onChange) onChange(file_url);
      toast.success(t('avatar.uploaded'));
    } catch (err) {
      reportError(err, { feature: 'avatar.upload', level: 'warning' });
      toast.error(t('avatar.error.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const dim = `${size}px`;

  // Deterministic gradient for the initials fallback circle — same seed
  // always maps to the same gradient so avatars are visually stable.
  const { gradient: fallbackGradient } = src
    ? { gradient: undefined }
    : getAvatarGradient(seed || initials || '');

  // When a frame is equipped, apply its CSS to a wrapper that sits OUTSIDE the
  // avatar circle. This lets gradient frames (which need their own border +
  // backgroundImage trick) render without conflicting with the default
  // `border-card` ring. Animated frames pick up keyframes via animationName.
  //
  // Override-order rule: defaults FIRST, frameCss LAST so any frame that
  // defines its own borderRadius / padding / shape (square, hex, animated
  // ring with custom padding) wins. Previously the order was reversed
  // and every frame silently got flattened to a 2px round wrapper.
  const hasFrame = !!frameCss;
  const frameStyle = hasFrame
    ? {
        // Defaults — applied only when the frame doesn't specify them.
        borderRadius: '9999px',
        padding: '2px',
        // Animation defaults; cleared/overridden below for non-animated frames.
        animationIterationCount: 'infinite',
        animationTimingFunction: 'ease-in-out',
        // Frame-defined CSS wins over the defaults above.
        ...frameCss,
        // Animation name comes from the prop, not from frameCss. Override
        // last so the explicit prop is authoritative. Setting animationName
        // to undefined disables the animation when none is specified.
        animationName: frameAnimation || undefined,
        animationDuration: frameAnimation ? '3s' : undefined,
      }
    : null;

  return (
    <div className="relative inline-block" style={{ width: dim, height: dim }}>
      {/* Optional frame wrapper — only rendered when frameCss is present */}
      <div
        className={hasFrame ? 'w-full h-full' : 'w-full h-full'}
        style={frameStyle || undefined}
      >
        {/* The circle */}
        <div
          className={[
            'w-full h-full rounded-full flex items-center justify-center overflow-hidden font-heading font-bold',
            src ? 'bg-primary/10 text-primary' : neutral ? 'bg-muted text-foreground' : 'text-white',
            hasFrame ? '' : 'border-2 border-card',
          ].join(' ')}
          style={{
            fontSize: Math.round(size * 0.32),
            // `neutral` drops the seeded gradient for a plain muted disc.
            // The profile header uses it: the palette reserves purple for
            // rarity, and five of the twelve gradient pairs are purple or
            // pink, so a profile could open on a colour that means "epic".
            background: src || neutral ? undefined : fallbackGradient,
          }}
        >
          {src ? (
            <img loading="lazy" src={src} alt="" className="w-full h-full object-cover" />
          ) : (
            initials || '?'
          )}
        </div>
      </div>

      {/* Edit affordance */}
      {editable && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="absolute opacity-0 w-0 h-0"
            onChange={handleFile}
            disabled={uploading}
          />
          {variant === 'overlay' ? (
            /* The whole circle is the button. `title` gives the desktop
               tooltip; the aria-label carries the same thing for a screen
               reader and for touch, where no tooltip can ever fire — so the
               control is never explained by hover alone. */
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label={tFallback('avatar.changePhoto', 'Change your profile photo')}
              title={tFallback('avatar.changePhoto', 'Change your profile photo')}
              className="absolute inset-0 rounded-full flex items-center justify-center bg-black/45 hover:bg-black/55 transition-colors disabled:opacity-70"
            >
              {uploading ? (
                <Loader2 className="w-6 h-6 animate-spin text-white" />
              ) : (
                <Plus className="w-7 h-7 text-white" strokeWidth={2.5} />
              )}
            </motion.button>
          ) : (
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label={t('avatar.edit')}
              className="absolute bottom-0 end-0 w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md ring-2 ring-card disabled:opacity-50"
            >
              {uploading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Camera className="w-3.5 h-3.5" />
              )}
            </motion.button>
          )}
        </>
      )}
    </div>
  );
}
