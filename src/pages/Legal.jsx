// src/pages/Legal.jsx
//
// /privacy and /terms. Both are PUBLIC surfaces — they mount above the auth
// gate in App.jsx, because an App Review reviewer, a Play Store listing and a
// GDPR Art. 13 notice all have to reach them without an account.
//
// The app had neither route. It was filed as launch blocker C1 in the June
// audit and was still open eight weeks later, which matters more here than in
// most products: Flexyn collects special-category health data (body weight and
// photos, injuries, mood, sleep, and opt-in menstrual cycle logs), hosts UGC
// and carries direct messages. Apple 5.1.1(i) and Google Play's Health apps
// policy both hard-require a policy; GDPR Art. 13 requires one independently
// of either store.
//
// ── READ THIS BEFORE SHIPPING ────────────────────────────────────────────
// The disclosures below are accurate to what the code actually does — the
// data categories are drawn from the live schema and the sub-processors from
// the actual outbound calls (Supabase, Sentry, Anthropic, OpenStreetMap,
// Google/Apple OAuth). They are NOT legal advice and have not been reviewed
// by a lawyer.
//
// Three things only Kegan can supply are marked with LEGAL_TODO below and
// currently render a visible placeholder rather than an invented fact:
// the operating legal entity, the contact address for privacy requests, and
// the governing jurisdiction. Fill those in before submitting to either
// store — a policy naming no controller and giving no contact route fails
// Art. 13(1)(a)-(b) on its face, and reviewers do check.
//
// Keep LAST_UPDATED accurate when the disclosures change.

import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import FlexynLogo from '@/components/FlexynLogo';
import { useLanguage } from '@/lib/LanguageContext';
import TransText from '@/components/TransText';

const LAST_UPDATED = '4 August 2026';

// LEGAL_TODO — replace all three with the real values.
const ENTITY = null;          // e.g. 'Flexyn Ltd.'
const CONTACT_EMAIL = null;   // e.g. 'privacy@flexyn.app'
const JURISDICTION = null;    // e.g. 'the State of California, USA'

/** Renders a real value, or a visibly-unfinished placeholder. */
function Blank({ value, label }) {
  const { tFallback } = useLanguage();
  if (value) return <span>{value}</span>;
  return (
    <span
      className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[0.9em] font-medium"
      title={tFallback('legal.placeholderHint', 'This placeholder must be filled in before store submission.')}
    >
      [{label}]
    </span>
  );
}

/**
 * Where the header's back arrow goes: 'back' — one real history step — or
 * 'home', a full document load of `/`.
 *
 * Never a client-side <Link>, and that constraint is structural rather than
 * stylistic. App.jsx picks this route table out of `window.location.pathname`
 * read once at mount and never subscribes to location, so an in-app
 * navigation away from here does not unmount the page: it re-matches inside
 * the legal routes, where anything that isn't /privacy or /terms falls to
 * `path="*"` and renders the Privacy Policy. That is exactly what the old
 * `<Link to="/">` did — from /terms it silently swapped in the other
 * document, from /privacy it appeared to do nothing at all, and neither ever
 * returned the reader to the sign-in screen they opened this from.
 *
 * One real history step is safe when there is an entry of ours behind us:
 * either the reader came from our own origin — the sign-in screen links here
 * with plain <a> tags, so that entry is a previous *document* and back()
 * restores it, bfcache and all — or they have already navigated within this
 * document (react-router only stamps a location key once you move off the
 * entry the page loaded on, so 'default' means we have not).
 *
 * Otherwise — a reviewer opening /privacy straight from a store listing —
 * we hard-load `/` instead of navigating, for the same reason as above.
 */
export function resolveLegalBackTarget({ referrer, origin, historyLength, locationKey }) {
  if (!(historyLength > 1)) return 'home';
  if (locationKey && locationKey !== 'default') return 'back';
  try {
    if (referrer && new URL(referrer).origin === origin) return 'back';
  } catch {
    // Malformed referrer — treat it as external and go home.
  }
  return 'home';
}

function BackButton() {
  const { tFallback } = useLanguage();
  const { key: locationKey } = useLocation();

  const handleBack = () => {
    const target = resolveLegalBackTarget({
      referrer: document.referrer,
      origin: window.location.origin,
      historyLength: window.history.length,
      locationKey,
    });
    if (target === 'back') window.history.back();
    else window.location.assign('/');
  };

  return (
    <button
      type="button"
      onClick={handleBack}
      className="flex items-center justify-center w-9 h-9 -ms-2 rounded-full hover:bg-muted transition-colors"
      aria-label={tFallback("achievements.vault.back", "Back")}
    >
      <ArrowLeft className="w-5 h-5 rtl:scale-x-[-1]" />
    </button>
  );
}

