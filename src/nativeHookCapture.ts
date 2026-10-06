import { StringDecoder } from 'node:string_decoder';

const key = (value: unknown) => typeof value === 'string' ? value.replaceAll('\\', '/').replace(/^([A-Z]):/, (_, drive) => `${drive.toLowerCase()}:`) : '';
const identifier = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 500;
const feedback = ['Report validation passed: header and total.', 'Report must contain the Release report header and Total: 2800.'];

// Deliberately copy selected fields instead of persisting raw protocol messages.
export function selectHookNotification(message: any, configPath: string, reportPath: string) {
  if (message?.id !== undefined || !identifier(message?.params?.threadId) || !identifier(message?.params?.turnId)) return null;
  const { threadId, turnId } = message.params;
  const item = message.params.item;
  if (message.method === 'item/completed' && item?.type === 'fileChange' && item.status === 'completed' && identifier(item.id) && Array.isArray(item.changes) && item.changes.some(change => key(change?.path) === key(reportPath))) {
    return { method: message.method, params: { threadId, turnId, item: { id: item.id, type: item.type, status: item.status, changes: [{ path: reportPath }] } } };
  }
  const run = message.params.run;
  if (message.method !== 'hook/completed' || run?.eventName !== 'postToolUse' || run.source !== 'project' || key(run.sourcePath) !== key(configPath) || run.handlerType !== 'command' || run.executionMode !== 'sync' || !identifier(run.id) || !Number.isSafeInteger(run.startedAt) || !Number.isSafeInteger(run.completedAt) || !['completed', 'blocked', 'failed'].includes(run.status)) return null;
  const entries = feedback.filter(text => Array.isArray(run.entries) && run.entries.some(entry => typeof entry?.text === 'string' && entry.text.includes(text))).map(text => ({ kind: 'feedback', text }));
  return { method: message.method, params: { threadId, turnId, run: { id: run.id, eventName: run.eventName, source: run.source, sourcePath: configPath, handlerType: run.handlerType, executionMode: run.executionMode, startedAt: run.startedAt, completedAt: run.completedAt, status: run.status, entries } } };
}

export class HookNotificationCapture {
  private decoder = new StringDecoder('utf8');
  private pending = '';
  private dropping = false;
  private bytes = 0;
  private events = 0;
  private limited = false;
  constructor(private configPath: string, private reportPath: string, private write: (line: string) => void, private warn: () => void) {}
  push(chunk: Buffer) { this.consume(this.decoder.write(chunk)); }
  finish() { this.consume(this.decoder.end()); if (this.pending) this.line(this.pending); this.pending = ''; }
  private consume(text: string) {
    for (const part of text.match(/[^\n]*\n|[^\n]+$/g) || []) {
      const complete = part.endsWith('\n');
      if (!this.dropping) {
        if (this.pending.length + part.length > 4000000) { this.pending = ''; this.dropping = true; this.warning(); }
        else this.pending += part;
      }
      if (complete) { if (!this.dropping) this.line(this.pending); this.pending = ''; this.dropping = false; }
    }
  }
  private warning() { if (!this.limited) { this.limited = true; this.warn(); } }
  private line(raw: string) {
    let message: any;
    try { message = JSON.parse(raw); } catch { return; }
    const selected = selectHookNotification(message, this.configPath, this.reportPath);
    if (!selected) return;
    const line = JSON.stringify(selected) + '\n', bytes = Buffer.byteLength(line);
    if (this.events >= 10000 || this.bytes + bytes > 2000000) { this.warning(); return; }
    this.write(line); this.bytes += bytes; this.events++;
  }
}
