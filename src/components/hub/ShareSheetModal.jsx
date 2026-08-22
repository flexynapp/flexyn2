// src/components/hub/ShareSheetModal.jsx
//
// Bottom-sheet for sharing a hub post.
// Surfaces two sharing modes:
//   1. Send in DM — picks a conversation partner, sends a message preview
//   2. External — Twitter/X, WhatsApp, copy link, native Web Share API
//
// Instagram "share" is copy-link only (IG doesn't allow web deep-links
// into composer; users paste the link into a Story or DM manually).

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import {
  X, Send, Check, Link2,
  ExternalLink, Shield,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as hubMessages from '@/lib/data/hubMessages';
import * as users from '@/lib/data/users';
import { getMyCrews, sendCrewMessage } from '@/lib/data/crews';
import { toast } from '@/lib/toast';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

// ── Twitter/X SVG icon ───────────────────────────────────────────────────────
function XIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.266 5.638L18.244 2.25Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z"/>
    </svg>
  );
}

// ── WhatsApp SVG icon ────────────────────────────────────────────────────────
function WhatsAppIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.464 3.488"/>
    </svg>
  );
}

export default function ShareSheetModal({ post, open, onClose }) {
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(open);
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const [tab, setTab]         = useState('external'); // 'dm' | 'crew' | 'external'
  const [copied, setCopied]   = useState(false);
  const [dmSending, setDmSending] = useState(null); // email being sent to
  const [crewSending, setCrewSending] = useState(null); // crew id being sent to

  const origin = (typeof window !== 'undefined' && window.location.origin) || 'https://flexyn.netlify.app';
  // Carry the POST id, not just the author. This link used to drop you on the
  // author's profile with no indication which post was meant — on a prolific
  // account the thing you shared could be twenty rows down. `post` is read by
  // Hub, which opens the Posts tab, scrolls to that row and outlines it.
  const postUrl = post.user_id
    ? `${origin}/hub?profile=${encodeURIComponent(post.user_id)}${post.id ? `&post=${encodeURIComponent(post.id)}` : ''}`
    : origin;
  const postText = (post.body || post.content || 'Check out this post on Flexyn').slice(0, 200);
  const shareTitle = post.author_name ? `${post.author_name} on Flexyn` : 'Flexyn';

  // Shared forward body — same format for DM + Crew so a forwarded post
  // reads consistently in either chat.
  const forwardBody = `📤 Shared a post:\n${postUrl}\n\n"${postText.slice(0, 100)}${postText.length > 100 ? '…' : ''}"`;

  // Load conversation list for DM tab
  const { data: conversations = [] } = useQuery({
    queryKey: ['hubConversations', user?.email],
    queryFn: () => hubMessages.listMyConversations(user.email),
    enabled: !!user?.email && tab === 'dm',
    staleTime: 60_000,
  });

  // Who each conversation is WITH. Every row rendered `@User` from a
  // hardcoded `const handle = 'User'`, so the DM tab was twenty identical
  // rows and picking the right person was guesswork — on a sheet whose only
  // action is an immediate send. Same derivation and same query key as
  // HubMessages, so when both are mounted they share one cache entry.
  const otherIds = (conversations || [])
    .map(c => (c.participant_ids || []).find(id => id && id !== user?.id))
    .filter(Boolean);

  const { data: profilesById = {} } = useQuery({
    queryKey: ['hubMessageProfiles', otherIds.slice().sort().join(',')],
    queryFn: async () => {
      if (otherIds.length === 0) return {};
      const { data } = await users.selectProfiles((from) => from
        .select('id, username, avatar_url')
        .in('id', otherIds));
      const map = {};
      for (const u of (data ?? [])) map[u.id] = u;
      return map;
    },
    enabled: otherIds.length > 0,
    staleTime: 60_000,
  });

  // Load the user's crews for the Crew tab
  const { data: crews = [] } = useQuery({
    queryKey: ['myCrews', user?.id],
    queryFn: () => getMyCrews(user.id),
    enabled: !!user?.id && tab === 'crew',
    staleTime: 60_000,
  });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(postUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(tFallback('shareSheet.copyFailed', 'Could not copy. Try again.'));
    }
  };

  const handleNativeShare = async () => {
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: shareTitle, text: postText, url: postUrl });
        onClose();
      } else {
        await handleCopy();
      }
    } catch (err) {
      if (err?.name !== 'AbortError') await handleCopy();
    }
  };

  const handleSendDm = async (conv) => {
    if (!user?.email || dmSending) return;
    const otherEmail = (conv.participant_emails || []).find(e => e?.toLowerCase() !== user.email?.toLowerCase());
    if (!otherEmail) return;
    setDmSending(conv.id);
    try {
      await hubMessages.sendMessage({
        conversationId: conv.id,
        senderEmail: user.email,
        recipientEmail: otherEmail,
        body: forwardBody,
      });
      toast.success(tFallback("shareSheetModal.sentInDm", "Sent in DM!"));
      onClose();
    } catch {
      toast.error(tFallback('shareSheet.sendFailed', 'Could not send. Try again.'));
    } finally {
      setDmSending(null);
    }
  };

  const handleSendCrew = async (crew) => {
    if (!user?.id || crewSending) return;
    setCrewSending(crew.id);
    try {
      await sendCrewMessage(crew.id, user.id, 'text', forwardBody);
      toast.success(`Sent to ${crew.name}!`);
      onClose();
    } catch {
      toast.error(tFallback('shareSheet.sendFailed', 'Could not send. Try again.'));
    } finally {
      setCrewSending(null);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-card border border-border rounded-t-2xl w-full max-w-md"
            style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
          >
            {/* Handle + close */}
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <div className="w-10 h-1 rounded-full bg-border mx-auto absolute start-0 end-0 top-2" />
              <p className="text-sm font-bold">{tFallback('hub.share.title', 'Share post')}</p>
              <button onClick={onClose} className="p-1 rounded-full hover:bg-secondary active:bg-secondary">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            {/* Tab switcher */}
            <div className="flex gap-1 mx-4 mb-3 p-1 rounded-lg bg-secondary/50">
              {[
                { id: 'dm',       emoji: '💬', label: 'DM' },
                { id: 'crew',     emoji: '🛡️', label: 'Crew' },
                { id: 'external', emoji: '🌐', label: 'Other' },
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                    tab === t.id ? 'bg-card shadow text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {t.emoji} {tFallback(`shareSheet.tab.${t.id}`, t.label)}
                </button>
              ))}
            </div>

            {/* DM tab */}
            {tab === 'dm' && (
              <div className="px-4 max-h-64 overflow-y-auto space-y-1">
                {conversations.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    {tFallback('shareSheet.noConversations', 'No conversations yet. Start a DM first.')}
                  </p>
                ) : (
                  conversations.slice(0, 20).map(conv => {
                    const otherId = (conv.participant_ids || []).find(id => id && id !== user?.id);
                    const username = profilesById[otherId]?.username || null;
                    const avatarUrl = profilesById[otherId]?.avatar_url || null;
                    const handle = username || tFallback('hub.profile.anonymousAthlete', 'Athlete');
                    return (
                      <button
                        key={conv.id}
                        onClick={() => handleSendDm(conv)}
                        disabled={!!dmSending}
                        className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-secondary active:bg-secondary transition-colors disabled:opacity-60"
                      >
                        {avatarUrl ? (
                          <img loading="lazy" src={avatarUrl} alt="" draggable={false}
                            className="w-9 h-9 rounded-full object-cover shrink-0 ring-1 ring-border" />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center font-bold text-sm text-primary shrink-0">
                            {handle.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <span className="flex-1 text-sm font-medium text-start truncate">
                          {username ? `@${username}` : handle}
                        </span>
                        {dmSending === conv.id ? (
                          <span className="text-xs text-muted-foreground">Sending…</span>
                        ) : (
                          <Send className="w-4 h-4 text-muted-foreground shrink-0" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            )}

            {/* Crew tab */}
            {tab === 'crew' && (
              <div className="px-4 max-h-64 overflow-y-auto space-y-1">
                {crews.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    {tFallback('shareSheet.noCrews', 'You are not in any crews yet.')}
                  </p>
                ) : (
                  crews.map(crew => (
                    <button
                      key={crew.id}
                      onClick={() => handleSendCrew(crew)}
                      disabled={!!crewSending}
                      className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-secondary active:bg-secondary transition-colors disabled:opacity-60"
                    >
                      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                        <Shield className="w-4 h-4" />
                      </div>
                      <span className="flex-1 text-sm font-medium text-start truncate">{crew.name}</span>
                      {crewSending === crew.id ? (
                        <span className="text-xs text-muted-foreground">Sending…</span>
                      ) : (
                        <Send className="w-4 h-4 text-muted-foreground shrink-0" />
                      )}
                    </button>
                  ))
                )}
              </div>
            )}

            {/* External tab */}
            {tab === 'external' && (
              <div className="px-4 space-y-2">
                {/* Native share (most prominent on mobile) */}
                <button
                  onClick={handleNativeShare}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span className="text-sm font-semibold">
                    {typeof navigator !== 'undefined' && navigator.share
                      ? tFallback('hub.share.system', 'Share via…')
                      : tFallback('hub.share.copyLink', 'Copy link')}
                  </span>
                </button>

                <div className="grid grid-cols-3 gap-2">
                  {/* Twitter/X */}
                  <button
                    onClick={() => {
                      const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(`${postText.slice(0, 200)} — ${postUrl}`)}`;
                      window.open(url, '_blank', 'noopener,noreferrer');
                    }}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-secondary hover:bg-secondary/80 active:bg-secondary/80 transition-colors"
                  >
                    <XIcon size={20} />
                    <span className="text-micro font-medium">X / Twitter</span>
                  </button>

                  {/* WhatsApp */}
                  <button
                    onClick={() => {
                      const url = `https://wa.me/?text=${encodeURIComponent(`${postText.slice(0, 200)} ${postUrl}`)}`;
                      window.open(url, '_blank', 'noopener,noreferrer');
                    }}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-secondary hover:bg-secondary/80 active:bg-secondary/80 transition-colors text-success"
                  >
                    <WhatsAppIcon size={20} />
                    <span className="text-micro font-medium text-foreground">{tFallback("shareSheetModal.whatsapp", "WhatsApp")}</span>
                  </button>

                  {/* Copy link */}
                  <button
                    onClick={handleCopy}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-secondary hover:bg-secondary/80 active:bg-secondary/80 transition-colors"
                  >
                    {copied ? <Check className="w-5 h-5 text-success" /> : <Link2 className="w-5 h-5" />}
                    <span className="text-micro font-medium">{copied ? 'Copied!' : 'Copy link'}</span>
                  </button>
                </div>

                {/* Instagram note */}
                <p className="text-micro text-muted-foreground text-center pt-1">
                  📸 For Instagram: copy the link and paste it into a Story or DM
                </p>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
