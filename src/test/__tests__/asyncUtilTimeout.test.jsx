// A guard on src/test/setup.js's `configure({ asyncUtilTimeout })`.
//
// Testing Library's async timeout is a SEPARATE knob from vitest's
// `testTimeout`, and the whole reason it is set is that the difference is not
// obvious: vitest.config.js raises testTimeout to 15s to stop a loaded machine
// producing false reds, and that setting cannot help a `findBy*`, which gives
// up at its own 1000ms default and throws first. CrewTopBoard looked flaky for
// exactly this reason on 2026-08-16.
//
// This asserts BEHAVIOUR, not the constant. `expect(getConfig()
// .asyncUtilTimeout).toBe(5000)` would pass while the setting did nothing —
// if `configure` ever wrote to a different module instance than the one the
// tests resolve (two copies of @testing-library/dom in the tree, a hoisting
// change, a package upgrade that moves the config object), the number would
// still read back correctly from the copy that was written and every findBy
// would still time out at one second. So this renders something that appears
// deliberately LATER than the old default and requires the new one to be
// live. It fails if the configure call is deleted, and it fails if the call
// is present but inert.

import React, { useEffect, useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

const OLD_DEFAULT_MS = 1000;

// Comfortably past the 1000ms default and comfortably inside the 5000ms this
// suite configures, so the assertion is not itself racing the boundary.
const APPEARS_AFTER_MS = 1600;

function LateArrival() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), APPEARS_AFTER_MS);
    return () => clearTimeout(t);
  }, []);
  return ready ? <p>arrived</p> : <p>waiting</p>;
}

describe('Testing Library async timeout', () => {
  it('waits longer than the 1000ms default, so a slow machine is not a red build', async () => {
    expect(APPEARS_AFTER_MS).toBeGreaterThan(OLD_DEFAULT_MS);

    render(<LateArrival />);
    expect(screen.getByText('waiting')).toBeTruthy();

    // Under the stock 1000ms this throws "Unable to find an element with the
    // text: arrived" — the exact shape of the CrewTopBoard flake.
    expect(await screen.findByText('arrived')).toBeTruthy();
  });
});
