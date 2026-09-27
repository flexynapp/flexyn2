// The coin mark.
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
  it('is flat: no gradient, so no id for a second instance to collide with', () => {
    // The pewter restrike (round 2 capsule and market design) dropped the
    // fire gradient. With no gradient there is no url(#id) fill, which is
    // the whole class of bug the old two tests here existed to catch.
    const { container } = render(<><FlexCoinIcon /><FlexCoinIcon /><FlexCoinIcon /></>);
    expect(gradientIds(container)).toHaveLength(0);
    const urlFills = [...container.querySelectorAll('[fill]')]
      .map((el) => el.getAttribute('fill'))
      .filter((f) => f.startsWith('url('));
    expect(urlFills).toHaveLength(0);
  });

  it('is neutral pewter, not a second orange next to the action colour', () => {
    const { container } = render(<FlexCoinIcon />);
    const fills = [...container.querySelectorAll('[fill]')].map((el) => el.getAttribute('fill'));
    for (const f of fills.filter((x) => x !== 'none')) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(f.slice(i, i + 2), 16));
      // Grey means the channels sit close together.
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(24);
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
