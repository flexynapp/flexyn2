import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Loader2, MessageCircle, Lock } from 'lucide-react';
import { format, parseISO, differenceInDays, formatDistanceToNowStrict } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as hubMessages from '@/lib/data/hubMessages';
import * as users from '@/lib/data/users';
import HubChat from './HubChat';

// Instagram-style relative time: "5m", "2h", "Yesterday", "Mon", "May 1"
function formatInboxTime(dateStr) {
  if (!dateStr) return '';
  const date = parseISO(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const days = differenceInDays(now, date);
  if (days === 0) return formatDistanceToNowStrict(date).replace(' hours', 'h').replace(' hour', 'h').replace(' minutes', 'm').replace(' minute', 'm');
  if (days === 1) return 'Yesterday';
  if (days < 7) return format(date, 'EEE');
  return format(date, 'MMM d');
}

// Email handle fallback when Base44 strips username from cross-user reads
function emailToHandle(email) {
  if (!email) return null;
  return email.split('@')[0];
}

export default function HubMessages({ pendingChatTarget = null, onPendingConsumed = null }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeConv, setActiveConv] = useState(null);
  const [openOtherUser, setOpenOtherUser] = useState(null);

  const { data: conversations = [], isLoading } = useQuery({
    queryKey: ['hubConversations', user?.email],
    queryFn: () => hubMessages.listMyConversations(user.email),
    enabled: !!user?.email,
    refetchInterval: 15000, // Instagram-style: refresh inbox often
  });

  const otherEmails = (conversations || [])
    .map(c => (c.participant_emails || []).find(e => e?.toLowerCase() !== user?.email?.toLowerCase()))
    .filter(Boolean);

  const { data: profilesByEmail = {} } = useQuery({
    queryKey: ['hubMessageProfiles', otherEmails.sort().join(',')],
    queryFn: async () => {
      if (otherEmails.length === 0) return {};
      const all = await users.list().catch(() => []);
      const otherEmailsLc = new Set(otherEmails.map(e => e?.toLowerCase()).filter(Boolean));
      const map = {};
      for (const u of all) {
        const lc = u.email?.toLowerCase();
        if (lc && otherEmailsLc.has(lc)) map[lc] = u;
      }
      return map;
    },
    enabled: otherEmails.length > 0,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (pendingChatTarget?.conversation?.id) {
      setActiveConv(pendingChatTarget.conversation);
      setOpenOtherUser(pendingChatTarget.otherUser || null);
      onPendingConsumed && onPendingConsumed();
    }
  }, [pendingChatTarget, onPendingConsumed]);

  if (activeConv) {
    const conv = conversations.find(c => c.id === activeConv.id) || activeConv;
    return (
      <HubChat
        conversation={conv}
        otherUser={openOtherUser}
        onBack={() => {
          setActiveConv(null);
          setOpenOtherUser(null);
          queryClient.invalidateQueries({ queryKey: ['hubConversations'] });
        }}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="font-heading font-bold text-lg">{t('hub.messages.title')}</h2>
        <Lock className="w-3.5 h-3.5 text-muted-foreground" title={t('hub.messages.privateNote')} />
      </div>
      <p className="text-xs text-muted-foreground mb-4">{t('hub.messages.privateNote')}</p>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : conversations.length === 0 ? (
        <div className="text-center py-12">
          <MessageCircle className="w-12 h-12 mx-auto text-muted-foreground mb-2" />
          <p className="font-heading font-bold text-base">{t('hub.messages.empty.title')}</p>
          <p className="text-sm text-muted-foreground">{t('hub.messages.empty.desc')}</p>
        </div>
      ) : (
        <div className="space-y-1">
          {conversations.map((c, i) => {
            const otherEmail = (c.participant_emails || []).find(e => e?.toLowerCase() !== user?.email?.toLowerCase()) || '';
            const profile = profilesByEmail[otherEmail?.toLowerCase()];

            // Username chain: profile (often stripped by Base44) → email-derived
            const username = profile?.username || emailToHandle(otherEmail);
            const handle = username ? `@${username}` : t('hub.profile.anonymousAthlete');
            const initials = (username || '?').slice(0, 2).toUpperCase();

            // Compute Instagram-style preview from the actual latest message
            const lastMsg = c.latestMessage;
            let preview = t('hub.messages.noMessagesYet');
            const lastMsgText = lastMsg?.body || lastMsg?.content;
            if (lastMsgText) {
              const isMine = lastMsg.sender_email?.toLowerCase() === user?.email?.toLowerCase();
              preview = isMine ? `You: ${lastMsgText}` : lastMsgText;
            }

            const unread = (c.unreadCount || 0) > 0;
            const timeStr = formatInboxTime(
              lastMsg?.created_date || lastMsg?.created_at || c.last_message_at
            );

            return (
              <motion.button
                key={c.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => {
                  setActiveConv(c);
                  setOpenOtherUser(profile || { email: otherEmail, username });
                }}
                className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-secondary/40 active:bg-secondary/60 transition-colors text-left"
              >
                {/* Avatar */}
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0 font-heading font-bold text-primary text-base overflow-hidden">
                  {profile?.avatar_url ? (
                    <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    initials
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className={`font-heading text-sm truncate ${unread ? 'font-bold text-foreground' : 'font-semibold text-foreground'}`}>
                      {handle}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <p className={`text-sm truncate ${unread ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                      {preview}
                      {timeStr && (
                        <span className="text-muted-foreground font-normal"> · {timeStr}</span>
                      )}
                    </p>
                    {unread && (
                      <span className="w-2.5 h-2.5 rounded-full bg-primary shrink-0" aria-label="Unread" />
                    )}
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}