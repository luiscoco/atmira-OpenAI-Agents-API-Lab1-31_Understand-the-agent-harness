import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import { AnswerPre } from './Lab6.tsx';
import { masculineVoiceName, selectNarratorVoice } from './speech.ts';
import { shortId } from './lab13Recovery.ts';
import type { ToolCall } from './lab16Tool.ts';
import { maxRounds, type TraceItem } from './lab17Action.ts';
import {
  bytesOf, checkGrounding, checkRequest, classifyWeatherRun, faults, forecastUrl, geocodeUrl, liveTiming, parseOutcome, parseWeatherRun, recordedCities, reportsOf, service, stages, testTiming, toolResultEvent, weatherTool,
  type CheckedResult, type Fault, type Moment, type ServiceOutcome, type Source, type Stage, type UpstreamRequest, type WeatherReport, type WeatherRun,
} from './lab19Service.ts';
import { runServiceSuite, serviceTests, type TestGroup, type TestResult } from './lab19Tests.ts';

type Health = { configured: boolean; model: string } | null;
type Lesson = { number: string; title: string; file: string; code: string; explanation: string };
type Speaking = { mode: 'one' | 'all'; lesson: string } | null;
type Live = { events: string[]; calls: ToolCall[]; results: CheckedResult[]; answer: string; timeline: Moment[] };
type Suite = { source: 'browser' | 'server'; runtime: string; durationMs: number; results: Record<string, TestResult> };
type Probe = { outcome: ServiceOutcome; source: Source; cacheSize: number };

const lessons: Lesson[] = [
  { number: '01', title: 'Declare a narrow tool, not a proxy', file: 'src/lab19Service.ts', code: "export const weatherTool: FunctionToolDeclaration = {\n  type: 'function',\n  name: 'get_weather_forecast',\n  description: 'Get the current weather and a daily forecast (1 to 7 days)… ' +\n    'Use it whenever the user asks about the weather… It is read-only.',\n  parameters: {\n    type: 'object',\n    properties: {\n      city:  { type: 'string', minLength: 2, maxLength: 80, … },\n      days:  { type: 'integer', minimum: 1, maximum: 7, … },\n      units: { type: 'string', enum: ['celsius', 'fahrenheit'], … },\n    },\n    required: ['city', 'days', 'units'],\n    additionalProperties: false,\n  },\n};", explanation: 'The real API has dozens of parameters. The agent gets three: a city, a number of days, and the units. It never sees a URL, a host, a method, or a list of fields, so it cannot send the request anywhere else or ask for anything else. That is what narrow means. A tool called fetch URL would hand the model your server’s network. A tool called get weather forecast hands it exactly one question it is allowed to ask.' },
  { number: '02', title: 'Build the request in code, then guard it', file: 'src/lab19Service.ts', code: "export function forecastUrl(place, days, units) {\n  const url = new URL(service.forecastBase);  // fixed by code\n  url.search = new URLSearchParams({\n    latitude: String(place.latitude), longitude: String(place.longitude),\n    daily: dailyFields.join(','), forecast_days: String(days), temperature_unit: units,\n  }).toString();\n  return url.toString();\n}\n\nexport function checkRequest(url: string, method: string): Guard {\n  if (method.toUpperCase() !== 'GET') return block('read-only: GET only.');\n  if (target.protocol !== 'https:') return block('HTTPS only.');\n  const path = service.allowed[target.hostname];\n  if (!path) return block(`host ${target.hostname} is not on the allowlist.`);\n  if (target.pathname !== path) return block(`only ${path}.`);\n}", explanation: 'The arguments are validated first, as in Lab 18. Then code builds the URL from a fixed base, and URLSearchParams encodes every value, so a city name can never change the host or add a parameter. Before any request leaves the server, a guard checks it again: HTTPS, GET only, a host on the allowlist, and the one path allowed on that host. The URL is already safe, so the guard should never fire. It is there in case a later change to the code makes a mistake.' },
  { number: '03', title: 'One real fetch, on the server, with a deadline', file: 'server/lab19.ts', code: "const httpFetcher: Fetcher = async (url, signal) => {\n  const response = await fetch(url, {\n    method: 'GET', signal,\n    redirect: 'error',            // a redirect could leave the allowlist\n    headers: { Accept: 'application/json' },\n  });\n  const raw = await response.text();\n  return { status: response.status, body: JSON.parse(raw), bytes: raw.length };\n};\n\n// src/lab19Service.ts: one deadline for the whole tool call\nconst report = await withTimeout(\n  (signal) => weatherService(args, ctx, signal), 4000);", explanation: 'The only real network call lives on the server. The browser never talks to the weather service, and the API key never leaves the server either. Redirects are refused, because following one could take the request to a host that is not on the allowlist. One deadline of four seconds covers the whole tool call, both requests together, because that is how long the user waits. The same abort signal reaches fetch, so a timeout really stops the request.' },
  { number: '04', title: 'The response is unknown too', file: 'src/lab19Service.ts', code: "export function parseForecast(body: unknown, expect): Parsed<Forecast> {\n  if (!isObject(body)) return fail('the body is not a JSON object.');\n  const time = daily.time;\n  if (time.length !== expect.days) issues.push(`${time.length} days; ${expect.days} requested.`);\n  const max = column('temperature_2m_max', false); // numbers only\n  const probability = column('precipitation_probability_max', true); // or null\n  if (dailyUnits.temperature_2m_max !== wanted) issues.push(`${wanted} was requested.`);\n  …\n}\n// drift: temperature_2m_max renamed → 'daily.temperature_2m_max is missing.'\n// → the agent: 'unexpected format (ref err_…). Do not retry.'", explanation: 'You validated the model’s arguments. Now validate the service’s answer, because it is also text from outside your code. Check every field you use: the type, the number of days, the lengths of the columns, and even the units. APIs change without warning. When a field is renamed, the page does not crash and does not quietly pass along bad numbers. Validation stops it, the details go to the server log, and the agent is told not to retry, because the same request will fail again.' },
  { number: '05', title: 'Return only what the agent needs, with its source', file: 'src/lab19Service.ts', code: "export function narrow(place, forecast, live, fetchedAt): WeatherReport {\n  return {\n    source: live ? 'Weather data by Open-Meteo.com (CC BY 4.0), fetched live'\n                 : 'Recorded sample in the Open-Meteo format. NOT live data.',\n    fetched_at: fetchedAt,\n    place: { name, region, country, latitude, longitude, timezone },\n    current: { time, temperature, conditions: describeCode(code), wind_speed },\n    days: forecast.days.map((day) => ({ date, conditions, max, min, … })),\n  };\n}\n// raw: two responses, several kilobytes → tool output: well under one\nctx.cache?.set(url, upstream.body, upstream.bytes); // 10 minutes", explanation: 'The raw responses include postcodes, internal IDs, generation times, and weather codes. The agent needs none of that. Narrowing keeps only the fields that answer the question, turns codes into words such as light rain, and adds provenance: where the data came from, when it was fetched, and which place was resolved. A smaller output costs fewer tokens and leaves the model less to misread. Validated responses are cached for ten minutes, because the weather does not change second by second, and the cache also protects the free service from repeated calls.' },
  { number: '06', title: 'Check that the answer is grounded', file: 'src/lab19Service.ts', code: "export function checkGrounding(answer: string, reports: WeatherReport[]): Grounding {\n  const allowed = allowedNumbers(reports); // every value, plus date parts\n  for (const text of answer.match(/(?<![\\d.,])-?\\d+(?:[.,]\\d+)?/g) ?? []) {\n    const value = Number(text.replace(',', '.'));\n    (allowed.some((item) => Math.abs(item - value) <= 0.5)\n      ? grounded : unsupported).push(text);\n  }\n  return { figures, grounded, unsupported };\n}\n// instructions: 'Base every figure on the tool output… name the source and fetched_at.'", explanation: 'Grounded means the answer’s facts come from the data, not from the model’s memory. The instructions ask for this: use only the tool’s figures, name the place, and cite the source and time. Then the page checks it. Every number in the answer should match a value the tool returned, allowing for rounding. This is a heuristic, not a proof, but it catches the common failures, such as a converted temperature or an invented figure. Run the same question with the tool turned off to see the difference.' },
];

