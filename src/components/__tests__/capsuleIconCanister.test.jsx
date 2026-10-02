// CapsuleIcon must draw the same object as the capsule shelf.
//
// The capsule redesign replaced the gachapon sphere with the machined
// canister (CapsuleCanister), but CapsuleIcon kept drawing the sphere, so My
// Bag showed a round ball while the shelf, spin and open showed a canister.
// These pin the icon to the canister's drawing and keep its square box.
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import CapsuleIcon from '@/components/loot/CapsuleIcon';
import { CANISTER_FINISH } from '@/components/capsules/CapsuleCanister';

describe('CapsuleIcon', () => {
  it('renders the canister, not a sphere', () => {
    const { container } = render(<CapsuleIcon type="standard" size={56} />);
    expect(container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 120 166');
    // The sphere was two gradient shells; the canister is drawn flat.
    expect(container.querySelector('linearGradient')).toBeNull();
  });

  it.each(['standard', 'premium', 'elite'])('uses the %s finish and grade bars', (tier) => {
    const { container } = render(<CapsuleIcon type={tier} size={56} />);
    const fills = [...container.querySelectorAll('[fill]')].map(n => n.getAttribute('fill'));
    expect(fills).toContain(CANISTER_FINISH[tier].base);
    const bars = [...container.querySelectorAll('rect')].filter(r => r.getAttribute('y') === '138');
    expect(bars).toHaveLength(CANISTER_FINISH[tier].bars);
  });

  it('keeps the slot width callers lay out against, standing taller', () => {
    const { container } = render(<CapsuleIcon size={26} className="shrink-0" />);
    const box = container.firstChild;
    expect(box.style.width).toBe('26px');
    expect(box.style.height).toBe('34px');
    expect(box).toHaveClass('shrink-0');
    expect(box).toHaveAttribute('aria-hidden', 'true');
  });

  it('exposes a label when given one', () => {
    const { container } = render(<CapsuleIcon label="Elite Capsule" type="elite" />);
    expect(container.firstChild).toHaveAttribute('role', 'img');
    expect(container.firstChild).toHaveAttribute('aria-label', 'Elite Capsule');
  });
});