function Shell({ title, children }) {
  const { tFallback } = useLanguage();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 bg-card/95 backdrop-blur-md border-b border-border">
        <div className="max-w-2xl mx-auto px-5 py-3 flex items-center gap-3">
          <BackButton />
          <FlexynLogo className="h-5 w-auto" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-8 pb-24">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Last updated {LAST_UPDATED}
        </p>

        {(!ENTITY || !CONTACT_EMAIL || !JURISDICTION) && (
          <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {tFallback("legal.draftNotice", "This document is not yet final. Highlighted fields must be completed before public release.")}
          </div>
        )}

        <div className="mt-6 space-y-6 text-[15px] leading-relaxed">{children}</div>

        <nav className="mt-12 pt-6 border-t border-border flex gap-5 text-sm">
          <Link to="/privacy" className="text-primary hover:underline">{tFallback("legal.privacyPolicy", "Privacy Policy")}</Link>
          <Link to="/terms" className="text-primary hover:underline">{tFallback("legal.termsOfService", "Terms of Service")}</Link>
        </nav>
      </main>
    </div>
  );
}

function Section({ heading, children }) {
  return (
    <section>
      <h2 className="text-base font-semibold tracking-tight">{heading}</h2>
      <div className="mt-2 space-y-3 text-muted-foreground">{children}</div>
    </section>
  );
}

// ── /privacy ──────────────────────────────────────────────────────────────

export function PrivacyPolicy() {
  const { tFallback } = useLanguage();
  return (
    <Shell title={tFallback("legal.privacyPolicy", "Privacy Policy")}>
      <p className="text-muted-foreground">
        <TransText
          k="legal.privacyIntro"
          en="Flexyn is a fitness companion app operated by {entity}. This policy explains what we collect, why, who processes it on our behalf, and how you get it back or delete it."
          values={{ entity: <Blank value={ENTITY} label="LEGAL ENTITY" /> }}
        />
      </p>

      <Section heading={tFallback('legal.h.dataWeCollect', 'Data we collect')}>
        <p><strong className="text-foreground">{tFallback('legal.dataAccountLabel', 'Account.')}</strong> Your email
        address, username, display name and avatar. If you sign in with Google
        or Apple, we receive your email address and basic profile from that
        provider — never your password.</p>

        <p><strong className="text-foreground">{tFallback('legal.dataHealthLabel', 'Health and fitness data.')}</strong>{' '}
        Workouts and the sets, reps and weights in them; cardio sessions and
        personal records; body weight, height, age and body measurements;
        progress photos; injuries; and — only if you switch each one on —
        mood, sleep, hydration, recovery and menstrual cycle logs. Under GDPR
        Art. 9 this is special-category data. We process it solely to provide
        the features you are using, on the basis of your explicit consent,
        which you can withdraw at any time by turning the feature off or
        deleting your account.</p>

        <p><TransText
          k="legal.dataNutrition"
          en="{label} Meals, macros and any food photos you submit for recognition."
          values={{ label: <strong className="text-foreground">{tFallback("legal.dataNutritionLabel", "Nutrition.")}</strong> }}
        /></p>

        <p><strong className="text-foreground">{tFallback('legal.dataSocialLabel', 'Social.')}</strong> Posts,
        comments, stories, direct messages, crew membership, follows, and
        anything else you choose to publish or send.</p>

        <p><strong className="text-foreground">{tFallback('legal.dataGymsLabel', 'Gyms.')}</strong> A home gym if you
        pick one, gym memberships and check-ins. Choosing a gym sends a coarse
        area search to OpenStreetMap; we do not track your continuous
        location and the app has no background location access.</p>

        <p><strong className="text-foreground">{tFallback('legal.dataDeviceLabel', 'Device and diagnostics.')}</strong>{' '}
        Your timezone offset, your language, a push notification subscription
        if you opt in, and — when the app errors or you file a bug report —
        diagnostic details including the build version and browser user agent.</p>
      </Section>

      <Section heading={tFallback('legal.h.whatWeDoNotDo', 'What we do not do')}>
        <p>We do not sell your personal data. We do not share it with
        advertisers, we run no third-party advertising or tracking SDKs, and
        we do not build advertising profiles. We do not use your health data
        for anything other than the features you are using.</p>
      </Section>

      <Section heading={tFallback('legal.h.whoProcesses', 'Who processes data for us')}>
        <ul className="list-disc ps-5 space-y-1.5">
          <li><strong className="text-foreground">{tFallback("legal.supabase", "Supabase")}</strong> — database,
          authentication, file storage and serverless functions. Holds
          essentially all of the data above.</li>
          <li><strong className="text-foreground">{tFallback("legal.netlify", "Netlify")}</strong> — serves the
          web application.</li>
          <li><strong className="text-foreground">{tFallback("legal.sentry", "Sentry")}</strong> — error
          monitoring. Receives crash and error diagnostics, which can include
          your user identifier.</li>
          <li><strong className="text-foreground">{tFallback("legal.anthropic", "Anthropic")}</strong> — powers
          the AI Coach and meal photo recognition. Receives the training
          context or the food photo needed to answer that one request.</li>
          <li><strong className="text-foreground">{tFallback("legal.openstreetmap", "OpenStreetMap")}</strong> —
          gym search. Receives a coarse area query, no account identifier.</li>
          <li><strong className="text-foreground">{tFallback('legal.googleApple', 'Google / Apple')}</strong> —
          only if you use them to sign in.</li>
        </ul>
      </Section>

      <Section heading={tFallback('legal.h.yourRights', 'Your rights')}>
        <p>You can access, correct, export and delete your data. Account
        deletion is available in Settings and removes your profile, your
        training and nutrition history, your posts and messages, and your
        uploaded files. Depending on where you live you may also have the
        right to object to or restrict processing, and to complain to your
        data protection authority.</p>
        <p><TransText k="legal.makeARequest" en="To make a request, contact {email}."
          values={{ email: <Blank value={CONTACT_EMAIL} label="CONTACT EMAIL" /> }} /></p>
      </Section>

      <Section heading={tFallback('legal.h.retention', 'Retention')}>
        <p>We keep your data while your account is open. When you delete your
        account, we delete it. Backups age out on their own schedule, and we
        keep the minimum required for legal, tax or fraud-prevention purposes
        where the law requires it.</p>
      </Section>

      <Section heading={tFallback('legal.h.children', 'Children')}>
        <p>Flexyn is not intended for children under 13, and we do not
        knowingly collect their data. If you believe a child has created an
        account, contact us and we will remove it.</p>
      </Section>

      <Section heading={tFallback('legal.h.changes', 'Changes')}>
        <p>If we change this policy materially we will say so in the app
        before the change takes effect.</p>
      </Section>
    </Shell>
  );
}