const prompts = [
  { label: 'Right now', text: 'What is the weather in Madrid right now?' },
  { label: 'Umbrella?', text: 'Do I need an umbrella in London over the next 3 days?' },
  { label: 'Qualified place', text: 'How hot will it get in Paris, Texas tomorrow? Use Fahrenheit.' },
  { label: 'Two cities', text: 'Compare today’s weather in Tokyo and New York.' },
  { label: 'Closest match', text: 'Is it sunny in Wakanda today?' },
  { label: 'No such place', text: 'What is the 5-day forecast for Qwertyville?' },
];

const probePresets = [
  { label: 'Madrid · 3 days', city: 'Madrid', days: '3', units: 'celsius' },
  { label: 'Paris, Texas · °F', city: 'Paris, Texas', days: '2', units: 'fahrenheit' },
  { label: 'Wakanda (live)', city: 'Wakanda', days: '1', units: 'celsius' },
  { label: 'Qwertyville', city: 'Qwertyville', days: '3', units: 'celsius' },
  { label: 'Madrid, Japan', city: 'Madrid, Japan', days: '1', units: 'celsius' },
  { label: '14 days', city: 'Tokyo', days: '14', units: 'celsius' },
];

const sampleForecast = forecastUrl({ latitude: 40.4165, longitude: -3.70256 }, 3, 'celsius');
const guardPresets = [
  { label: 'The forecast URL', url: sampleForecast, method: 'GET' },
  { label: 'Same URL, POST', url: sampleForecast, method: 'POST' },
  { label: 'Cloud metadata', url: 'http://169.254.169.254/latest/meta-data/', method: 'GET' },
  { label: 'Look-alike host', url: 'https://api.open-meteo.com.evil.example/v1/forecast', method: 'GET' },
  { label: 'Another path', url: 'https://api.open-meteo.com/v1/archive?latitude=40.4', method: 'GET' },
];

const groups: Array<{ id: TestGroup; label: string }> = [
  { id: 'valid', label: 'Valid calls' },
  { id: 'input', label: 'Rejected before the network' },
  { id: 'upstream', label: 'What the service can do' },
];

function codeTokens(tokens: Array<string | Prism.Token>, prefix = ''): React.ReactNode {
  return tokens.map((token, index) => {
    if (typeof token === 'string') return token;
    const key = `${prefix}-${index}`;
    const content = typeof token.content === 'string' ? token.content : codeTokens(Array.isArray(token.content) ? token.content : [token.content], key);
    return <span className={'token ' + token.type} key={key}>{content}</span>;
  });
}
const json = (value: unknown) => codeTokens(Prism.tokenize(JSON.stringify(value, null, 2) ?? 'undefined', Prism.languages.json || Prism.languages.javascript));
const newId = (): string => `run_${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36)}`;
const stageLabel = (stage: Stage) => stages.find((item) => item.id === stage)?.label ?? stage;
const argsText = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));
const kb = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);
const unitOf = (report: WeatherReport) => report.units.temperature;

async function readLines(response: Response, onLine: (line: Record<string, unknown>) => void) {
  if (!response.body) throw new Error('The browser could not read the response stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n'); buffer = lines.pop() || '';
    for (const raw of lines) if (raw.trim()) onLine(JSON.parse(raw) as Record<string, unknown>);
  }
}

// The gates a call passes through. A call stops at its first failing gate; later gates never run.
function Pipeline({ outcome }: { outcome: Pick<ServiceOutcome, 'stage' | 'success'> | null }) {
  const stop = outcome ? stages.findIndex((item) => item.id === outcome.stage) : -1;
  return <ol className="lab18-pipeline lab19-pipeline" aria-label="Service pipeline">{stages.map((item, index) => {
    const state = !outcome ? '' : index < stop ? 'pass' : index === stop ? (outcome.success ? 'pass' : 'fail') : 'skip';
    return <li key={item.id} className={state}><span>{state === 'pass' ? '✓' : state === 'fail' ? '✕' : index + 1}</span><strong>{item.label}</strong><small>{state === 'skip' ? 'not reached' : item.detail}</small></li>;
  })}</ol>;
}

function Requests({ requests }: { requests: UpstreamRequest[] }) {
  if (!requests.length) return <p className="lab16-warn-line">No request left the server.</p>;
  return <ol className="lab19-requests">{requests.map((request, index) => <li key={index} className={request.outcome}>
    <span className="lab19-method">GET</span>
    <code className="lab19-host">{request.host}<b>{request.path}</b></code>
    <span className={'lab19-status ' + request.outcome}>{request.cached ? 'cache hit' : request.status ?? request.outcome}</span>
    <span className="lab15-ids">{request.cached ? '0 ms' : `${request.durationMs} ms`} · {kb(request.bytes)}</span>
    {request.outcome !== 'ok' && request.outcome !== 'status' ? <span className="lab19-why">{request.outcome}</span> : null}
  </li>)}</ol>;
}

