import type { IncomingMessage, ServerResponse } from 'node:http';
export function send(response: ServerResponse, status: number, body: unknown) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(body)); }
export async function body(request: IncomingMessage, allowed: string[], max = 10000) {
  let raw = ''; for await (const chunk of request) { raw += chunk; if (Buffer.byteLength(raw) > max) throw new Error('Body limit'); }
  const value = JSON.parse(raw); if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Invalid fields'); return value;
}
export function redact<T>(value: T): T { let text = JSON.stringify(value); for (const key of [process.env.OPENAI_API_KEY, process.env.OPENAI_EXECUTOR_API_KEY].filter(Boolean)) text = text.split(JSON.stringify(key).slice(1, -1)).join('[redacted]'); return JSON.parse(text); }
export const configured = () => Boolean(process.env.OPENAI_API_KEY?.trim() && process.env.OPENAI_API_KEY !== 'your_api_key_here');
export const restricted = () => Boolean(process.env.OPENAI_EXECUTOR_API_KEY?.trim() && process.env.OPENAI_EXECUTOR_API_KEY !== 'your_environment_key_here' && process.env.OPENAI_EXECUTOR_API_KEY !== process.env.OPENAI_API_KEY);
export const model = () => process.env.OPENAI_MODEL || 'gpt-5.6-terra';
export function requestId(value: unknown) { return typeof value === 'string' && /^[\w-]{16,80}$/.test(value); }
export function boundedNext<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> { return new Promise((resolve, reject) => { const stop = () => reject(new Error('Stopped or deadline exceeded')); if (signal.aborted) { stop(); return; } signal.addEventListener('abort', stop, { once: true }); promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop)); }); }
