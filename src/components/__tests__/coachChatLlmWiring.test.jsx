// src/components/__tests__/coachChatLlmWiring.test.jsx
//
// CoachChat's half of the language-model wiring.
//
// This exists partly as a smoke test: the Coach page sits behind the auth
// wall, so the change that added the training-digest query and passed the
// thread into askCoach cannot be exercised in a browser without signing in.
// A build passes on a component whose hooks are ordered wrongly or whose
// const is read before its declaration (the TDZ trap CLAUDE.md documents,
// which cost a production Hub crash) — a mount does not.
//
// The behavioural half is what gets handed to askCoach. The regex router
// parsed every message with no memory of the previous one, which is most of
// why the Coach felt robotic; if the thread stops being forwarded, the model
// silently loses the ability to answer "why?" or "make it shorter" and
// nothing else fails.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const askCoach = vi.fn();
const buildCoachContext = vi.fn();
const toastInfo = vi.fn();

vi.mock('@/lib/aiCoach/coach', () => ({
  askCoach: (...a) => askCoach(...a),
  SUGGESTED_PROMPTS: [{ id: 'p1', text: 'What should I train today?' }],
}));
vi.mock('@/lib/aiCoach/responders', () => ({
  buildCoachContext: (...a) => buildCoachContext(...a),
}));
vi.mock('@/lib/aiCoach/planBuilder', () => ({ GENERATE_PROMPTS: [] }));
vi.mock('@/lib/toast', () => ({
  toast: { info: (...a) => toastInfo(...a), error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'a@b.c' } }),
}));
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({ tFallback: (_k, fb) => fb, language: 'es' }),
}));
vi.mock('@/api/db', () => ({
  db: { auth: { me: vi.fn(async () => ({ level: 'consistent', weight_unit: 'lb' })) } },
}));
vi.mock('@/lib/data/injuries', () => ({
  listActiveInjuries: vi.fn(async () => []),
  getExcludedMuscleGroups: vi.fn(() => ['shoulders']),
}));
vi.mock('@/lib/voiceInput', () => ({
  isVoiceInputSupported: () => false,
  startVoiceCapture: vi.fn(),
}));

import CoachChat from '../coach/CoachChat';

function renderChat() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CoachChat mode="chat" onSaveRegimen={vi.fn()} onStartWorkout={vi.fn()} />
    </QueryClientProvider>
  );
}

async function send(text) {
  const box = screen.getByPlaceholderText(/Ask Coach anything/i);
  fireEvent.change(box, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: /^Send$/i }));
}

beforeEach(() => {
  localStorage.clear();
  askCoach.mockReset();
  buildCoachContext.mockReset();
  toastInfo.mockReset();
  buildCoachContext.mockResolvedValue({ units: 'lb', training: { sessionsLast7: 3 } });
  askCoach.mockResolvedValue({ reply: 'LLM_REPLY', source: 'llm', intent: { id: 'unknown' } });
});

describe('CoachChat — language-model wiring', () => {
  it('mounts and renders the composer', async () => {
    renderChat();
    expect(screen.getByPlaceholderText(/Ask Coach anything/i)).toBeInTheDocument();
    // The digest query fires on mount, not on send, so it is warm by the time
    // the user finishes typing.
    await waitFor(() => expect(buildCoachContext).toHaveBeenCalled());
  });

  it('builds the digest from the profile and the user’s active injuries', async () => {
    renderChat();
    await waitFor(() => expect(buildCoachContext).toHaveBeenCalledWith(expect.objectContaining({
      user: expect.objectContaining({ email: 'a@b.c' }),
      excludeMuscleGroups: ['shoulders'],
    })));
  });

  it('forwards the digest and the app language to askCoach', async () => {
    renderChat();
    await waitFor(() => expect(buildCoachContext).toHaveBeenCalled());

    await send('how much protein should I eat?');

    await waitFor(() => expect(askCoach).toHaveBeenCalled());
    expect(askCoach).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a@b.c' }),
      'how much protein should I eat?',
      expect.objectContaining({
        language: 'es',
        excludeMuscleGroups: ['shoulders'],
        coachContext: { units: 'lb', training: { sessionsLast7: 3 } },
      }),
    );
  });

  it('sends the prior thread so follow-ups have something to refer back to', async () => {
    renderChat();
    await waitFor(() => expect(buildCoachContext).toHaveBeenCalled());

    await send('what should I train today?');
    await waitFor(() => expect(screen.getByText('LLM_REPLY')).toBeInTheDocument());

    await send('why?');
    await waitFor(() => expect(askCoach).toHaveBeenCalledTimes(2));

    const history = askCoach.mock.calls[1][2].history;
    expect(history).toEqual([
      expect.objectContaining({ role: 'user',  text: 'what should I train today?' }),
      expect.objectContaining({ role: 'coach', text: 'LLM_REPLY' }),
    ]);
  });

  it('keeps error placeholders out of the history it sends', async () => {
    askCoach.mockRejectedValueOnce(new Error('boom'));
    renderChat();
    await waitFor(() => expect(buildCoachContext).toHaveBeenCalled());

    await send('first');
    await waitFor(() => expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument());

    await send('second');
    await waitFor(() => expect(askCoach).toHaveBeenCalledTimes(2));

    const history = askCoach.mock.calls[1][2].history;
    expect(history.some(m => m.source === 'error')).toBe(false);
    expect(history).toEqual([expect.objectContaining({ role: 'user', text: 'first' })]);
  });

  it('explains the daily cap rather than letting the coach quietly get simpler', async () => {
    askCoach.mockResolvedValue({
      reply: 'RULES_REPLY', source: 'rules', capped: true, intent: { id: 'unknown' },
    });
    renderChat();
    await waitFor(() => expect(buildCoachContext).toHaveBeenCalled());

    await send('how am I doing?');

    await waitFor(() => expect(toastInfo).toHaveBeenCalledWith(expect.stringMatching(/limit for detailed answers/i)));
    expect(screen.getByText('RULES_REPLY')).toBeInTheDocument();
  });

  it('says nothing about the cap on a normal turn', async () => {
    renderChat();
    await waitFor(() => expect(buildCoachContext).toHaveBeenCalled());

    await send('how am I doing?');

    await waitFor(() => expect(screen.getByText('LLM_REPLY')).toBeInTheDocument());
    expect(toastInfo).not.toHaveBeenCalled();
  });
});
