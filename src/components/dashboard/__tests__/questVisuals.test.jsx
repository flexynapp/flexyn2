// Render tests for the quest chrome shared by DailyQuestsCard and
// QuestsSheet.
//
// The tile is the whole point of the Aug 2026 polish pass — "once completed a
// little green circle and white check box appears" — and it is exactly the
// kind of thing that regresses silently, because a class-name change still
// renders a perfectly fine-looking square. These assert on the STATE→style
// mapping rather than on pixels.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuestTile, QuestRewardLine, QUEST_ICONS } from '../questVisuals';
import { QUEST_CATALOG, getQuestDefinition } from '@/lib/questCatalog';

// The component renders the tile as an aria-hidden div, so it is invisible to
// getByRole. Reach for the element directly.
const tileOf = (container) => container.firstChild;

// tFallback's real signature is (key, english, vars) — the sheet and card
// both pass it down. This is the identity version.
const tFallback = (_k, en) => en;

describe('QuestTile', () => {
  it('is primary with the quest icon while incomplete', () => {
    const { container } = render(<QuestTile icon="Droplet" completed={false} claimed={false} />);
    const tile = tileOf(container);
    expect(tile.className).toContain('bg-primary');
    expect(tile.className).not.toContain('bg-success');
    expect(container.querySelector('svg')).toBeTruthy();
  });

  // The ask, verbatim: a green circle and a white check on completion.
  it('turns green with a white check the moment it completes', () => {
    const { container } = render(<QuestTile icon="Droplet" completed claimed={false} />);
    const tile = tileOf(container);
    expect(tile.className).toContain('bg-success');
    expect(tile.className).toContain('text-white');
    expect(tile.className).not.toContain('bg-primary');
  });

  // Claiming must not take the mark away. The old card dropped back to a
  // muted grey outline once claimed, which made the finished state the
  // quietest thing in the row.
  it('stays green once claimed', () => {
    const { container } = render(<QuestTile icon="Droplet" completed claimed />);
    expect(tileOf(container).className).toContain('bg-success');
  });

  // A row can be claimed without completed_at having been read back yet
  // (the claim RPC returns before the poll refreshes the row).
  it('is green for claimed-but-not-yet-marked-complete', () => {
    const { container } = render(<QuestTile icon="Droplet" completed={false} claimed />);
    expect(tileOf(container).className).toContain('bg-success');
  });

  it('falls back to a glyph rather than nothing for an unknown icon name', () => {
    const { container } = render(<QuestTile icon="NotARealIcon" completed={false} claimed={false} />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('exposes every icon the catalog asks for', () => {
    Object.values(QUEST_CATALOG).forEach(q => {
      expect(QUEST_ICONS[q.icon], `missing icon ${q.icon}`).toBeTruthy();
    });
  });
});

describe('QuestRewardLine', () => {
  const quest = (over = {}) => ({
    progress: 2, target: 8, coin_reward: 20, xp_reward: 50,
    definition: getQuestDefinition('workout_complete'),
    ...over,
  });

  it('states progress, coins and XP', () => {
    render(<QuestRewardLine quest={quest()} tFallback={tFallback} />);
    expect(screen.getByText(/2 \/ 8/)).toBeTruthy();
    expect(screen.getByText(/20 coins/)).toBeTruthy();
    expect(screen.getByText(/50 XP/)).toBeTruthy();
  });

  it('names the crew share', () => {
    render(<QuestRewardLine quest={quest()} tFallback={tFallback} />);
    // ceil(50 * 0.25) = 13, matching the CEIL() in claim_quest_atomic.
    expect(screen.getByText(/\+13/)).toBeTruthy();
  });

  it('shows the full XP as the crew share on a crew quest', () => {
    render(
      <QuestRewardLine
        quest={quest({ xp_reward: 60, coin_reward: 25, definition: getQuestDefinition('crew_workout') })}
        tFallback={tFallback}
      />,
    );
    expect(screen.getByText(/\+60/)).toBeTruthy();
  });

  // xp_reward comes off the ROW, not the catalog: a tier that gets re-priced
  // must not retroactively change what an already-issued quest claims to pay.
  it('renders the row\'s stamped XP, not the catalog\'s current value', () => {
    render(<QuestRewardLine quest={quest({ xp_reward: 15 })} tFallback={tFallback} />);
    expect(screen.getByText(/15 XP/)).toBeTruthy();
    expect(screen.queryByText(/50 XP/)).toBeNull();
  });

  // Rows written before migration 316 carry xp_reward 0 and were sold at the
  // old rate. Printing "0 XP" on them would look like a bug.
  it('omits the XP clause entirely for a pre-316 row', () => {
    const { container } = render(
      <QuestRewardLine quest={quest({ xp_reward: 0, definition: null })} tFallback={tFallback} />,
    );
    expect(container.textContent).not.toContain('XP');
    expect(container.textContent).toContain('20 coins');
  });
});
