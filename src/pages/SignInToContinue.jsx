import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Mail, Loader2, Check, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/lib/toast';
import { db } from '@/api/db';
import { useLanguage } from '@/lib/LanguageContext';
import { cachedProviders, fetchEnabledProviders } from '@/lib/authProviders';
import TransText from '@/components/TransText';
import { isNative } from '@/lib/native';
import FlexynLogo from '@/components/FlexynLogo';

// Inline SVG glyphs for the OAuth buttons — keeps us off of brand-asset
// CDN fetches and lets the buttons render before any external request.
function GoogleGlyph(props) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.24 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" fill="#34A853" />
      <path d="M5.84 14.11A6.6 6.6 0 0 1 5.5 12c0-.73.12-1.44.34-2.11V7.05H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.95l3.66-2.84Z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" fill="#EA4335" />
    </svg>
  );
}

function AppleGlyph(props) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path fill="currentColor" d="M16.5 1.5c.1 1.3-.4 2.6-1.2 3.5-.8.9-2.1 1.6-3.4 1.5-.1-1.3.5-2.6 1.3-3.5C14 2.1 15.3 1.4 16.5 1.5Zm4 16.7c-.5 1.2-.8 1.7-1.5 2.7-1 1.5-2.4 3.3-4.1 3.3-1.6 0-2-1-4.1-1-2.1 0-2.6 1-4.1 1-1.8 0-3-1.7-4-3.2C-.6 16.6-.9 9.7 4 8c2-.7 3.7-.4 5 .7 1.6 1.2 2.2 1.2 3.5.3 1.8-1.2 5-1.2 6.7 1.2-5.5 3-3.5 9 1.3 8Z" />
    </svg>
  );
}

