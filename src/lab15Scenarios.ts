import type { RunRecord, Usage } from './lab15Usage.ts';

// Scripted teaching runs in the same shape as the live run summary. The field names and error codes come from the
// SDK's types (TokenUsage, Turn, SessionTurnError); the numbers, IDs, and timings are fixtures, not recordings.
export type UsageScenario = { id: string; title: string; summary: string; lesson: string; run: RunRecord };

const usage = (input: number, output: number, cached: number | null = 0, reasoning: number | null = 0): Usage => ({ input, output, total: input + output, cached, reasoning });
const at = 1_790_000_000; // a fixed Unix second, so API timestamps are readable as offsets
const run = (fields: Partial<RunRecord> & Pick<RunRecord, 'id' | 'outcome'>): RunRecord => ({
  prompt: 'Explain JavaScript closures in about 120 words with one example.',
  model: 'gpt-5.6-terra',
  sessionId: 'sess_demo_usage',
  turnId: `turn_demo_${fields.id.replace(/-/g, '_')}`,
  clock: { firstEventMs: 240, turnCreatedMs: 3900, inProgressMs: 4300, firstTextMs: 5200, endMs: 8600 },
  api: { createdAt: at, startedAt: at, completedAt: at + 4 },
  usage: { event: null, turn: null, session: null, rereadAt: null },
  savedStatus: null,
  error: null,
  chars: 720,
  ...fields,
});

export const usageScenarios: UsageScenario[] = [
  {
    id: 'complete',
    title: 'Completed, usage reported',
    summary: 'The turn completes and its terminal event carries usage. A re-read of the saved turn agrees.',
    lesson: 'Cached tokens are part of input, and reasoning tokens are part of output. Adding them again double-counts.',
    run: run({ id: 'complete', outcome: 'completed', usage: { event: usage(1_184, 356, 1_024, 64), turn: usage(1_184, 356, 1_024, 64), session: usage(1_184, 356, 1_024, 64), rereadAt: 2_000 }, savedStatus: 'completed' }),
  },
  {
    id: 'unknown',
    title: 'Completed, usage unknown',
    summary: 'The answer arrives, but usage is null on the event and on the saved turn.',
    lesson: 'null is not 0. The run cost something; the number is simply not known. Show “unknown” and keep it out of the sum.',
    run: run({ id: 'unknown', outcome: 'completed', usage: { event: null, turn: null, session: null, rereadAt: 2_000 }, savedStatus: 'completed' }),
  },
  {
    id: 'changed',
    title: 'Usage changed after the event',
    summary: 'The terminal event reports one total. Reading the saved turn a moment later reports a higher one.',
    lesson: 'Recorded usage is best effort and may change. Store the latest read, and note when it was read.',
    run: run({ id: 'changed', outcome: 'completed', usage: { event: usage(1_184, 340, 1_024, 48), turn: usage(1_184, 372, 1_024, 80), session: usage(1_184, 372, 1_024, 80), rereadAt: 5_000 }, savedStatus: 'completed' }),
  },
  {
    id: 'cancelled',
    title: 'Cancelled mid-answer',
    summary: 'A cancel is sent after 160 characters. The turn ends as cancelled with a short duration.',
    lesson: 'A cancelled turn is not free. Input was read and some output was generated before the cancel.',
    run: run({ id: 'cancelled', outcome: 'cancelled', chars: 164, clock: { firstEventMs: 250, turnCreatedMs: 3800, inProgressMs: 4200, firstTextMs: 5100, endMs: 5600 }, api: { createdAt: at, startedAt: at, completedAt: at + 1 }, usage: { event: usage(1_184, 41, 1_024, 0), turn: usage(1_184, 41, 1_024, 0), session: null, rereadAt: 2_000 }, savedStatus: 'cancelled' }),
  },
  {
    id: 'failed',
    title: 'Failed: rate limited',
    summary: 'The turn starts, then fails with the documented code rate_limit_exceeded. No usage is reported.',
    lesson: 'Show the code, the message, and whether a retry can help. A rate limit is temporary: retry later, with backoff.',
    run: run({ id: 'failed', outcome: 'failed', chars: 0, clock: { firstEventMs: 260, turnCreatedMs: 3700, inProgressMs: 4100, firstTextMs: null, endMs: 4400 }, api: { createdAt: at, startedAt: at, completedAt: at }, error: { source: 'turn', status: null, code: 'rate_limit_exceeded', message: 'The request exceeds the available rate limit.' }, savedStatus: 'failed' }),
  },
  {
    id: 'rejected',
    title: 'Rejected: model not available',
    summary: 'The session is created with a model the project cannot use. The request is refused before any turn exists.',
    lesson: 'No session and no turn means nothing ran. That is “no usage”, which is different from “unknown usage”.',
    run: run({ id: 'rejected', outcome: 'rejected', model: 'lab15-no-such-model', sessionId: null, turnId: null, chars: 0, clock: { firstEventMs: null, turnCreatedMs: null, inProgressMs: null, firstTextMs: null, endMs: null }, api: { createdAt: null, startedAt: null, completedAt: null }, error: { source: 'http', status: 404, code: 'model_not_found', message: 'The model `lab15-no-such-model` does not exist or you do not have access to it.' } }),
  },
  {
    id: 'stopped',
    title: 'Stopped reading early',
    summary: 'The page stops reading after 160 characters without cancelling. The stream has no outcome and no usage.',
    lesson: 'Unknown now is not unknown for ever. Re-read the saved turn: it completed, and its usage is there.',
    run: run({ id: 'stopped', outcome: 'unknown', chars: 162, clock: { firstEventMs: 240, turnCreatedMs: 3900, inProgressMs: 4300, firstTextMs: 5200, endMs: null }, api: { createdAt: at, startedAt: at, completedAt: at + 5 }, error: { source: 'stream', status: null, code: null, message: 'The server stopped reading after 162 characters. No cancel was sent, so the turn kept running.' }, usage: { event: null, turn: usage(1_184, 351, 1_024, 64), session: null, rereadAt: 9_000 }, savedStatus: 'completed' }),
  },
];

// What the page knew before it re-read the saved turn: only the stream's view.
// A stream that ended without an outcome never saw the turn's timestamps either.
export function beforeReread(record: RunRecord): RunRecord {
  const api = record.outcome === 'unknown' ? { createdAt: null, startedAt: null, completedAt: null } : record.api;
  return { ...record, api, usage: { event: record.usage.event, turn: null, session: null, rereadAt: null }, savedStatus: null };
}
