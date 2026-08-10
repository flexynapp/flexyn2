import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { escapeCsvCell, rowsToCsv, downloadCsv } from '@/lib/downloadCsv';

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

function setUA(ua) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}

describe('escapeCsvCell', () => {
  it('neutralizes formula triggers — exercise names and notes are user-authored', () => {
    // A cell opening with = + @ or a control character is evaluated by
    // Excel and Sheets even inside quotes. An exercise literally named
    // `=cmd|'/c calc'!A1` is the whole attack.
    expect(escapeCsvCell('=1+1')).toBe('"\'=1+1"');
    expect(escapeCsvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    expect(escapeCsvCell('+worse')).toBe('"\'+worse"');
    expect(escapeCsvCell('\tTAB')).toBe('"\'\tTAB"');
  });

  it('leaves real negative numbers numeric', () => {
    // `-` is a formula trigger, but prefixing it would turn a weight
    // delta into text and break the column for every downstream tool.
    expect(escapeCsvCell(-5)).toBe('"-5"');
    expect(escapeCsvCell('-12.5')).toBe('"-12.5"');
    // …while a negative-looking string that isn't a number still gets it.
    expect(escapeCsvCell('-A1')).toBe('"\'-A1"');
  });

  it('doubles embedded quotes and renders null/undefined as empty', () => {
    expect(escapeCsvCell('He said "go"')).toBe('"He said ""go"""');
    expect(escapeCsvCell(null)).toBe('""');
    expect(escapeCsvCell(undefined)).toBe('""');
  });
});

describe('rowsToCsv', () => {
  it('joins with CRLF, which is what Excel expects', () => {
    expect(rowsToCsv([['a', 'b'], [1, 2]])).toBe('"a","b"\r\n"1","2"');
  });
});

describe('downloadCsv', () => {
  let clickSpy;

  beforeEach(() => {
    vi.useFakeTimers();
    global.URL.createObjectURL = vi.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = vi.fn();
    clickSpy = vi.fn();
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag !== 'a') return document.createElementNS('http://www.w3.org/1999/xhtml', tag);
      return { href: '', download: '', click: clickSpy, nodeType: 1 };
    });
    vi.spyOn(document.body, 'appendChild').mockImplementation(el => el);
    vi.spyOn(document.body, 'removeChild').mockImplementation(el => el);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete navigator.share;
    delete navigator.canShare;
  });

  it('prepends a UTF-8 BOM so Excel does not mojibake non-ASCII names', async () => {
    setUA(DESKTOP_UA);
    let captured;
    global.Blob = class {
      constructor(parts) { captured = parts[0]; }
    };
    await downloadCsv([['Exercise'], ['懸垂']], 'f.csv');
    expect(captured.startsWith('﻿')).toBe(true);
    expect(captured).toContain('懸垂');
  });

  it('uses the anchor path off iOS, and holds the object URL past the click', async () => {
    setUA(DESKTOP_UA);
    global.Blob = class {};
    const res = await downloadCsv([['a']], 'flexyn-workouts.csv');

    expect(res).toEqual({ ok: true });
    expect(clickSpy).toHaveBeenCalledTimes(1);
    // Revoking synchronously after .click() can abort the download before
    // it starts — the exact defect in the old inline implementation.
    expect(global.URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });

  it('shares the file on iOS, where <a download> is ignored', async () => {
    setUA(IOS_UA);
    global.Blob = class {};
    global.File = class { constructor(_p, name, opts) { this.name = name; this.type = opts?.type; } };
    navigator.canShare = vi.fn(() => true);
    navigator.share = vi.fn(() => Promise.resolve());

    const res = await downloadCsv([['a']], 'flexyn-cardio.csv');

    expect(res).toEqual({ ok: true, shared: true });
    expect(navigator.share).toHaveBeenCalledTimes(1);
    expect(navigator.share.mock.calls[0][0].files[0].name).toBe('flexyn-cardio.csv');
    // The anchor must NOT also fire — that would be a second, silent no-op.
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('treats a dismissed iOS share sheet as done, not as a failure', async () => {
    setUA(IOS_UA);
    global.Blob = class {};
    global.File = class {};
    navigator.canShare = vi.fn(() => true);
    navigator.share = vi.fn(() => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })));

    // The caller uses `cancelled` to suppress the success toast without
    // showing an error — dismissing a share sheet is a choice, not a bug.
    expect(await downloadCsv([['a']], 'f.csv')).toEqual({ ok: true, shared: true, cancelled: true });
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('falls back to the anchor when an iOS share fails for a real reason', async () => {
    setUA(IOS_UA);
    global.Blob = class {};
    global.File = class {};
    navigator.canShare = vi.fn(() => true);
    navigator.share = vi.fn(() => Promise.reject(new Error('NotAllowedError')));

    const res = await downloadCsv([['a']], 'f.csv');
    expect(res).toEqual({ ok: true });
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