function ReportTable({ report }: { report: WeatherReport }) {
  const place = [report.place.region !== report.place.name ? report.place.region : null, report.place.country].filter(Boolean).join(', ');
  return <div className={'lab19-report' + (report.live ? '' : ' recorded')}>
    <div className="lab19-report-head"><strong>{report.place.name}</strong><span>{place}</span><span className={'lab19-source ' + (report.live ? 'live' : 'recorded')}>{report.live ? 'LIVE' : 'RECORDED · NOT LIVE'}</span></div>
    {report.match_note ? <p className="lab19-match">{report.match_note}</p> : null}
    {report.current ? <p className="lab19-now"><b>{report.current.temperature}{unitOf(report)}</b> {report.current.conditions}{report.current.wind_speed !== null ? ` · wind ${report.current.wind_speed} ${report.units.wind}` : ''} <small>at {report.current.time} local</small></p> : null}
    <div className="lab9-table-wrap"><table><thead><tr><th>Date</th><th>Conditions</th><th>Max</th><th>Min</th><th>Rain</th><th>Wind</th></tr></thead>
      <tbody>{report.days.map((day) => <tr key={day.date}><th>{day.date}</th><td>{day.conditions}</td><td>{day.max}{unitOf(report)}</td><td>{day.min}{unitOf(report)}</td><td>{day.precipitation_probability ?? '—'}%{day.precipitation ? ` · ${day.precipitation} ${report.units.precipitation}` : ''}</td><td>{day.wind_max ?? '—'} {report.units.wind}</td></tr>)}</tbody></table></div>
    <p className="lab19-provenance">{report.source} · fetched_at <code>{report.fetched_at}</code> · {report.place.latitude}, {report.place.longitude} · {report.place.timezone}</p>
  </div>;
}

function OutcomeView({ outcome, callId, turnId }: { outcome: ServiceOutcome; callId: string; turnId: string }) {
  const rawBytes = outcome.requests.reduce((total, request) => total + request.bytes, 0);
  const outBytes = bytesOf(outcome.output);
  return <div className="lab18-outcome">
    <Pipeline outcome={outcome} />
    <div className="lab18-badges"><span className={'lab18-stage ' + (outcome.success ? 'ok' : 'fail')}>{outcome.success ? 'ran · success: true' : `stopped at ${stageLabel(outcome.stage)}`}</span>{!outcome.success ? <span className={'lab18-retry ' + (outcome.retryable ? 'yes' : 'no')}>{outcome.retryable ? 'retry allowed' : 'do not retry'}</span> : null}<span className="lab15-ids">{Math.round(outcome.durationMs)} ms · {outcome.requests.length} upstream request{outcome.requests.length === 1 ? '' : 's'}</span></div>
    {outcome.issues.length ? <ul className="lab18-issues">{outcome.issues.map((item, index) => <li key={index}><span className={'lab18-layer ' + item.layer}>{item.layer}</span><code>{item.path}</code><span>{item.message}</span></li>)}</ul> : null}
    <h4 className="lab18-h4">Upstream requests <small>built by code, checked by the guard</small></h4>
    <Requests requests={outcome.requests} />
    {outcome.report ? <ReportTable report={outcome.report} /> : null}
    {outcome.success && rawBytes ? <div className="lab19-shrink"><div><span>raw responses</span><b>{kb(rawBytes)}</b></div><div className="lab19-shrink-arrow" aria-hidden="true">→</div><div><span>tool output</span><b>{kb(outBytes)}</b></div><p>{rawBytes > outBytes ? `${Math.round((1 - outBytes / rawBytes) * 100)}% smaller.` : 'About the same size.'} Only the fields that answer the question, plus where and when they came from.</p></div> : null}
    <div className="lab16-args">
      <div><h4>tool_result <small>what the agent receives</small></h4><pre className="lab19-scroll"><code>{json(toolResultEvent({ callId, turnId, success: outcome.success, output: outcome.output, error: outcome.error }))}</code></pre></div>
      <div>{outcome.args ? <><h4>validated arguments <small>typed WeatherArgs</small></h4><pre><code>{json(outcome.args)}</code></pre></> : <><h4>validated arguments</h4><p className="lab16-warn-line">None. No request was built.</p></>}</div>
    </div>
    {outcome.internal ? <div className="lab18-internal"><h4>Server log <small>never sent to the agent</small></h4><pre>{outcome.internal}</pre></div> : null}
    {outcome.requests.some((request) => request.raw) ? <details className="lab16-preview"><summary>Raw responses <small>what the service sent; the agent never sees this</small></summary>{outcome.requests.filter((request) => request.raw).map((request, index) => <div key={index}><h4 className="lab18-h4">{request.path} <small>{kb(request.bytes)}{request.cached ? ' · from cache' : ''}</small></h4><pre className="lab18-raw lab19-raw"><code>{json(request.raw)}</code></pre></div>)}</details> : null}
  </div>;
}

function GuardTester() {
  const [url, setUrl] = useState(guardPresets[0].url);
  const [method, setMethod] = useState('GET');
  const guard = checkRequest(url, method);
  return <div className="lab19-guard">
    <div className="lab16-prompts">{guardPresets.map((item) => <button type="button" key={item.label} className={url === item.url && method === item.method ? 'selected' : ''} onClick={() => { setUrl(item.url); setMethod(item.method); }}>{item.label}</button>)}</div>
    <div className="lab19-guard-row">
      <select aria-label="Method" value={method} onChange={(event) => setMethod(event.target.value)}>{['GET', 'POST', 'PUT', 'DELETE'].map((item) => <option key={item}>{item}</option>)}</select>
      <input aria-label="URL" value={url} maxLength={500} onChange={(event) => setUrl(event.target.value)} spellCheck={false} />
    </div>
    <p className={'lab19-guard-verdict ' + (guard.ok ? 'ok' : 'fail')}>{guard.ok ? '✓ Allowed. This request may leave the server.' : `✕ Blocked: ${guard.reason}`}</p>
  </div>;
}

function Timeline({ moments }: { moments: Moment[] }) {
  if (!moments.length) return null;
  const first = moments[0].at;
  return <ol className="lab17-timeline lab18-timeline lab19-timeline">{moments.map((moment, index) => <li key={index} className={moment.kind}><span className="lab17-at">+{((moment.at - first) / 1000).toFixed(2)}s</span><span className="lab17-kind">{moment.kind}</span><span className="lab17-label">{moment.label}</span></li>)}</ol>;
}

