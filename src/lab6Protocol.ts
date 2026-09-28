export type RunRequest = { prompt: string; instructions: string; sessionId?: string };

export type RunEvent =
  | { type: 'status'; label: string }
  | { type: 'session'; sessionId: string }
  | { type: 'text'; text: string }
  | { type: 'complete' }
  | { type: 'error'; message: string };

export function parseRunEvent(value: unknown): RunEvent {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    throw new Error('Stream event must be an object with a type.');
  }
  const event = value as Record<string, unknown>;
  switch (event.type) {
    case 'status':
      if (typeof event.label === 'string') return { type: 'status', label: event.label };
      break;
    case 'session':
      if (typeof event.sessionId === 'string' && /^sess_[A-Za-z0-9_-]+$/.test(event.sessionId)) {
        return { type: 'session', sessionId: event.sessionId };
      }
      break;
    case 'text':
      if (typeof event.text === 'string') return { type: 'text', text: event.text };
      break;
    case 'complete':
      return { type: 'complete' };
    case 'error':
      if (typeof event.message === 'string') return { type: 'error', message: event.message };
      break;
  }
  throw new Error(`Invalid streamed event: ${String(event.type)}.`);
}

export async function streamRun(request: RunRequest, onEvent: (event: RunEvent) => void): Promise<void> {
  const response = await fetch('/api/lab2/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const body: unknown = await response.json();
    const message = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
      ? body.error : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  if (!response.body) throw new Error('The browser could not read the response stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let raw: unknown;
        try { raw = JSON.parse(line); } catch { throw new Error('The server sent invalid JSON.'); }
        const event = parseRunEvent(raw);
        onEvent(event);
        if (event.type === 'error') throw new Error(event.message);
        if (event.type === 'complete') completed = true;
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (!completed) throw new Error('The stream closed before a completed turn. Retrieve session state before retrying.');
}