export default function SignInToContinue({
  onBack = null,
  heading = 'Sign In to Continue',
  subtext = 'Pick up right where you left off. Your workouts, streaks and progress are waiting.',
}) {
  const { tFallback } = useLanguage();
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  // Whether the address they entered already had an account. A magic link
  // signs up and signs in with the same tap, so without this the screen said
  // "check your inbox" identically either way and someone entering the email
  // they already use had no idea they'd just asked to sign back in.
  const [hasExistingAccount, setHasExistingAccount] = useState(false);
  const [sendingMagicLink, setSendingMagicLink] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);

  // Only offer a provider the project actually has. Seeded from the last
  // confirmed answer so returning users do not watch the buttons pop in, then
  // revalidated. On failure we keep what we had — [] when nothing is cached —
  // because widening this list is how a button starts dead-ending again.
  const [providers, setProviders] = useState(() => cachedProviders() ?? []);
  useEffect(() => {
    let alive = true;
    fetchEnabledProviders()
      .then((list) => { if (alive) setProviders(list); })
      .catch(() => { /* keep the cached list; magic link and guest still work */ });
    return () => { alive = false; };
  }, []);
  const [guestLoading, setGuestLoading] = useState(false);

  // Guest / anonymous sign-in — for beta testers hitting OAuth or
  // SMTP rate-limit walls. Creates a real auth.users row with no
  // email; migration 172's trigger writes a placeholder
  // user_profiles.email so the rest of the app's identity layer
  // doesn't blow up. On release, all guest accounts are expected
  // to be reset (kegan's call).
  const handleGuestSignIn = async () => {
    if (guestLoading) return;
    setGuestLoading(true);
    try {
      const res = await db.auth.signInAsGuest();
      if (!res.ok) {
        if (res.reason === 'anonymous_disabled') {
          toast.error(tFallback('signIn.guestDisabled', "Guest sign-in isn't enabled on this server yet."));
        } else {
          toast.error(tFallback('signIn.guestFailedReason', 'Could not start a guest session: {reason}', { reason: res.reason }));
        }
        return;
      }
      // The onAuthStateChange listener in AuthContext picks up the
      // SIGNED_IN event and routes the user into the app. No
      // navigation needed here.
    } catch (err) {
      toast.error(tFallback('signIn.guestFailed', 'Could not start a guest session. Try again.'));
    } finally {
      setGuestLoading(false);
    }
  };

  const handleProvider = async (provider, setter) => {
    setter(true);
    try {
      await db.auth.signInWithProvider(provider, '/');
      // Web: OAuth redirects the page; the spinner stays until the redirect.
      // Native app: nothing redirects. The provider opened in the system
      // browser (or Apple's sheet), and the session arrives through the deep
      // link listener in AuthContext, which unmounts this screen. Release the
      // button now, or dismissing the browser leaves it spinning forever.
      if (isNative()) setter(false);
    } catch (err) {
      setter(false);
      if (provider === 'apple' && isNative()) {
        toast.error(tFallback('signIn.appleFailed', 'Could not sign in with Apple. Try again.'));
      } else {
        toast.error(`Couldn't start ${provider} sign-in. Try again.`);
      }
    }
  };

  const handleMagicLink = async (e) => {
    e?.preventDefault?.();
    const trimmed = email.trim();
    if (!trimmed || sendingMagicLink) return;
    // Basic email format check so users get an inline error before we
    // round-trip to Supabase Auth and back with an opaque "invalid
    // grant" message. Catches typos like "youexample.com" or "you@"
    // without trying to validate every RFC quirk.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error(tFallback('signIn.invalidEmail', "That doesn't look like a valid email address."));
      return;
    }
    setSendingMagicLink(true);
    try {
      const { isNewAccount } = await db.auth.signInWithMagicLink(trimmed, '/');
      setHasExistingAccount(!isNewAccount);
      setEmailSent(true);
    } catch (err) {
      toast.error(err?.message || tFallback('signIn.magicLinkFailed', 'Could not send magic link. Try again.'));
    } finally {
      setSendingMagicLink(false);
    }
  };

  // Reset the "Check your inbox" state so the user can re-send to a
  // corrected email. Previously emailSent=true was terminal — the form
  // disappeared with no way to fix a typo'd address without navigating
  // away and back.
  const handleResetEmail = () => {
    setEmailSent(false);
    setHasExistingAccount(false);
    setEmail('');
  };

  const busy = googleLoading || appleLoading || sendingMagicLink;

  // A labelled rule between the three ways in. `gap-2`, not the banned
  // middle register; the rule is one group with the word it frames.
  const orRule = (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-px bg-border" />
      <span className="text-micro font-bold uppercase tracking-wider text-muted-foreground">
        {tFallback('signIn.or', 'or')}
      </span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );

  return (
    // Drawn as the next step of onboarding, not as a marketing splash. It is
    // reached from the welcome screen's "Build my plan" and "Log in", so it
    // takes the welcome's top bar (wordmark, round back pill), the question
    // steps' condensed display heading set flush left, and the flow's pill
    // controls. The Aurora blobs, the blurred back button and the app icon
    // tile with its orange bloom are gone: gradients, blur and coloured
    // shadows are all on CLAUDE.md's list of generated-UI tells, and the
    // icon tile repeated the wordmark one row below it.
    //
    // Theme tokens throughout rather than forcing `.dark` like the welcome.
    // The welcome is dark because it sits on a photo; the question steps
    // after it follow the app theme, and this is a form like them.
    //
    // `.safe-page`, not `px-6 pb-10 pt-6`. This screen escapes Layout — it is
    // an early return in App.jsx, above everything Layout provides — so it is
    // `fixed inset-0` against a `viewport-fit=cover` viewport and owns its own
    // edges. CLAUDE.md names this exact class of bug: anything positioning its
    // own edges outside Layout needs the insets, and `.safe-page` carries them.
    <div
      className="fixed inset-0 bg-background text-foreground flex flex-col safe-page overflow-y-auto"
      style={{ minHeight: '100dvh' }}
    >
      <div className="w-full max-w-sm mx-auto flex flex-col flex-1 gap-6">
        <div className="flex items-center gap-2 shrink-0 h-11">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label={tFallback("achievements.vault.back", "Back")}
              className="w-11 h-11 rounded-full border border-border/70 bg-card flex items-center justify-center text-foreground shrink-0 transition-colors"
            >
              <ArrowLeft className="w-[17px] h-[17px] rtl:-scale-x-100" strokeWidth={2.5} />
            </button>
          )}
          <FlexynLogo className="h-8" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col gap-2 shrink-0"
        >
          {/* Same display style and size as every onboarding question
              (KineticHeading): .font-hero, the condensed display face at 800. */}
          <h1 className="font-hero text-foreground m-0"
            style={{ fontSize: 'calc(var(--fluid-heading) * 1.1)' }}>
            {heading}
          </h1>
          <p className="m-0 text-body text-muted-foreground max-w-[320px]">
            {subtext}
          </p>
        </motion.div>

        {/* Spare height on a tall phone goes here, so the controls sit in
            thumb reach at the bottom like every step's CTA. */}
        <div className="flex-1 min-h-0" />

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col gap-2 shrink-0"
        >
          {/* OAuth providers, rendered from /auth/v1/settings rather than
              hardcoded — see src/lib/authProviders.js for what that cost.
              Both keep their platform colours: Google's and Apple's sign-in
              guidelines fix the button to white/black, so neither can be the
              orange control. */}
          {providers.includes('google') && (
          <Button
            variant="outline"
            className="w-full h-12 rounded-full font-semibold text-body gap-2 bg-white text-gray-900 hover:bg-gray-50 active:bg-gray-50 hover:text-gray-900 active:text-gray-900 border-gray-300 dark:border-white"
            onClick={() => handleProvider('google', setGoogleLoading)}
            disabled={busy}
          >
            {googleLoading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <GoogleGlyph className="w-4 h-4" />}
            {tFallback('connectAccount.continueWith', 'Continue with {provider}', { provider: 'Google' })}
          </Button>
          )}

          {/* Per Apple's "Sign in with Apple" button guidelines the control
              must invert in dark mode (black-on-light → white-on-dark) so it
              keeps contrast against the background. */}
          {providers.includes('apple') && (
          <Button
            className="w-full h-12 rounded-full font-semibold text-body gap-2 bg-black text-white hover:bg-zinc-900 dark:bg-white dark:text-black dark:hover:bg-zinc-200 dark:active:bg-zinc-200"
            onClick={() => handleProvider('apple', setAppleLoading)}
            disabled={busy}
          >
            {appleLoading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <AppleGlyph className="w-4 h-4 text-white dark:text-black" />}
            {tFallback('connectAccount.continueWith', 'Continue with {provider}', { provider: 'Apple' })}
          </Button>
          )}

          {/* Divider — only when there is something above it to divide from.
              With every provider off, an "or" heading the screen reads as a
              missing control rather than a choice. */}
          {providers.length > 0 && orRule}

          {/* Magic link */}
          {emailSent ? (
            <div className="flex flex-col gap-2">
              {hasExistingAccount ? (
                // The address is already registered. Said plainly, because the
                // alternative — the same "check your inbox" as a brand-new
                // signup — is what let someone reach the end of "Let's get you
                // set up" without ever being told they already have an account.
                // The link we just sent IS the sign-in link, so there is nothing
                // else for them to press. Neutral card: it is information, not
                // a warning, and amber is not one of the app's four hues.
                <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-card border border-border text-foreground text-label">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    <TransText
                      k="signInToContinue.accountExists"
                      en="{headline} We sent a sign-in link to {email}. Tap it and you're back in, with your workouts and streaks intact."
                      values={{
                        headline: <strong>{tFallback("signInToContinue.accountExistsHeadline", "You already have a Flexyn account.")}</strong>,
                        email: <strong>{email}</strong>,
                      }}
                    />
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-success/10 border border-success/30 text-success text-label">
                  <Check className="w-4 h-4 shrink-0" />
                  <span>
                    <TransText
                      k="signIn.linkSentTo"
                      en="Check your inbox. We sent a sign-in link to {email}."
                      values={{ email: <strong>{email}</strong> }}
                    />
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={handleResetEmail}
                className="w-full min-h-11 text-label text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
              >
                {tFallback("signInToContinue.wrongEmailSendAnotherLink", "Wrong email? Send another link")}
              </button>
            </div>
          ) : (
            <form onSubmit={handleMagicLink} className="flex flex-col gap-2">
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder={tFallback('signIn.emailPlaceholder', 'you@example.com')}
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="h-12 rounded-full px-5 bg-card text-body"
                required
              />
              {/* The one orange control. Google and Apple are pinned to their
                  own colours by their guidelines and the guest path is the
                  deliberate escape hatch, so the magic link is the only way
                  in that is ours to colour. Same pill and ink as the
                  onboarding PrimaryBtn: dark `primary-ink` on orange, because
                  white on this orange measures under 3:1. */}
              <button
                type="submit"
                className={`w-full h-12 rounded-full font-heading font-extrabold text-body flex items-center justify-center gap-2 transition-all
                  ${(!email.trim() || busy)
                    ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-60'
                    : 'bg-primary text-primary-ink hover:brightness-105 active:scale-[0.98] shadow-md'}`}
                disabled={!email.trim() || busy}
              >
                {sendingMagicLink
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Mail className="w-4 h-4" />}
                {sendingMagicLink ? 'Sending…' : 'Send magic link'}
              </button>
            </form>
          )}

          {/* Guest sign-in — for beta testers hitting OAuth or
              SMTP-rate-limit walls. Visually de-emphasized so it
              reads as the "just let me in for now" escape hatch,
              not the primary action. Hidden once the magic-link
              success state is showing so we don't push a second CTA
              against the "check your inbox" message. */}
          {!emailSent && (
            <>
              {orRule}
              <Button
                variant="ghost"
                onClick={handleGuestSignIn}
                disabled={guestLoading || busy}
                className="w-full h-12 rounded-full font-semibold text-body gap-2 text-foreground hover:bg-card active:bg-card"
              >
                {guestLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {tFallback('signIn.continueAsGuest', 'Continue as guest')}
              </Button>
              <p className="m-0 text-micro text-muted-foreground text-center leading-relaxed">
                {tFallback('signInToContinue.betaNote', 'Beta access. Your data lives on this device until you link an email. Accounts may be reset at launch.')}
              </p>
              {/* GDPR Art. 13 wants the notice available at the point of
                  collection, and both stores check that it is reachable
                  before sign-up — so these are plain <a> tags to the public
                  routes, not in-app links behind the auth gate. */}
              <p className="m-0 text-micro text-muted-foreground text-center leading-relaxed">
                By continuing you agree to our{' '}
                <a href="/terms" className="underline py-4 -my-4 hover:text-foreground">{tFallback("signInToContinue.terms", "Terms")}</a>
                {' '}and{' '}
                <a href="/privacy" className="underline py-4 -my-4 hover:text-foreground">{tFallback("legal.privacyPolicy", "Privacy Policy")}</a>.
              </p>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}