function GroundingView({ run }: { run: WeatherRun }) {
  if (!run.answer) return null;
  const grounding = checkGrounding(run.answer, reportsOf(run));
  return <div className="lab19-grounding">
    <h4 className="lab18-h4">Grounding check <small>every number in the answer vs. the tool output · a heuristic</small></h4>
    {grounding.figures ? <div className="lab19-chips">{grounding.grounded.map((item, index) => <span key={`g${index}`} className="lab19-chip ok" title="Matches a value the tool returned">{item}</span>)}{grounding.unsupported.map((item, index) => <span key={`u${index}`} className="lab19-chip fail" title="Not in the tool output">{item}</span>)}</div> : <p className="lab8-note">The answer contains no numbers to check.</p>}
    {grounding.figures ? <p className="lab8-note"><b>{grounding.grounded.length}</b> found in the data · <b>{grounding.unsupported.length}</b> not found{!reportsOf(run).length ? ' (there was no data to compare with)' : ''}.</p> : null}
  </div>;
}

function RunView({ run }: { run: WeatherRun }) {
  const verdict = classifyWeatherRun(run);
  return <div className="lab16-run">
    <div className={'lab16-verdict lab19-verdict ' + verdict.tone}><strong>{verdict.title}</strong><p>{verdict.text}</p></div>
    <div className="lab15-summary-head"><span className="lab15-ids">tool <code>{run.toolOffered ? weatherTool.name : 'none'}</code>{run.toolOffered ? <> · data <code>{run.source}</code> · service <code>{faults.find((item) => item.id === run.fault)?.label}</code></> : null} · turn <span className={'lab14-status ' + run.turnStatus}>{run.turnStatus}</span> · rounds <b>{run.rounds}</b>{run.sessionId ? <> · session <code>{shortId(run.sessionId)}</code></> : null}</span></div>
    {run.answer ? <><h3 className="lab13-subhead">Answer <code>{reportsOf(run).length ? 'from service data' : run.toolOffered ? 'without service data' : 'no tool offered'}</code></h3><div className="lab7-answer lab16-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: AnswerPre }}>{run.answer}</ReactMarkdown></div></> : null}
    <GroundingView run={run} />
    <h3 className="lab13-subhead">Trace <code>call → GET → result → answer</code></h3>
    <Timeline moments={run.timeline} />
    {run.calls.length ? <><h3 className="lab13-subhead">Every call, and what the service returned <code>matched by call_id</code></h3><div className="lab17-pairs">{run.calls.map((call, index) => { const result = run.results.find((item) => item.callId === call.callId); return <article key={call.callId} className="lab17-pair">
      <div className="lab16-call-head"><span className="lab16-call-n">{index + 1}</span><code className="lab16-fn">{call.name}(…)</code><span className="lab15-ids">call_id <code>{call.callId}</code>{result ? <> · round <b>{result.round}</b></> : null}</span></div>
      <h4 className="lab18-h4">function_call arguments <small>from the agent</small></h4><pre className="lab18-raw"><code>{json(call.arguments)}</code></pre>
      {result ? <OutcomeView outcome={result} callId={result.callId} turnId={result.turnId} /> : <p className="lab17-finding error">No result was sent for this call.</p>}
    </article>; })}</div></> : null}
    <details className="lab16-preview"><summary>All events <small>{run.events.length} in arrival order</small></summary><ol className="lab16-events lab17-events">{run.events.map((name, index) => <li key={index}><code>{name.replace('agent.session.', '')}</code></li>)}</ol></details>
    {run.error ? <p className="lab2-error" role="alert">{run.error}</p> : null}
  </div>;
}

function SavedItems({ items }: { items: TraceItem[] }) {
  const parse = (output: unknown) => { if (typeof output !== 'string') return output; try { return JSON.parse(output); } catch { return output; } };
  return <ol className="lab17-items">{items.map((item, index) => <li key={item.id ?? index} className={item.type}>
    <div><code className="lab17-item-type">{item.type}</code>{item.role ? <span className="lab17-role">{item.role}</span> : null}{item.name ? <code>{item.name}</code> : null}{item.callId ? <span className="lab15-ids">call_id <code>{item.callId}</code></span> : null}{item.status ? <span className="lab15-ids">{item.status}</span> : null}</div>
    {item.text ? <p>{item.text.length > 280 ? `${item.text.slice(0, 280)}…` : item.text}</p> : null}
    {item.type === 'function_call' ? <pre><code>{json(item.arguments)}</code></pre> : null}
    {item.type === 'function_call_output' ? <pre className="lab19-scroll"><code>{json(item.error ? { error: item.error } : { output: parse(item.output) })}</code></pre> : null}
  </li>)}</ol>;
}

// Runtime boundary for the server's suite results.
function parseSuite(body: unknown): Suite {
  const value = body as { results?: unknown; runtime?: unknown; durationMs?: unknown };
  if (!Array.isArray(value.results)) throw new Error('Invalid test results.');
  const results: Record<string, TestResult> = {};
  for (const raw of value.results as Array<Record<string, unknown>>) {
    if (typeof raw?.id !== 'string' || typeof raw.pass !== 'boolean') throw new Error('Invalid test result.');
    results[raw.id] = { id: raw.id, pass: raw.pass, outcome: parseOutcome(raw.outcome) };
  }
  return { source: 'server', runtime: typeof value.runtime === 'string' ? value.runtime : 'Node', durationMs: typeof value.durationMs === 'number' ? value.durationMs : 0, results };
}

function SourceChoice({ name, value, onChange, disabled }: { name: string; value: Source; onChange: (source: Source) => void; disabled?: boolean }) {
  return <fieldset className="lab15-modes lab16-after"><legend>Where the data comes from</legend>
    <label className={value === 'live' ? 'selected' : ''}><input type="radio" name={name} checked={value === 'live'} onChange={() => onChange('live')} disabled={disabled} /><span><strong>Live Open-Meteo</strong><small>Real HTTPS requests from this server. Free, no key.</small></span></label>
    <label className={value === 'recorded' ? 'selected' : ''}><input type="radio" name={name} checked={value === 'recorded'} onChange={() => onChange('recorded')} disabled={disabled} /><span><strong>Recorded sample</strong><small>Same JSON shapes, no network. Knows {recordedCities.join(', ')}.</small></span></label>
  </fieldset>;
}
function FaultChoice({ name, value, onChange, disabled }: { name: string; value: Fault; onChange: (fault: Fault) => void; disabled?: boolean }) {
  return <fieldset className="lab15-modes lab16-after lab18-faults lab19-faults"><legend>How the service behaves</legend>{faults.map((item) => <label key={item.id} className={value === item.id ? 'selected' : ''}><input type="radio" name={name} checked={value === item.id} onChange={() => onChange(item.id)} disabled={disabled} /><span><strong>{item.label}</strong><small>{item.hint}</small></span></label>)}</fieldset>;
}

export default function Lab19({ active, health }: { active: boolean; health: Health }) {
  const [probeCity, setProbeCity] = useState('Madrid');
  const [probeDays, setProbeDays] = useState('3');
  const [probeUnits, setProbeUnits] = useState('celsius');
  const [probeSource, setProbeSource] = useState<Source>('live');
  const [probeFault, setProbeFault] = useState<Fault>('none');
  const [probe, setProbe] = useState<Probe | null>(null);
  const [probeBusy, setProbeBusy] = useState(false);
  const [suite, setSuite] = useState<Suite | null>(null);
  const [suiteBusy, setSuiteBusy] = useState<'browser' | 'server' | null>(null);
  const [testId, setTestId] = useState(serviceTests[0].id);
  const [prompt, setPrompt] = useState(prompts[1].text);
  const [source, setSource] = useState<Source>('live');
  const [fault, setFault] = useState<Fault>('none');
  const [toolOffered, setToolOffered] = useState(true);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [live, setLive] = useState<Live | null>(null);
  const [runs, setRuns] = useState<WeatherRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<{ runId: string; list: TraceItem[]; hasMore: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [speaking, setSpeaking] = useState<Speaking>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const abort = useRef<AbortController | null>(null);
  const speechRun = useRef(0);
  const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  const selected = runs.find((run) => run.id === selectedId) ?? runs.at(-1) ?? null;
  const test = serviceTests.find((item) => item.id === testId) ?? serviceTests[0];
  const testResult = suite?.results[test.id] ?? null;
  const passed = suite ? Object.values(suite.results).filter((item) => item.pass).length : 0;

  // Numbers stay numbers; anything else is sent as typed, so validation can reject it just as it would the agent's.
  const probeArguments = () => ({ city: probeCity, days: /^-?\d+(\.\d+)?$/.test(probeDays.trim()) ? Number(probeDays) : probeDays, units: probeUnits });
  async function runProbe() {
    setProbeBusy(true); setError('');
    try {
      const response = await fetch('/api/lab19/probe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ arguments: probeArguments(), source: probeSource, fault: probeFault }) });
      const body = await response.json() as { outcome?: unknown; source?: unknown; cacheSize?: unknown; error?: string };
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
      setProbe({ outcome: parseOutcome(body.outcome), source: body.source === 'recorded' ? 'recorded' : 'live', cacheSize: typeof body.cacheSize === 'number' ? body.cacheSize : 0 });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The probe failed.'); }
    finally { setProbeBusy(false); }
  }
  async function clearCache() {
    try {
      const response = await fetch('/api/lab19/cache', { method: 'DELETE' });
      if (response.ok) setProbe((previous) => previous && { ...previous, cacheSize: 0 });
    } catch { setError('Could not clear the cache.'); }
  }

  async function runInBrowser() {
    setSuiteBusy('browser'); setError('');
    const started = performance.now();
    try {
      const results = await runServiceSuite();
      setSuite({ source: 'browser', runtime: 'this browser', durationMs: Math.round(performance.now() - started), results: Object.fromEntries(results.map((item) => [item.id, item])) });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The suite crashed.'); }
    finally { setSuiteBusy(null); }
  }
  async function runOnServer() {
    setSuiteBusy('server'); setError('');
    try {
      const response = await fetch('/api/lab19/test', { method: 'POST' });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error((body as { error?: string }).error || `Request failed (${response.status}).`);
      setSuite(parseSuite(body));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not run the suite on the server.'); }
    finally { setSuiteBusy(null); }
  }

  function onLine(line: Record<string, unknown>, capture: (summary: unknown) => void) {
    if (line.type === 'status' && typeof line.label === 'string') setStatus(line.label);
    if (line.type === 'event' && typeof line.name === 'string') { const name = line.name; setLive((previous) => previous && { ...previous, events: [...previous.events, name] }); }
    if (line.type === 'text' && typeof line.text === 'string') { const answer = line.text; setLive((previous) => previous && { ...previous, answer }); }
    if (line.type === 'call' && typeof line.call === 'object' && line.call) { const call = line.call as ToolCall; setLive((previous) => previous && { ...previous, calls: [...previous.calls.filter((item) => item.callId !== call.callId), call] }); }
    if (line.type === 'result' && typeof line.result === 'object' && line.result) { const result = line.result as CheckedResult; setLive((previous) => previous && { ...previous, results: [...previous.results, result] }); }
    if (line.type === 'moment' && typeof line.moment === 'object' && line.moment) { const moment = line.moment as Moment; setLive((previous) => previous && { ...previous, timeline: [...previous.timeline, moment] }); }
    if (line.type === 'summary') capture(line.summary);
  }

  async function runOnce() {
    const question = prompt.trim();
    if (!question || running) return;
    const id = newId();
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true); setError(''); setItems(null); setStatus(''); setLive({ events: [], calls: [], results: [], answer: '', timeline: [] });
    try {
      const response = await fetch('/api/lab19/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ prompt: question, source, fault, tool: toolOffered ? 'on' : 'off' }) });
      if (!response.ok) throw new Error((await response.json()).error || `Request failed (${response.status}).`);
      let record: WeatherRun | null = null;
      await readLines(response, (line) => onLine(line, (summary) => { record = parseWeatherRun(summary, id, question); }));
      if (!record) throw new Error('The stream ended without a run summary.');
      const finished: WeatherRun = record;
      setRuns((previous) => [...previous, finished]);
      setSelectedId(id);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'The run failed.');
    } finally {
      if (abort.current === controller) abort.current = null;
      setRunning(false); setLive(null);
    }
  }

  async function readItems(run: WeatherRun) {
    if (!run.sessionId) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/lab19/items?${new URLSearchParams({ sessionId: run.sessionId })}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
      setItems({ runId: run.id, list: Array.isArray(body.items) ? body.items as TraceItem[] : [], hasMore: body.hasMore === true });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not read the saved items.'); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!speechAvailable) return;
    const synthesis = window.speechSynthesis;
    const refresh = () => setVoices(synthesis.getVoices());
    refresh(); synthesis.addEventListener('voiceschanged', refresh);
    return () => synthesis.removeEventListener('voiceschanged', refresh);
  }, [speechAvailable]);
  useEffect(() => () => { abort.current?.abort(); if (speechAvailable) window.speechSynthesis.cancel(); }, [speechAvailable]);
  useEffect(() => { if (!active) stopSpeech(); }, [active]);

  function stopSpeech() { speechRun.current += 1; if (speechAvailable) window.speechSynthesis.cancel(); setSpeaking(null); }
  // Queue one or more explanations; the run counter ignores callbacks from cancelled narrations.
  function speak(queue: Lesson[], speechMode: 'one' | 'all') {
    if (!speechAvailable) return;
    stopSpeech();
    const run = speechRun.current;
    const narrator = selectNarratorVoice(voices.length ? voices : window.speechSynthesis.getVoices());
    queue.forEach((lesson, index) => {
      const utterance = new SpeechSynthesisUtterance(`${speechMode === 'all' ? `Snippet ${Number(lesson.number)}. ` : ''}${lesson.title}. ${lesson.explanation}`);
      if (narrator) utterance.voice = narrator;
      utterance.lang = narrator?.lang || 'en-US';
      utterance.pitch = narrator && masculineVoiceName.test(narrator.name) ? 1 : 0.78;
      utterance.rate = 0.95;
      utterance.onstart = () => { if (speechRun.current === run) setSpeaking({ mode: speechMode, lesson: lesson.number }); };
      utterance.onerror = () => { if (speechRun.current === run) setSpeaking(null); };
      if (index === queue.length - 1) utterance.onend = () => { if (speechRun.current === run) setSpeaking(null); };
      window.speechSynthesis.speak(utterance);
    });
    setSpeaking({ mode: speechMode, lesson: queue[0].number });
  }
  function readLesson(lesson: Lesson) { if (speaking?.lesson === lesson.number) stopSpeech(); else speak([lesson], 'one'); }
  function readAll() { if (speaking?.mode === 'all') stopSpeech(); else speak(lessons, 'all'); }

  return <div className="lab16-page lab17-page lab18-page lab19-page">
    <div className="lab2-hero"><span className="lab2-badge lab19-badge">19/50</span><div><div className="eyebrow">LAB 19 / CONNECT A READ-ONLY SERVICE</div><h1>Connect a <em>read-only service</em>.</h1><p>Until now the tool answered from a list in our own code. Now a real external API sits behind it. Wrap the <a href={service.site} target="_blank" rel="noreferrer">Open-Meteo</a> weather service in one narrow, typed function: the model chooses a city, a number of days, and the units, and your server chooses everything else. It builds the request, checks where it goes, validates what comes back, and hands the agent a small, sourced result that its answer can be grounded in.</p></div></div>

    <section className="lab7-card"><span className="eyebrow">THE WRAPPER</span><h2>One narrow function in front of a real API</h2>
      <div className="lab19-split">
        <div><h3 className="lab13-subhead">The model chooses <code>3 arguments</code></h3><pre className="lab19-decl"><code>{json(weatherTool.parameters.properties)}</code></pre></div>
        <div><h3 className="lab13-subhead">Your server fixes <code>everything else</code></h3><ul className="lab19-fixed">
          <li><b>Where:</b> two allowlisted hosts, one path each, HTTPS only</li>
          <li><b>How:</b> <code>GET</code> only, redirects refused</li>
          <li><b>What:</b> the fields requested, built with <code>URLSearchParams</code></li>
          <li><b>How long:</b> one {liveTiming.timeoutMs / 1000} s deadline for the whole call</li>
          <li><b>How much:</b> responses over {service.maxBytes / 1000} KB rejected</li>
          <li><b>What comes back:</b> validated, narrowed, labelled with source and time</li>
          <li><b>How often:</b> validated responses cached for {service.cacheTtlMs / 60_000} minutes</li>
        </ul></div>
      </div>
      <p>Each call passes eight gates. It stops at the first one it fails, and still gets exactly one <code>tool_result</code>. Two requests happen inside: <code>{new URL(geocodeUrl('Madrid')).host}</code> finds the place, then <code>{new URL(sampleForecast).host}</code> returns its forecast.</p>
      <Pipeline outcome={probe?.outcome ?? testResult?.outcome ?? null} />
    </section>

    <section className="lab7-card" id="lab19-probe"><span className="eyebrow">SERVICE PROBE · NO OPENAI KEY NEEDED</span><h2>Call the wrapper yourself</h2><p>This sends the same arguments an agent would send to the same <code>runWeatherTool</code> on the server. There is no model involved, so you can see exactly what the service returns and what the agent would receive.</p>
      <div className="lab16-prompts">{probePresets.map((item) => <button type="button" key={item.label} className={probeCity === item.city && probeDays === item.days && probeUnits === item.units ? 'selected' : ''} onClick={() => { setProbeCity(item.city); setProbeDays(item.days); setProbeUnits(item.units); }} disabled={probeBusy}>{item.label}</button>)}</div>
      <div className="lab19-probe-form">
        <div><label htmlFor="lab19-city">city</label><input id="lab19-city" value={probeCity} maxLength={120} onChange={(event) => setProbeCity(event.target.value)} spellCheck={false} /></div>
        <div><label htmlFor="lab19-days">days</label><input id="lab19-days" value={probeDays} maxLength={6} onChange={(event) => setProbeDays(event.target.value)} inputMode="numeric" /></div>
        <div><label htmlFor="lab19-units">units</label><select id="lab19-units" value={probeUnits} onChange={(event) => setProbeUnits(event.target.value)}><option value="celsius">celsius</option><option value="fahrenheit">fahrenheit</option><option value="kelvin">kelvin (not allowed)</option></select></div>
      </div>
      <div className="lab19-choices"><SourceChoice name="lab19-probe-source" value={probeSource} onChange={setProbeSource} disabled={probeBusy} /><FaultChoice name="lab19-probe-fault" value={probeFault} onChange={setProbeFault} disabled={probeBusy} /></div>
      <div className="lab8-actions"><button type="button" className="lab7-primary" onClick={() => void runProbe()} disabled={probeBusy}>{probeBusy ? 'Calling…' : 'Call the service'}</button>{probe ? <button type="button" className="lab8-secondary" onClick={() => void clearCache()} disabled={probeBusy || !probe.cacheSize}>Clear the cache ({probe.cacheSize})</button> : null}</div>
      <p className="lab8-note">Call Live Open-Meteo twice with the same arguments: the second call is a cache hit and sends nothing. Faults and recorded data never touch the cache.</p>
      {probe ? <div className="lab19-probe-result"><h3 className="lab13-subhead">get_weather_forecast({argsText(probeArguments())}) <code>{probe.source}</code></h3><OutcomeView outcome={probe.outcome} callId="call_probe_1" turnId="turn_probe_1" /></div> : null}
      <details className="lab18-custom"><summary>Try the request guard</summary>
        <p className="lab8-note">Code builds every URL, so the guard should never fire. It is a second line of defence, and this is what it allows.</p>
        <GuardTester />
      </details>
    </section>

    <section className="lab7-card" id="lab19-tests"><span className="eyebrow">SERVICE TEST PAGE · RECORDED RESPONSES</span><h2>{serviceTests.length} cases, with no network</h2><p>Every case runs the real wrapper against recorded Open-Meteo responses, and faults wrap the recorded fetcher exactly as they wrap the live one. Run it in this browser or on the server. Nothing is sent to OpenAI or to Open-Meteo.</p>
      <div className="lab8-actions"><button type="button" className="lab7-primary" onClick={() => void runInBrowser()} disabled={Boolean(suiteBusy)}>{suiteBusy === 'browser' ? 'Running…' : 'Run all in the browser'}</button><button type="button" className="lab8-secondary" onClick={() => void runOnServer()} disabled={Boolean(suiteBusy)}>{suiteBusy === 'server' ? 'Running…' : 'Run all on the server'}</button></div>
      {suite ? <p className={'lab18-score ' + (passed === serviceTests.length ? 'ok' : 'fail')}><b>{passed}/{serviceTests.length} passed</b> · ran in {suite.runtime} · {suite.durationMs} ms (the {testTiming.timeoutMs} ms timeout case sets the pace)</p> : <p className="lab8-note">Not run yet. Each row states the gate where the call must stop.</p>}
      <div className="lab18-tests">
        <div className="lab9-table-wrap lab18-table lab19-table"><table>
          <thead><tr><th>Case</th><th>Arguments</th><th>Expect</th><th>Got</th><th /></tr></thead>
          {groups.map((group) => <tbody key={group.id}><tr className="lab18-group"><th colSpan={5}>{group.label}</th></tr>{serviceTests.filter((item) => item.group === group.id).map((item) => { const result = suite?.results[item.id]; return <tr key={item.id} className={item.id === test.id ? 'selected' : ''} onClick={() => setTestId(item.id)}>
            <th><button type="button" className="lab15-link" onClick={() => setTestId(item.id)} aria-pressed={item.id === test.id}>{item.label}</button>{item.fault !== 'none' ? <small className="lab18-fault">{faults.find((entry) => entry.id === item.fault)?.label}</small> : null}{item.name !== weatherTool.name ? <small className="lab18-fault">{item.name}</small> : null}{item.twice ? <small className="lab18-fault">called twice</small> : null}</th>
            <td><code className="lab18-args">{argsText(item.args)}</code></td>
            <td><span className="lab18-expect">{stageLabel(item.expect)}</span></td>
            <td>{result ? <span className="lab18-expect">{stageLabel(result.outcome.stage)}</span> : '—'}</td>
            <td>{result ? <span className={'lab18-pass ' + (result.pass ? 'ok' : 'fail')}>{result.pass ? 'PASS' : 'FAIL'}</span> : null}</td>
          </tr>; })}</tbody>)}
        </table></div>
        <div className="lab18-detail lab19-detail">
          <h3 className="lab13-subhead">{test.label} <code>expect {stageLabel(test.expect)}</code></h3>
          <p className="lab8-note">{test.note}</p>
          <h4 className="lab18-h4">arguments <small>{typeof test.args === 'string' ? 'a raw string' : 'as the agent sent them'}</small></h4>
          <pre className="lab18-raw"><code>{json(test.args)}</code></pre>
          {testResult ? <OutcomeView outcome={testResult.outcome} callId={`call_test_${test.id}`} turnId="turn_test_1" /> : <p className="lab8-note">Run the suite to see this case’s requests, outcome, and the exact event the server would send.</p>}
        </div>
      </div>
    </section>

    <section className="lab7-card"><span className="eyebrow">LIVE RUN</span><h2>Ground the agent in live data</h2>
      <div className="lab16-prompts">{prompts.map((item) => <button type="button" key={item.label} className={prompt === item.text ? 'selected' : ''} onClick={() => setPrompt(item.text)} disabled={running}>{item.label}</button>)}</div>
      <label htmlFor="lab19-prompt">Your question</label>
      <textarea id="lab19-prompt" value={prompt} maxLength={2000} onChange={(event) => setPrompt(event.target.value)} disabled={running} />
      <fieldset className="lab15-modes lab16-after"><legend>What the agent gets</legend>
        <label className={toolOffered ? 'selected' : ''}><input type="radio" name="lab19-tool" checked={toolOffered} onChange={() => setToolOffered(true)} disabled={running} /><span><strong>The weather tool</strong><small>{weatherTool.name}, backed by the service below.</small></span></label>
        <label className={!toolOffered ? 'selected' : ''}><input type="radio" name="lab19-tool" checked={!toolOffered} onChange={() => setToolOffered(false)} disabled={running} /><span><strong>No tool</strong><small>The same model with no data source, for comparison.</small></span></label>
      </fieldset>
      {toolOffered ? <div className="lab19-choices"><SourceChoice name="lab19-source" value={source} onChange={setSource} disabled={running} /><FaultChoice name="lab19-fault" value={fault} onChange={setFault} disabled={running} /></div> : null}
      <div className="lab8-actions"><button type="button" className="lab7-primary" onClick={() => void runOnce()} disabled={running || !health?.configured || !prompt.trim()}>{running ? 'Running…' : 'Ask the agent'}</button>{running ? <button type="button" className="lab8-secondary" onClick={() => abort.current?.abort()}>Stop reading</button> : null}</div>
      {!health?.configured ? <p className="lab8-note">Add OPENAI_API_KEY to .env and restart the server for a live run. The probe and the test page above work without a key.</p> : null}
      <p className="lab8-note">The server answers every pause automatically, up to {maxRounds} rounds, then cancels the turn. Several calls in one pause (such as two cities) run one after another.</p>
      {status ? <p className="lab7-session-id">{status}</p> : null}
      {live ? <div className="lab16-live"><Timeline moments={live.timeline} />{live.answer ? <div className="lab7-answer lab16-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: AnswerPre }}>{live.answer}</ReactMarkdown></div> : null}</div> : null}
      {error ? <p className="lab2-error" role="alert">{error}</p> : null}
    </section>

    <div className="lab16-grid">
      <section className="lab7-card"><span className="eyebrow">RESULT</span><h2>{selected ? `Run #${runs.indexOf(selected) + 1}` : 'No run yet'}</h2>
        {selected ? <>
          <p className="lab16-prompt-line">“{selected.prompt}”</p>
          <RunView run={selected} />
          {selected.sessionId ? <div className="lab8-actions"><button type="button" className="lab8-secondary" onClick={() => void readItems(selected)} disabled={busy || running}>{busy ? 'Reading…' : 'Read the saved items'}</button></div> : null}
          {items && items.runId === selected.id ? <div className="lab16-saved"><h3 className="lab13-subhead">Saved items <code>sessions.items.list</code></h3>{items.list.length ? <SavedItems items={items.list} /> : <p className="lab8-note">No items yet.</p>}{items.hasMore ? <p className="lab8-note">Showing the first 100 items.</p> : null}</div> : null}
        </> : <p className="lab8-note">Ask the <em>Umbrella?</em> question with live data. The agent calls the tool, the server makes two real requests, and the grounding check compares every number in the answer with the data.</p>}
      </section>
      <section className="lab7-card"><span className="eyebrow">RUN HISTORY</span><h2>Compare runs</h2>
        {runs.length ? <div className="lab9-table-wrap lab15-history lab16-history"><table>
          <thead><tr><th>Run</th><th>Question</th><th>Data</th><th>Figures</th><th>Outcome</th></tr></thead>
          <tbody>{runs.map((run, index) => { const verdict = classifyWeatherRun(run); const grounding = checkGrounding(run.answer, reportsOf(run)); return <tr key={run.id} className={run.id === selected?.id ? 'selected' : ''} onClick={() => { setSelectedId(run.id); setItems(null); }}>
            <th><button type="button" className="lab15-link" onClick={() => { setSelectedId(run.id); setItems(null); }} aria-pressed={run.id === selected?.id}>#{index + 1}</button></th>
            <td className="lab16-q">{run.prompt}</td><td><code>{run.toolOffered ? `${run.source}${run.fault !== 'none' ? ` · ${run.fault}` : ''}` : 'no tool'}</code></td>
            <td>{grounding.grounded.length}/{grounding.figures}</td><td><span className={'lab16-tone lab19-tone ' + verdict.tone}>{verdict.title}</span></td></tr>; })}</tbody>
        </table></div> : <p className="lab8-note">No runs yet. Ask the same question with the tool and without it, then with <em>Shape changed</em>, and compare the answers.</p>}
      </section>
    </div>

    <section className="lab3-guide lab16-guide"><h2>Read the evidence</h2><div><article><strong>Narrow</strong><p>The model picks a city, days, and units. Code picks the host, path, method, and fields.</p></article><article><strong>Guarded</strong><p>HTTPS, GET, an allowlisted host and path, no redirects, one deadline, a size cap.</p></article><article><strong>Validated both ways</strong><p>The arguments going out, and the JSON coming back. Shape drift is caught, not passed on.</p></article><article><strong>Grounded</strong><p>A small result with its source and time, and an answer whose numbers match it.</p></article></div><p className="lab3-guide-note">A read-only tool can still leak, hang, or mislead. The wrapper is where you decide what the agent can reach, and what it is allowed to believe.</p></section>

    <details className="code-lessons lab5-code" onToggle={(event) => { if (!event.currentTarget.open) stopSpeech(); }}><summary className="code-lessons-toggle"><span className="code-lessons-heading"><span className="code-lessons-kicker">UNDER THE HOOD · LAB 19</span><span className="code-lessons-title" role="heading" aria-level={2}>The code that connects a read-only service</span><span className="code-lessons-hint">Six explained snippets with Viva voice narration.</span></span><span className="code-lessons-toggle-action" aria-hidden="true"><span className="show-label">View code</span><span className="hide-label">Hide code</span><span className="chevron-shell"><svg className="chevron" viewBox="0 0 18 18" fill="none"><path d="m4 7 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></span></summary><div className="code-lessons-body"><p className="code-lessons-intro">Declare a narrow tool, build and guard the request in code, fetch on the server with one deadline, validate the response, return a small sourced result, and check that the answer is grounded in it. Viva voice reads each explanation through browser speech synthesis; it does not call an audio API.</p><button type="button" className={'viva-button lab11-read-all' + (speaking?.mode === 'all' ? ' is-speaking' : '')} onClick={readAll} disabled={!speechAvailable} aria-pressed={speaking?.mode === 'all'}>{speaking?.mode === 'all' ? 'Stop reading all' : 'Viva voice · Read all six'}</button>{!speechAvailable ? <p className="lab8-note">This browser does not support speech synthesis.</p> : null}<div className="code-lessons-grid">{lessons.map((lesson) => <article className="code-lesson" key={lesson.number}><div className="code-lesson-header"><span className="code-lesson-number">{lesson.number}</span><div><h3>{lesson.title}</h3><span>{lesson.file}</span></div></div><pre><code>{codeTokens(Prism.tokenize(lesson.code, Prism.languages.typescript || Prism.languages.javascript))}</code></pre><p>{lesson.explanation}</p><button type="button" className={'viva-button' + (speaking?.lesson === lesson.number ? ' is-speaking' : '')} onClick={() => readLesson(lesson)} disabled={!speechAvailable} aria-pressed={speaking?.lesson === lesson.number} aria-label={speaking?.lesson === lesson.number ? `Stop reading ${lesson.title}` : `Read ${lesson.title} explanation aloud`}>{speaking?.lesson === lesson.number
      ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
      : <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M17 9a5 5 0 0 1 0 6M19.5 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}<span>{speaking?.lesson === lesson.number ? 'Stop reading' : 'Viva voice · Read aloud'}</span></button></article>)}</div></div></details>

    <section className="student-challenge"><strong>Try it yourself</strong><p>Probe <em>Madrid · 3 days</em> against live Open-Meteo and show the two requests, the raw responses, and how much smaller the tool output is. Call it again and show the cache hit. Run the test suite on the server and show <em>{serviceTests.length}/{serviceTests.length} passed</em>. Then ask <em>Do I need an umbrella in London over the next 3 days?</em> live: show the grounding check with every figure found in the data, and the source line in the answer. Ask it again with <em>No tool</em> and with <em>Shape changed</em>, and explain the difference between the three answers.</p></section>
    <footer><span>{health?.configured ? '● API KEY CONFIGURED' : '○ SET UP YOUR API KEY IN .ENV'}</span><span>MODEL: {health?.model || 'LOADING…'}</span><a href="https://open-meteo.com/en/docs" target="_blank" rel="noreferrer">OPEN-METEO DOCS ↗</a><a href="https://developers.openai.com/api/docs/guides/agents-api/tools/functions" target="_blank" rel="noreferrer">OPENAI DOCS ↗</a></footer>
  </div>;
}