// ── /terms ────────────────────────────────────────────────────────────────

export function TermsOfService() {
  const { tFallback } = useLanguage();
  return (
    <Shell title={tFallback("legal.termsOfService", "Terms of Service")}>
      <p className="text-muted-foreground">
        These terms govern your use of Flexyn, operated by{' '}
        <Blank value={ENTITY} label="LEGAL ENTITY" />. By creating an account
        you agree to them.
      </p>

      <Section heading={tFallback('legal.h.notMedicalAdvice', 'Flexyn is not medical advice')}>
        <p className="font-medium text-foreground">
          Read this one properly. Flexyn is a fitness tracking and coaching
          tool, not a medical device and not a healthcare provider.
        </p>
        <p>Workouts, loads, nutrition targets and recovery guidance —
        including anything generated by the AI Coach — are general fitness
        information produced automatically from what you told us. They are not
        a diagnosis, a treatment, or advice from a qualified professional.
        Consult a doctor before starting a new training or nutrition programme,
        particularly if you are pregnant, injured, managing a medical
        condition, or taking medication. Stop and seek medical attention if
        you feel unwell while training. You train at your own risk.</p>
      </Section>

      <Section heading={tFallback('legal.h.yourAccount', 'Your account')}>
        <p>You must be at least 13 years old. Keep your account secure, give
        us accurate information, and do not impersonate anyone else. You are
        responsible for what happens under your account.</p>
      </Section>

      <Section heading={tFallback('legal.h.yourContent', 'Your content')}>
        <p>What you post stays yours. You grant us the licence we need to
        store it, and to display it to the people you have chosen to share it
        with. You are responsible for having the right to post it.</p>
      </Section>

      <Section heading={tFallback('legal.h.acceptableUse', 'Acceptable use')}>
        <p>Do not harass, threaten or abuse other users. Do not post content
        that is illegal, hateful, sexually explicit, or that promotes
        self-harm or disordered eating. Do not scrape the service, attempt to
        break its security, or use it to send spam. We may remove content and
        suspend accounts that break these rules.</p>
      </Section>

      <Section heading={tFallback('legal.h.virtualItems', 'Virtual items')}>
        <p>Coins, XP, levels, capsules and other in-app items have no monetary
        value, cannot be exchanged for money, and may be adjusted or removed
        where they were obtained through a bug or abuse.</p>
      </Section>

      <Section heading={tFallback('legal.h.availability', 'Availability and changes')}>
        <p>We may change, suspend or discontinue features. We will give
        reasonable notice of material changes where we can. The service is
        provided as-is, without warranties, to the fullest extent the law
        allows.</p>
      </Section>

      <Section heading={tFallback('legal.h.endingIt', 'Ending it')}>
        <p>You can delete your account at any time from Settings. We may
        suspend or terminate an account that breaches these terms.</p>
      </Section>

      <Section heading={tFallback('legal.h.governingLaw', 'Governing law')}>
        <p>These terms are governed by the laws of{' '}
        <Blank value={JURISDICTION} label="JURISDICTION" />.</p>
      </Section>

      <Section heading={tFallback('legal.h.contact', 'Contact')}>
        <p><TransText k="legal.termsQuestions" en="Questions about these terms: {email}."
          values={{ email: <Blank value={CONTACT_EMAIL} label="CONTACT EMAIL" /> }} /></p>
      </Section>
    </Shell>
  );
}
