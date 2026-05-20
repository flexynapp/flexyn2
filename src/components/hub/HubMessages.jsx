import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Loader2, MessageCircle, Lock, Shield, ChevronRight, Users } from 'lucide-react';
import { format, parseISO, differenceInDays, formatDistanceToNowStrict } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as hubMessages from '@/lib/data/hubMessages';
import * as users from '@/lib/data/users';
import * as crewsData from '@/lib/data/crews';
import HubChat from './HubChat';
import CrewChat from '@/components/crews/CrewChat';

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
  const [activeCrew, setActiveCrew] = useState(null); // crew object for crew chat
  const [tab, setTab] = useState('dms'); // 'dms' | 'crews'

  const { data: conversations = [], isLoading } = useQuery({
    queryKey: ['hubConversations', user?.email],
    queryFn: () => hubMessages.listMyConversations(user.email),
    enabled: !!user?.email,
    refetchInterval: 15000,
  });

  const { data: myCrews = [], isLoading: crewsLoading } = useQuery({
    queryKey: ['myCrews', user?.id],
    queryFn: () => crewsData.getMyCrews(user.id),
    enabled: !!user?.id && tab === 'crews',
    staleTime: 30_000,
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

  // ── Active DM chat ────────────────────────────────────────────────────────────
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

  // ── Active Crew chat ──────────────────────────────────────────────────────────
  if (activeCrew) {
    return (
      <CrewChat
        crew={activeCrew}
        onBack={() => setActiveCrew(null)}
        onViewProfile={null}
      />
    );
  }

  return (
    <div>
      {/* Tab toggle */}
      <div className="flex items-center gap-1 mb-4 bg-secondary/30 rounded-xl p-1">
        <button
          onClick={() => setTab('dms')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
            tab === 'dms' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <MessageCircle className="w-4 h-4" />
          Messages
        </button>
        <button
          onClick={() => setTab('crews')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
            tab === 'crews' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Shield className="w-4 h-4" />
          Crews
        </button>
      </div>

      {/* ── DMs tab ────────────────────────────────────────────────────────── */}
      {tab === 'dms' && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <Lock className="w-3.5 h-3.5 text-muted-foreground" title={t('hub.messages.privateNote')} />
            <p className="text-xs text-muted-foreground">{t('hub.messages.privateNote')}</p>
          </div>

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
                const username = profile?.username || emailToHandle(otherEmail);
                const handle = username ? `@${username}` : t('hub.profile.anonymousAthlete');
                const initials = (username || '?').slice(0, 2).toUpperCase();
                const lastMsg = c.latestMessage;
                let preview = t('hub.messages.noMessagesYet');
                const lastMsgText = lastMsg?.body || lastMsg?.content;
                if (lastMsgText) {
                  const isMine = lastMsg.sender_email?.toLowerCase() === user?.email?.toLowerCase();
                  // Feature 23: clean up trade offer previews
                  const isTradeOffer =
                    lastMsg.message_type === 'trade_offer' ||
                    lastMsgText.startsWith('[TRADE_OFFER_V1]');
                  const displayText = isTradeOffer ? '📦 Trade offer sent.' : lastMsgText;
                  preview = isMine ? `You: ${displayText}` : displayText;
                }
                const unread = (c.unreadCount || 0) > 0;
                const timeStr = formatInboxTime(lastMsg?.created_date || lastMsg?.created_at || c.last_message_at);

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
                    <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0 font-heading font-bold text-primary text-base overflow-hidden">
                      {profile?.avatar_url ? (
                        <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className={`font-heading text-sm truncate ${unread ? 'font-bold text-foreground' : 'font-semibold text-foreground'}`}>
                          {handle}
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <p className={`text-sm truncate ${unread ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                          {preview}
                          {timeStr && <span className="text-muted-foreground font-normal"> · {timeStr}</span>}
                        </p>
                        {unread && <span className="w-2.5 h-2.5 rounded-full bg-primary shrink-0" aria-label="Unread" />}
                      </div>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Crews tab ──────────────────────────────────────────────────────── */}
      {tab === 'crews' && (
        <>
          {crewsLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : myCrews.length === 0 ? (
            <div className="text-center py-12">
              <Shield className="w-12 h-12 mx-auto text-muted-foreground mb-2" />
              <p className="font-heading font-bold text-base">No Crews yet</p>
              <p className="text-sm text-muted-foreground">Join or create a Crew from the Hub tab.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {myCrews.map((crew, i) => (
                <motion.button
                  key={crew.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => setActiveCrew(crew)}
                  className="w-full flex items-center gap-3 p-4 rounded-2xl bg-card border border-border text-left hover:bg-secondary/30 active:bg-secondary/50 transition-colors"
                >
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: 'hsl(var(--primary) / 0.12)' }}
                  >
                    <Shield className="w-5 h-5" style={{ color: 'hsl(var(--primary))' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-heading font-bold text-sm text-foreground truncate">{crew.name}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Users className="w-3 h-3" />
                      {crew.max_capacity ? `up to ${crew.max_capacity} members` : 'Group Chat'}
                      {crew.is_admin && (
                        <span
                          className="ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide"
                          style={{ background: 'hsl(var(--primary) / 0.15)', color: 'hsl(var(--primary))' }}
                        >
                          Admin
                        </span>
                      )}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </motion.button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
