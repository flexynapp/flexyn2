// src/components/AvatarUploader.jsx
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Camera, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabaseClient';
import { update as updateMe } from '@/lib/data/me';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { toast } from 'sonner';

/**
 * Circular avatar with optional edit affordance.
 *
 * Props:
 *   src       — current avatar URL (null/undefined renders initials)
 *   initials  — 1–2 char fallback shown when no src
 *   editable  — when true, shows a camera badge that opens a file picker
 *   size      — pixel size of the rendered circle (default 64)
 *   onChange  — optional callback called with the new URL after successful upload
 */
export default function AvatarUploader({ src, initials = '?', editable = false, size = 64, onChange }) {
  const { t } = useLanguage();
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
      // 1. Upload to Supabase Storage
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
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
      console.error(err);
      toast.error(t('avatar.error.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const dim = `${size}px`;

  return (
    <div className="relative inline-block" style={{ width: dim, height: dim }}>
      {/* The circle */}
      <div
        className="w-full h-full rounded-full bg-primary/10 border-2 border-card flex items-center justify-center overflow-hidden font-heading font-bold text-primary"
        style={{ fontSize: Math.round(size * 0.32) }}
      >
        {src ? (
          <img src={src} alt="" className="w-full h-full object-cover" />
        ) : (
          initials || '?'
        )}
      </div>

      {/* Edit badge */}
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
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            aria-label={t('avatar.edit')}
            className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md ring-2 ring-card disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Camera className="w-3.5 h-3.5" />
            )}
          </motion.button>
        </>
      )}
    </div>
  );
}
