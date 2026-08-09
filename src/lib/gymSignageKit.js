// src/lib/gymSignageKit.js
//
// One-click "Signage Kit" PDF generator, reachable by anyone at a gym
// that has members — a community gym has no owner to do it. Produces a
// multi-page, print-ready US-Letter PDF: one quarter-page poster per
// high-traffic placement (front desk / locker room / squat rack),
// each with the gym's QR, the 8-char Flexyn Code, and a gamified
// "Join the leaderboard" call-to-action.
//
// Reuses the already-built pieces:
//   • qrcode (QR for flexyn://gym/<CODE>) — same encoding as
//     GymSignageCard so the in-app scanner accepts it.
//   • jsPDF for assembly (vector text stays crisp; the QR is the only
//     raster element).
//
// No html2canvas round-trip — each poster is drawn straight onto the
// page, so text is sharp at any print size.

const PLACEMENTS = [
  {
    id: 'front-desk',
    label: 'Front Desk',
    headline: 'Join your gym on Flexyn',
    cta: 'Scan to climb the leaderboard',
  },
  {
    id: 'locker-room',
    label: 'Locker Room',
    headline: 'Track every set. Beat your gym.',
    cta: 'Scan to join the local leaderboard',
  },
  {
    id: 'squat-rack',
    label: 'Squat Rack / Floor',
    headline: 'Log it. Rank up. Repeat.',
    cta: 'Scan now — see where you rank today',
  },
];

const BRAND = { r: 0x7c, g: 0x3a, b: 0xed };   // primary violet
const INK   = { r: 0x0f, g: 0x0f, b: 0x2a };   // near-black
const MUTE  = { r: 0x64, g: 0x74, b: 0x8b };   // slate

/**
 * Build + download the signage kit PDF for a gym.
 * @param {{ name?: string, flexyn_code: string }} gym
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function downloadSignageKit(gym) {
  if (!gym?.flexyn_code) return { ok: false, error: 'NO_CODE' };

  let QRCode, jsPDF;
  try {
    QRCode = (await import('qrcode')).default;
    ({ jsPDF } = await import('jspdf'));
  } catch (err) {
    return { ok: false, error: 'LIB_LOAD_FAILED' };
  }

  // High-EC QR so it survives print + glare. Encodes the /checkin/<CODE>
  // web URL: a phone-camera scan opens the check-in page (1.2x XP day),
  // and the in-app scanner still extracts the 8-char code from the path.
  const origin = (typeof window !== 'undefined' && window.location.origin) || 'https://flexyn.netlify.app';
  let qrDataUrl;
  try {
    qrDataUrl = await QRCode.toDataURL(`${origin}/checkin/${gym.flexyn_code}`, {
      errorCorrectionLevel: 'H', margin: 1, width: 900,
      color: { dark: '#0f0f2a', light: '#ffffff' },
    });
  } catch {
    return { ok: false, error: 'QR_FAILED' };
  }

  const doc = new jsPDF({ unit: 'pt', format: 'letter' }); // 612 × 792 pt
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const cx = W / 2;
  const gymName = (gym.name || 'Your Gym').slice(0, 48);

  PLACEMENTS.forEach((p, i) => {
    if (i > 0) doc.addPage();

    // Top brand bar
    doc.setFillColor(BRAND.r, BRAND.g, BRAND.b);
    doc.rect(0, 0, W, 10, 'F');

    // Kicker
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(MUTE.r, MUTE.g, MUTE.b);
    doc.text('FLEXYN GYM', cx, 64, { align: 'center', charSpace: 3 });

    // Gym name
    doc.setFontSize(30);
    doc.setTextColor(INK.r, INK.g, INK.b);
    doc.text(gymName, cx, 100, { align: 'center' });

    // Headline CTA
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(BRAND.r, BRAND.g, BRAND.b);
    doc.text(p.headline, cx, 150, { align: 'center', maxWidth: W - 96 });

    // QR — large, centered
    const qrSize = 300;
    doc.addImage(qrDataUrl, 'PNG', cx - qrSize / 2, 185, qrSize, qrSize);

    // "Or type this code"
    let y = 185 + qrSize + 40;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.setTextColor(MUTE.r, MUTE.g, MUTE.b);
    doc.text('Or type this code in the app', cx, y, { align: 'center' });

    // The 8-char code, big mono
    y += 38;
    doc.setFont('courier', 'bold');
    doc.setFontSize(40);
    doc.setTextColor(INK.r, INK.g, INK.b);
    doc.text(gym.flexyn_code, cx, y, { align: 'center', charSpace: 6 });

    // Gamified CTA line
    y += 44;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(BRAND.r, BRAND.g, BRAND.b);
    doc.text(`🏆  ${p.cta}`, cx, y, { align: 'center', maxWidth: W - 96 });

    // How-to footer
    y += 30;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(MUTE.r, MUTE.g, MUTE.b);
    doc.text('Open Flexyn → My Gym → scan or enter the code above.', cx, y, { align: 'center' });

    // Placement label (bottom-left, for the owner's own reference)
    doc.setFontSize(8);
    doc.setTextColor(MUTE.r, MUTE.g, MUTE.b);
    doc.text(`Placement: ${p.label}`, 40, H - 28);
    doc.text(`${i + 1} / ${PLACEMENTS.length}`, W - 40, H - 28, { align: 'right' });
  });

  const safeName = gymName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'gym';
  doc.save(`flexyn-signage-kit-${safeName}-${gym.flexyn_code}.pdf`);
  return { ok: true };
}

export const SIGNAGE_PLACEMENT_COUNT = PLACEMENTS.length;
