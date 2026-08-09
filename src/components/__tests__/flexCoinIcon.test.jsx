// The coin mark, and the one way an SVG icon like this breaks silently.
//
// Every gradient-bearing icon in this app has hit the same bug: a fixed
// `url(#id)` fill means the SECOND instance on a page resolves to the
// FIRST one's gradient. CapsuleIcon documents it (the Bag renders a dozen
// at once), FlexynLogo documents it (the sidebar copy sits in a
// display:none subtree and the header's flame painted nothing). Nothing
// throws when it happens — the icon just renders wrong, or not at all.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import FlexCoinIcon from '@/components/FlexCoinIcon';

const gradientIds = (container) =>
  [...container.querySelectorAll('linearGradient')].map((g) => g.id);

describe('FlexCoinIcon', () => {
  it('gives every instance its own gradient ids', () => {
    const { container } = render(
      <>
        <FlexCoinIcon />
        <FlexCoinIcon />
        <FlexCoinIcon />
      </>
    );
    const ids = gradientIds(container);
    expect(ids).toHaveLength(6);                       // 2 gradients × 3 icons
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('points every fill at a gradient that exists in its own instance', () => {
    const { container } = render(<><FlexCoinIcon /><FlexCoinIcon /></>);
    for (const svg of container.querySelectorAll('svg')) {
      const own = new Set([...svg.querySelectorAll('linearGradient')].map((g) => g.id));
      const refs = [...svg.querySelectorAll('[fill]')]
        .map((el) => el.getAttribute('fill'))
        .filter((f) => f.startsWith('url('))
        .map((f) => f.slice(5, -1));
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) expect(own.has(ref)).toBe(true);
    }
  });

  it('is hidden from screen readers unless it is given a label', () => {
    // It sits beside the number it describes almost everywhere, so
    // announcing "image" there is noise.
    const { container, rerender } = render(<FlexCoinIcon />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('svg')).not.toHaveAttribute('role', 'img');

    rerender(<FlexCoinIcon label="Flex Coins" />);
    expect(container.querySelector('svg')).toHaveAttribute('role', 'img');
    expect(container.querySelector('svg')).toHaveAttribute('aria-label', 'Flex Coins');
    expect(container.querySelector('svg')).not.toHaveAttribute('aria-hidden');
  });

  it('accepts a css length so it can track surrounding type', () => {
    // CoinAmount passes "1em" — it renders inside everything from an 11px
    // badge to a 20px confirm-dialog total.
    const { container } = render(<FlexCoinIcon size="1em" />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '1em');
    expect(container.querySelector('svg')).toHaveAttribute('height', '1em');
  });
});
