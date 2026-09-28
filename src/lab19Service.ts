// Lab 19: connect a read-only service. A real external API (Open-Meteo) sits behind one narrow, typed function.
// Pure functions and small async helpers only, so the server, the live run, the probe, and the test page share them.
// The network call itself is injected as a Fetcher: the server passes a real HTTP fetcher, the tests pass recorded data.
import { parseArguments, type FunctionToolDeclaration, type ToolCall, type TurnStatus } from './lab16Tool.ts';
import { toolResultEvent, type ToolResultEvent } from './lab17Action.ts';
import { checkSchema, ToolTimeoutError, withTimeout, type Issue } from './lab18Validate.ts';

export { toolResultEvent, type ToolResultEvent, type Issue };

// ---- The declaration: what the model may choose ----

const unitChoices = ['celsius', 'fahrenheit'] as const;
export type Units = (typeof unitChoices)[number];
export type WeatherArgs = { city: string; days: number; units: Units };

// Three small arguments. The model never sees or chooses a URL, a host, a method, or which fields come back.
export const weatherTool: FunctionToolDeclaration = {
  type: 'function',
  name: 'get_weather_forecast',
  description:
    'Get the current weather and a daily forecast (1 to 7 days, starting today) for a city, from the live Open-Meteo service. ' +
    'Use it whenever the user asks about the weather, temperature, rain, or wind somewhere today or in the next few days. ' +
    'It is read-only. Do not use it for past weather, climate averages, or dates more than 7 days ahead.',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', minLength: 2, maxLength: 80, description: 'A place name, optionally followed by a comma and its country or region, such as "Madrid" or "Paris, Texas". Not a URL or coordinates.' },
      days: { type: 'integer', minimum: 1, maximum: 7, description: 'How many days of forecast to return, starting today. 1 means today only.' },
      units: { type: 'string', enum: [...unitChoices], description: 'Temperature units. Use "celsius" unless the user asks for Fahrenheit.' },
    },
    required: ['city', 'days', 'units'],
    additionalProperties: false,
  },
};

// ---- The service: everything the code fixes ----

export const service = {
  name: 'Open-Meteo',
  site: 'https://open-meteo.com',
  attribution: 'Weather data by Open-Meteo.com (CC BY 4.0)',
  geocodeBase: 'https://geocoding-api.open-meteo.com/v1/search',
  forecastBase: 'https://api.open-meteo.com/v1/forecast',
  // host → the one path this wrapper may call on it
  allowed: { 'geocoding-api.open-meteo.com': '/v1/search', 'api.open-meteo.com': '/v1/forecast' } as Record<string, string>,
  maxBytes: 200_000,
  cacheTtlMs: 10 * 60_000,
};

export type Guard = { ok: true; reason: null } | { ok: false; reason: string };
// Defence in depth. The URLs are built by code, but every request is still checked before it leaves the server.
export function checkRequest(url: string, method: string): Guard {
  const block = (reason: string): Guard => ({ ok: false, reason });
  let target: URL;
  try { target = new URL(url); } catch { return block('is not a valid absolute URL.'); }
  if (method.trim().toUpperCase() !== 'GET') return block(`method ${method.trim().toUpperCase() || '(empty)'} is not allowed. This wrapper is read-only: GET only.`);
  if (target.protocol !== 'https:') return block(`protocol ${target.protocol} is not allowed. HTTPS only.`);
  if (target.username || target.password) return block('credentials inside the URL are not allowed.');
  if (target.port) return block(`port ${target.port} is not allowed.`);
  const path = service.allowed[target.hostname];
  if (!path) return block(`host ${target.hostname} is not on the allowlist (${Object.keys(service.allowed).join(', ')}).`);
  if (target.pathname !== path) return block(`path ${target.pathname} is not allowed on ${target.hostname}. Only ${path}.`);
  return { ok: true, reason: null };
}

const dailyFields = ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'precipitation_probability_max', 'wind_speed_10m_max'] as const;
const currentFields = ['temperature_2m', 'weather_code', 'wind_speed_10m'] as const;

export function geocodeUrl(name: string): string {
  const url = new URL(service.geocodeBase);
  url.search = new URLSearchParams({ name, count: '10', language: 'en', format: 'json' }).toString();
  return url.toString();
}
export function forecastUrl(place: Pick<Place, 'latitude' | 'longitude'>, days: number, units: Units): string {
  const url = new URL(service.forecastBase);
  url.search = new URLSearchParams({
    latitude: String(place.latitude), longitude: String(place.longitude),
    current: currentFields.join(','), daily: dailyFields.join(','),
    timezone: 'auto', forecast_days: String(days), temperature_unit: units, wind_speed_unit: 'kmh', precipitation_unit: 'mm',
  }).toString();
  return url.toString();
}

// ---- Validation of the arguments: unknown → WeatherArgs ----

export type Validation = { ok: true; value: WeatherArgs; issues: [] } | { ok: false; value: null; issues: Issue[] };
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
// eslint-disable-next-line no-control-regex
const controlCharacters = /[\u0000-\u001f\u007f]/;
// A place name never contains a scheme, a slash, or an @, and is not a pair of coordinates.
const notAPlace = /(?:^|\s)[a-z][a-z0-9+.-]*:\/\/|[/\\@]|^\s*-?\d+(?:\.\d+)?\s*[,;\s]\s*-?\d+(?:\.\d+)?\s*$/i;

export function validateWeatherArgs(raw: unknown): Validation {
  const parsed = parseArguments(raw);
  if (!parsed.value) return { ok: false, value: null, issues: [{ layer: 'parse', path: '(arguments)', code: 'parse', message: typeof raw === 'string' ? 'are not a valid JSON object.' : 'must be a JSON object.' }] };
  const shape = checkSchema(parsed.value, weatherTool.parameters);
  if (shape.length) return { ok: false, value: null, issues: shape };
  const args: WeatherArgs = { city: parsed.value.city as string, days: parsed.value.days as number, units: parsed.value.units as Units };
  const issues: Issue[] = [];
  if (controlCharacters.test(args.city)) issues.push({ layer: 'meaning', path: '/city', code: 'control', message: 'contains control characters. Send plain text only.' });
  else if (notAPlace.test(args.city)) issues.push({ layer: 'meaning', path: '/city', code: 'place', message: 'must be a place name, not a URL, a path, an email address, or coordinates.' });
  else if (args.city.replace(/[\s,]/g, '').length < 2) issues.push({ layer: 'meaning', path: '/city', code: 'blank', message: 'is blank once spaces and commas are removed.' });
  if (issues.length) return { ok: false, value: null, issues };
  return { ok: true, value: { ...args, city: args.city.trim().replace(/\s+/g, ' ') }, issues: [] };
}

const where = (item: Issue) => (item.path === '(arguments)' ? 'arguments' : item.path.slice(1).replace(/\//g, '.'));
export function describeIssues(issues: Issue[], repeated = false): string {
  return [
    `Invalid arguments for ${weatherTool.name}:`,
    ...issues.map((item) => `- ${where(item)} ${item.message}`),
    repeated ? 'You already sent these exact arguments and they were rejected. Change them before calling again.' : 'Fix these and call the tool again.',
  ].join('\n');
}

// ---- Validation of the response: the service's JSON is unknown too ----

export type Place = { name: string; region: string | null; country: string | null; countryCode: string | null; latitude: number; longitude: number; timezone: string | null };
export type DailyRow = { date: string; code: number; max: number; min: number; precipitation: number | null; precipitationProbability: number | null; windMax: number | null };
export type Forecast = {
  timezone: string | null;
  units: { temperature: string; precipitation: string; wind: string };
  current: { time: string; temperature: number; code: number; windSpeed: number | null } | null;
  days: DailyRow[];
};
export type Parsed<T> = { value: T | null; issues: string[] };

const num = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const optionalText = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);

export function parseGeocode(body: unknown): Parsed<Place[]> {
  if (!isObject(body)) return { value: null, issues: ['the body is not a JSON object.'] };
  // Open-Meteo leaves `results` out entirely when nothing matches. That is a valid, empty answer.
  if (body.results === undefined) return { value: [], issues: [] };
  if (!Array.isArray(body.results)) return { value: null, issues: ['results is not an array.'] };
  const issues: string[] = [];
  const places: Place[] = [];
  body.results.forEach((item: unknown, index) => {
    if (!isObject(item) || typeof item.name !== 'string' || !num(item.latitude) || !num(item.longitude)) { issues.push(`results[${index}] needs a name, latitude, and longitude.`); return; }
    if (Math.abs(item.latitude) > 90 || Math.abs(item.longitude) > 180) { issues.push(`results[${index}] has coordinates out of range.`); return; }
    places.push({ name: item.name, region: optionalText(item.admin1), country: optionalText(item.country), countryCode: optionalText(item.country_code), latitude: item.latitude, longitude: item.longitude, timezone: optionalText(item.timezone) });
  });
  return issues.length ? { value: null, issues } : { value: places, issues: [] };
}

export function parseForecast(body: unknown, expect: Pick<WeatherArgs, 'days' | 'units'>): Parsed<Forecast> {
  if (!isObject(body)) return { value: null, issues: ['the body is not a JSON object.'] };
  const issues: string[] = [];
  const daily = body.daily;
  const dailyUnits = isObject(body.daily_units) ? body.daily_units : {};
  if (!isObject(daily)) return { value: null, issues: ['daily is missing.'] };
  const time = daily.time;
  if (!Array.isArray(time) || !time.every((item) => typeof item === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item))) issues.push('daily.time must be an array of YYYY-MM-DD dates.');
  else if (time.length !== expect.days) issues.push(`daily.time has ${time.length} days; ${expect.days} were requested.`);
  const length = Array.isArray(time) ? time.length : 0;
  const column = (field: (typeof dailyFields)[number], nullable: boolean): Array<number | null> => {
    const values = daily[field];
    if (!Array.isArray(values)) { issues.push(`daily.${field} is missing.`); return []; }
    if (values.length !== length) issues.push(`daily.${field} has ${values.length} values for ${length} days.`);
    if (!values.every((item) => num(item) || (nullable && item === null))) issues.push(`daily.${field} must contain only numbers${nullable ? ' or null' : ''}.`);
    return values as Array<number | null>;
  };
  const codes = column('weather_code', false), max = column('temperature_2m_max', false), min = column('temperature_2m_min', false);
  const precipitation = column('precipitation_sum', true), probability = column('precipitation_probability_max', true), wind = column('wind_speed_10m_max', true);
  // Meaning: the service must answer in the units that were asked for.
  const temperatureUnit = dailyUnits.temperature_2m_max;
  const wanted = expect.units === 'fahrenheit' ? '°F' : '°C';
  if (temperatureUnit !== wanted) issues.push(`daily_units.temperature_2m_max is ${JSON.stringify(temperatureUnit)}; ${wanted} was requested.`);
  let current: Forecast['current'] = null;
  if (body.current !== undefined) {
    const now = body.current;
    if (!isObject(now) || typeof now.time !== 'string' || !num(now.temperature_2m) || !num(now.weather_code)) issues.push('current needs time, temperature_2m, and weather_code.');
    else current = { time: now.time, temperature: now.temperature_2m, code: now.weather_code, windSpeed: num(now.wind_speed_10m) ? now.wind_speed_10m : null };
  }
  if (issues.length) return { value: null, issues };
  return {
    value: {
      timezone: optionalText(body.timezone),
      units: { temperature: wanted, precipitation: optionalText(dailyUnits.precipitation_sum) ?? 'mm', wind: optionalText(dailyUnits.wind_speed_10m_max) ?? 'km/h' },
      current,
      days: (time as string[]).map((date, index) => ({
        date, code: codes[index] as number, max: max[index] as number, min: min[index] as number,
        precipitation: precipitation[index], precipitationProbability: probability[index], windMax: wind[index],
      })),
    },
    issues: [],
  };
}

// WMO weather interpretation codes, as Open-Meteo documents them.
const conditions: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle', 56: 'Light freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Light freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Light rain showers', 81: 'Rain showers', 82: 'Violent rain showers',
  85: 'Light snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm with light hail', 99: 'Thunderstorm with hail',
};
export const describeCode = (code: number) => conditions[code] ?? `Unknown conditions (code ${code})`;

// ---- Choosing the place ----

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export function splitCity(city: string): { name: string; qualifier: string } {
  const [name, ...rest] = city.split(',');
  return { name: name.trim(), qualifier: rest.join(',').trim() };
}
// Without a qualifier, trust the service's ranking (Open-Meteo sorts by population): "Washington" should mean
// Washington D.C., not the first place spelled exactly "Washington". With a qualifier, find the country or region
// the user named. If nothing matches it, there is no safe choice.
export function pickPlace(places: Place[], qualifier: string): Place | null {
  if (!qualifier) return places[0] ?? null;
  const wanted = fold(qualifier);
  return places.find((place) => [place.country, place.countryCode, place.region].some((field) => field && fold(field) === wanted))
    ?? places.find((place) => [place.country, place.region].some((field) => field && fold(field).includes(wanted)))
    ?? null;
}
const placeLabel = (place: Place) => [place.name, place.region !== place.name ? place.region : null, place.country].filter(Boolean).join(', ');

// ---- The narrow result the agent receives ----

export type WeatherReport = {
  source: string;
  live: boolean;
  fetched_at: string;
  requested: string; // the city the agent asked for
  match_note: string | null; // set when the resolved place is not simply the name that was asked for
  place: { name: string; region: string | null; country: string | null; latitude: number; longitude: number; timezone: string | null };
  units: { temperature: string; precipitation: string; wind: string };
  current: { time: string; temperature: number; conditions: string; wind_speed: number | null } | null;
  days: Array<{ date: string; conditions: string; max: number; min: number; precipitation_probability: number | null; precipitation: number | null; wind_max: number | null }>;
};

const round = (value: number, places = 1) => Math.round(value * 10 ** places) / 10 ** places;
// Only the fields the agent needs, labelled in plain words, with where and when the data came from, and which
// place was actually used. "Wakanda" resolves to Wakanda Park, Wisconsin; the agent must be able to say so.
export function narrow(place: Place, forecast: Forecast, live: boolean, fetchedAt: string, requested: string): WeatherReport {
  const differs = fold(place.name) !== fold(splitCity(requested).name);
  return {
    source: live ? `${service.attribution}, fetched live` : `Recorded sample in the ${service.name} format. NOT live data.`,
    live,
    fetched_at: fetchedAt,
    requested,
    match_note: differs ? `Asked for "${requested}"; the closest match is "${placeLabel(place)}". Tell the user which place this is.` : null,
    place: { name: place.name, region: place.region, country: place.country, latitude: round(place.latitude, 2), longitude: round(place.longitude, 2), timezone: forecast.timezone ?? place.timezone },
    units: forecast.units,
    current: forecast.current && { time: forecast.current.time, temperature: forecast.current.temperature, conditions: describeCode(forecast.current.code), wind_speed: forecast.current.windSpeed },
    days: forecast.days.map((day) => ({ date: day.date, conditions: describeCode(day.code), max: day.max, min: day.min, precipitation_probability: day.precipitationProbability, precipitation: day.precipitation, wind_max: day.windMax })),
  };
}

// ---- The network, injected ----

export type Upstream = { status: number; body: unknown; bytes: number };
export type Fetcher = (url: string, signal: AbortSignal) => Promise<Upstream>;
export type RequestOutcome = 'ok' | 'blocked' | 'timeout' | 'network' | 'status' | 'shape';
export type UpstreamRequest = { url: string; host: string; path: string; status: number | null; durationMs: number; bytes: number; cached: boolean; outcome: RequestOutcome; raw: unknown };

export class RequestBlockedError extends Error { constructor(message: string) { super(message); this.name = 'RequestBlockedError'; } }
export class NetworkError extends Error { constructor(message: string) { super(message); this.name = 'NetworkError'; } }
export class UpstreamStatusError extends Error {
  constructor(readonly status: number, readonly reason: string) { super(`HTTP ${status}: ${reason}`); this.name = 'UpstreamStatusError'; }
}
export class UpstreamShapeError extends Error {
  constructor(readonly issues: string[]) { super(issues.join(' ')); this.name = 'UpstreamShapeError'; }
}
export class PlaceNotFoundError extends Error {
  constructor(message: string, readonly candidates: string[]) { super(message); this.name = 'PlaceNotFoundError'; }
}

// A small time-to-live cache for validated responses. Weather does not change second to second, and every
// cache hit is one request the upstream service does not have to serve.
export class ResponseCache {
  private entries = new Map<string, { at: number; body: unknown; bytes: number }>();
  constructor(readonly ttlMs: number, private readonly now: () => number = Date.now) {}
  get(url: string) {
    const entry = this.entries.get(url);
    if (!entry) return null;
    if (this.now() - entry.at > this.ttlMs) { this.entries.delete(url); return null; }
    return entry;
  }
  set(url: string, body: unknown, bytes: number) {
    this.entries.set(url, { at: this.now(), body, bytes });
    if (this.entries.size > 200) this.entries.delete(this.entries.keys().next().value as string);
  }
  clear() { this.entries.clear(); }
  get size() { return this.entries.size; }
}

type Context = {
  fetcher: Fetcher;
  cache: ResponseCache | null;
  requests: UpstreamRequest[];
  pending: { url: string; started: number } | null; // the request in flight, so a timeout can record it
  onRequest?: (request: UpstreamRequest) => void;
};
const since = (started: number) => Math.round(performance.now() - started);
const reasonOf = (body: unknown) => (isObject(body) && typeof body.reason === 'string' ? body.reason : typeof body === 'string' ? body.slice(0, 200) : 'no reason given');

function record(ctx: Context, url: string, entry: Omit<UpstreamRequest, 'url' | 'host' | 'path'>) {
  const target = new URL(url);
  const request: UpstreamRequest = { url, host: target.hostname, path: target.pathname, ...entry };
  ctx.requests.push(request);
  ctx.onRequest?.(request);
}

// One GET: guard, cache, fetch, status, size, shape. Each failure throws its own error type, so runWeatherTool can
// tell the agent the right thing.
async function getJson<T>(url: string, ctx: Context, signal: AbortSignal, parse: (body: unknown) => Parsed<T>): Promise<T> {
  if (signal.aborted) throw signal.reason;
  const guard = checkRequest(url, 'GET');
  if (!guard.ok) { record(ctx, url, { status: null, durationMs: 0, bytes: 0, cached: false, outcome: 'blocked', raw: null }); throw new RequestBlockedError(`${url} ${guard.reason}`); }
  const hit = ctx.cache?.get(url);
  if (hit) {
    const parsed = parse(hit.body);
    if (parsed.value !== null) { record(ctx, url, { status: 200, durationMs: 0, bytes: hit.bytes, cached: true, outcome: 'ok', raw: hit.body }); return parsed.value; }
  }
  const pending = { url, started: performance.now() };
  ctx.pending = pending;
  let upstream: Upstream;
  try {
    upstream = await ctx.fetcher(url, signal);
  } catch (caught) {
    if (signal.aborted) throw signal.reason; // the deadline fired; runWeatherTool records the request
    ctx.pending = null;
    record(ctx, url, { status: null, durationMs: since(pending.started), bytes: 0, cached: false, outcome: 'network', raw: null });
    throw new NetworkError(caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught));
  }
  if (ctx.pending !== pending) throw signal.reason; // answered after the deadline: too late to use
  ctx.pending = null;
  const base = { status: upstream.status, durationMs: since(pending.started), bytes: upstream.bytes, cached: false, raw: upstream.body };
  if (upstream.status < 200 || upstream.status >= 300) { record(ctx, url, { ...base, outcome: 'status' }); throw new UpstreamStatusError(upstream.status, reasonOf(upstream.body)); }
  if (upstream.bytes > service.maxBytes) { record(ctx, url, { ...base, raw: null, outcome: 'shape' }); throw new UpstreamShapeError([`the response is ${upstream.bytes} bytes, over the ${service.maxBytes}-byte limit.`]); }
  const parsed = parse(upstream.body);
  if (parsed.value === null) { record(ctx, url, { ...base, outcome: 'shape' }); throw new UpstreamShapeError(parsed.issues.map((issue) => `${new URL(url).pathname}: ${issue}`)); }
  record(ctx, url, { ...base, outcome: 'ok' });
  ctx.cache?.set(url, upstream.body, upstream.bytes);
  return parsed.value;
}

// The whole service call: find the place, then fetch its forecast, then narrow it.
async function weatherService(args: WeatherArgs, ctx: Context, signal: AbortSignal, live: boolean, now: () => Date): Promise<WeatherReport> {
  const { name, qualifier } = splitCity(args.city);
  const places = await getJson(geocodeUrl(name), ctx, signal, parseGeocode);
  const place = pickPlace(places, qualifier);
  if (!place) {
    const candidates = places.filter((item) => fold(item.name) === fold(name)).slice(0, 4).map(placeLabel);
    throw new PlaceNotFoundError(
      candidates.length
        ? `No place named "${name}" matches "${qualifier}". The service knows ${candidates.map((item) => `"${item}"`).join(', ')}. Ask the user which one they mean. Do not guess the weather.`
        : `No place named "${args.city}" was found. Ask the user to check the spelling or to name a larger city nearby. Do not guess the weather.`,
      candidates,
    );
  }
  const forecast = await getJson(forecastUrl(place, args.days, args.units), ctx, signal, (body) => parseForecast(body, args));
  return narrow(place, forecast, live, now().toISOString(), args.city);
}

// ---- Faults you can switch on, and timings ----

export type Source = 'live' | 'recorded';
export type Fault = 'none' | 'slow' | 'down' | 'http_error' | 'drift';
export const faults: Array<{ id: Fault; label: string; hint: string }> = [
  { id: 'none', label: 'Works normally', hint: 'Requests go through unchanged.' },
  { id: 'slow', label: 'Too slow', hint: 'Every request hangs longer than the deadline. The server aborts it.' },
  { id: 'down', label: 'Unreachable', hint: 'The connection fails before any response, like a DNS or network outage.' },
  { id: 'http_error', label: 'HTTP 503', hint: 'The service answers, but with an error status.' },
  { id: 'drift', label: 'Shape changed', hint: 'The forecast arrives with a renamed field, as if the API changed without warning.' },
];

export type Timing = { timeoutMs: number; latencyMs: number; slowMs: number };
// One deadline for the whole tool call (both requests), not one per request.
export const liveTiming: Timing = { timeoutMs: 4000, latencyMs: 150, slowMs: 10_000 };
export const testTiming: Timing = { timeoutMs: 300, latencyMs: 10, slowMs: 1200 };

export const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(signal.reason);
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});

// Wrap any fetcher with a fault. The wrapper code under test is exactly the same with or without it.
export function withFault(fetcher: Fetcher, fault: Fault, timing: Timing): Fetcher {
  if (fault === 'none') return fetcher;
  return async (url, signal) => {
    if (fault === 'slow') { await wait(timing.slowMs, signal); return fetcher(url, signal); }
    if (fault === 'down') throw new TypeError(`fetch failed: getaddrinfo ENOTFOUND ${new URL(url).hostname}`);
    if (fault === 'http_error') { const body = { error: true, reason: 'Service temporarily unavailable (simulated).' }; return { status: 503, body, bytes: JSON.stringify(body).length }; }
    const upstream = await fetcher(url, signal);
    if (new URL(url).pathname !== '/v1/forecast' || !isObject(upstream.body) || !isObject(upstream.body.daily)) return upstream;
    // Shape drift: the API renames a field. Nothing crashes; validation has to notice.
    const { temperature_2m_max: renamed, ...daily } = upstream.body.daily;
    return { ...upstream, body: { ...upstream.body, daily: { ...daily, temperature_max: renamed } } };
  };
}

// ---- Recorded data: the same JSON shapes as Open-Meteo, with no network ----

const recordedPlaces = [
  { id: 3117735, name: 'Madrid', latitude: 40.4165, longitude: -3.70256, elevation: 665, feature_code: 'PPLC', country_code: 'ES', timezone: 'Europe/Madrid', population: 3255944, country: 'Spain', admin1: 'Madrid' },
  { id: 3675504, name: 'Madrid', latitude: 4.73245, longitude: -74.26419, elevation: 2554, feature_code: 'PPLA2', country_code: 'CO', timezone: 'America/Bogota', population: 62436, country: 'Colombia', admin1: 'Cundinamarca' },
  { id: 2643743, name: 'London', latitude: 51.50853, longitude: -0.12574, elevation: 25, feature_code: 'PPLC', country_code: 'GB', timezone: 'Europe/London', population: 8961989, country: 'United Kingdom', admin1: 'England' },
  { id: 2988507, name: 'Paris', latitude: 48.85341, longitude: 2.3488, elevation: 42, feature_code: 'PPLC', country_code: 'FR', timezone: 'Europe/Paris', population: 2138551, country: 'France', admin1: 'Île-de-France Region' },
  { id: 4717560, name: 'Paris', latitude: 33.66094, longitude: -95.55551, elevation: 184, feature_code: 'PPLA2', country_code: 'US', timezone: 'America/Chicago', population: 24782, country: 'United States', admin1: 'Texas' },
  { id: 5128581, name: 'New York', latitude: 40.71427, longitude: -74.00597, elevation: 10, feature_code: 'PPL', country_code: 'US', timezone: 'America/New_York', population: 8804190, country: 'United States', admin1: 'New York' },
  { id: 1850147, name: 'Tokyo', latitude: 35.6895, longitude: 139.69171, elevation: 44, feature_code: 'PPLC', country_code: 'JP', timezone: 'Asia/Tokyo', population: 9733276, country: 'Japan', admin1: 'Tokyo' },
];
export const recordedCities = [...new Set(recordedPlaces.map((place) => place.name))];

// A tiny seeded random generator, so a recorded forecast is the same for the same place and day.
function seeded(text: string) {
  let state = [...text].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619), 2166136261) >>> 0;
  return () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

function recordedForecast(url: URL, today: string): Upstream {
  const reply = (status: number, body: unknown): Upstream => ({ status, body, bytes: JSON.stringify(body).length });
  const latitude = Number(url.searchParams.get('latitude')), longitude = Number(url.searchParams.get('longitude'));
  const days = Number(url.searchParams.get('forecast_days') ?? 7);
  const fahrenheit = url.searchParams.get('temperature_unit') === 'fahrenheit';
  if (!Number.isInteger(days) || days < 0 || days > 16) return reply(400, { reason: `Forecast days is invalid. Allowed range 0 to 16. Given ${url.searchParams.get('forecast_days')}.`, error: true });
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return reply(400, { reason: 'Latitude and longitude must be numbers.', error: true });
  const place = recordedPlaces.find((item) => Math.abs(item.latitude - latitude) < 0.01 && Math.abs(item.longitude - longitude) < 0.01);
  const temperature = (celsius: number) => round(fahrenheit ? celsius * 9 / 5 + 32 : celsius);
  const base = 34 - Math.abs(latitude) * 0.3;
  const rows = Array.from({ length: days }, (_, index) => {
    const random = seeded(`${latitude},${longitude},${addDays(today, index)}`);
    const max = base + random() * 6 - 3, min = max - 7 - random() * 4;
    const code = [0, 1, 2, 3, 3, 61, 63, 80, 2, 1][Math.floor(random() * 10)];
    const wet = code >= 61;
    return { date: addDays(today, index), code, max, min, probability: Math.round(wet ? 45 + random() * 45 : random() * 20), sum: wet ? round(0.4 + random() * 8) : 0, wind: round(6 + random() * 22) };
  });
  const unit = fahrenheit ? '°F' : '°C';
  return reply(200, {
    latitude: round(latitude, 4), longitude: round(longitude, 4), generationtime_ms: 0.08, utc_offset_seconds: 0,
    timezone: place?.timezone ?? 'GMT', timezone_abbreviation: 'GMT', elevation: place?.elevation ?? 0,
    current_units: { time: 'iso8601', interval: 'seconds', temperature_2m: unit, weather_code: 'wmo code', wind_speed_10m: 'km/h' },
    current: rows[0] ? { time: `${today}T12:00`, interval: 900, temperature_2m: temperature(rows[0].min + (rows[0].max - rows[0].min) * 0.7), weather_code: rows[0].code, wind_speed_10m: round(rows[0].wind * 0.6) } : undefined,
    daily_units: { time: 'iso8601', weather_code: 'wmo code', temperature_2m_max: unit, temperature_2m_min: unit, precipitation_sum: 'mm', precipitation_probability_max: '%', wind_speed_10m_max: 'km/h' },
    daily: {
      time: rows.map((row) => row.date), weather_code: rows.map((row) => row.code),
      temperature_2m_max: rows.map((row) => temperature(row.max)), temperature_2m_min: rows.map((row) => temperature(row.min)),
      precipitation_sum: rows.map((row) => row.sum), precipitation_probability_max: rows.map((row) => row.probability), wind_speed_10m_max: rows.map((row) => row.wind),
    },
  });
}

// Answers the two Open-Meteo endpoints from recorded data, with a small delay that honours the abort signal.
export function recordedFetcher(latencyMs: number, today: () => string = () => new Date().toISOString().slice(0, 10)): Fetcher {
  return async (url, signal) => {
    await wait(latencyMs, signal);
    const target = new URL(url);
    if (target.pathname === '/v1/search') {
      const query = fold(target.searchParams.get('name') ?? '');
      const results = query.length < 2 ? [] : recordedPlaces.filter((place) => fold(place.name).startsWith(query));
      const body = results.length ? { results, generationtime_ms: 0.4 } : { generationtime_ms: 0.2 };
      return { status: 200, body, bytes: JSON.stringify(body).length };
    }
    if (target.pathname === '/v1/forecast') return recordedForecast(target, today());
    return { status: 404, body: { error: true, reason: 'Not found' }, bytes: 36 };
  };
}

// ---- One call, end to end ----

export type Stage = 'name' | 'input' | 'request' | 'network' | 'status' | 'shape' | 'found' | 'ok';
export const stages: Array<{ id: Stage; label: string; detail: string }> = [
  { id: 'name', label: 'Name', detail: 'a function we run' },
  { id: 'input', label: 'Input', detail: 'parse · schema · meaning' },
  { id: 'request', label: 'Request', detail: 'allowlisted GET' },
  { id: 'network', label: 'Network', detail: 'reached in time' },
  { id: 'status', label: 'Status', detail: 'HTTP 2xx' },
  { id: 'shape', label: 'Response', detail: 'validated shape' },
  { id: 'found', label: 'Place', detail: 'one clear match' },
  { id: 'ok', label: 'Result', detail: 'narrow + sourced' },
];

export type ServiceOutcome = {
  stage: Stage;
  success: boolean;
  output: string | null; // sent to the agent: the narrowed report as JSON
  error: string | null; // sent to the agent: short, actionable, no internals
  retryable: boolean;
  issues: Issue[];
  args: WeatherArgs | null;
  internal: string | null; // server log only
  durationMs: number;
  requests: UpstreamRequest[]; // every upstream request this call made, in order
  report: WeatherReport | null;
};
export type RunOptions = { fetcher: Fetcher; timing: Timing; live: boolean; cache?: ResponseCache | null; repeated?: boolean; now?: () => Date; onRequest?: (request: UpstreamRequest) => void };

const errorRef = () => `err_${Math.random().toString(36).slice(2, 8)}`;
const giveUp = 'tell the user live weather is unavailable right now, and do not estimate it.';

export async function runWeatherTool(call: Pick<ToolCall, 'name' | 'arguments'>, options: RunOptions): Promise<ServiceOutcome> {
  const started = performance.now();
  const ctx: Context = { fetcher: options.fetcher, cache: options.cache ?? null, requests: [], pending: null, onRequest: options.onRequest };
  const elapsed = () => Math.round((performance.now() - started) * 10) / 10;
  const refuse = (stage: Stage, error: string, retryable: boolean, extra: Partial<ServiceOutcome> = {}): ServiceOutcome =>
    ({ stage, success: false, output: null, error, retryable, issues: [], args: null, internal: null, durationMs: elapsed(), requests: ctx.requests, report: null, ...extra });

  if (call.name !== weatherTool.name) return refuse('name', `Unknown function "${call.name}". This server only runs ${weatherTool.name}, which is read-only.`, false);
  const checked = validateWeatherArgs(call.arguments);
  if (!checked.ok) return refuse('input', describeIssues(checked.issues, options.repeated), !options.repeated, { issues: checked.issues });
  const args = checked.value;
  try {
    const report = await withTimeout((signal) => weatherService(args, ctx, signal, options.live, options.now ?? (() => new Date())), options.timing.timeoutMs);
    return { stage: 'ok', success: true, output: JSON.stringify(report), error: null, retryable: false, issues: [], args, internal: null, durationMs: elapsed(), requests: ctx.requests, report };
  } catch (caught) {
    const fail = (stage: Stage, error: string, retryable: boolean, internal: string | null) => refuse(stage, error, retryable, { args, internal });
    const tool = weatherTool.name;
    if (caught instanceof ToolTimeoutError) {
      if (ctx.pending) { record(ctx, ctx.pending.url, { status: null, durationMs: since(ctx.pending.started), bytes: 0, cached: false, outcome: 'timeout', raw: null }); ctx.pending = null; }
      return fail('network', `${tool}: the weather service did not answer within ${caught.ms} ms. You may try once more; if it times out again, ${giveUp}`, true, `${caught.name}: ${caught.message} The request was aborted.`);
    }
    if (caught instanceof NetworkError) return fail('network', `${tool} could not reach the weather service. Try the same call once more; if it fails again, ${giveUp}`, true, `NetworkError: ${caught.message}`);
    if (caught instanceof PlaceNotFoundError) return fail('found', caught.message, false, null);
    if (caught instanceof UpstreamStatusError && (caught.status >= 500 || caught.status === 429)) {
      return fail('status', `The weather service answered HTTP ${caught.status} (temporarily unavailable). Try once more; if it fails again, ${giveUp}`, true, `${caught.name}: ${caught.message}`);
    }
    // Everything else means this wrapper is wrong, or the service changed. Retrying the same call cannot help.
    const ref = errorRef();
    const generic = (what: string) => `${tool} failed: ${what} (ref ${ref}). Do not retry; ${giveUp}`;
    if (caught instanceof UpstreamStatusError) return fail('status', generic('the weather service rejected the request this server built'), false, `[${ref}] ${caught.name}: ${caught.message}`);
    if (caught instanceof RequestBlockedError) return fail('request', generic('an internal error'), false, `[${ref}] ${caught.name}: ${caught.message}`);
    if (caught instanceof UpstreamShapeError) return fail('shape', generic('the weather service returned data in an unexpected format'), false, `[${ref}] ${caught.name}:\n- ${caught.issues.join('\n- ')}`);
    const detail = caught instanceof Error ? `${caught.name}: ${caught.message}${caught.stack ? `\n${caught.stack.split('\n').slice(1, 3).join('\n')}` : ''}` : String(caught);
    return fail('shape', generic('an internal error'), false, `[${ref}] ${detail}`);
  }
}

export function callSignature(call: Pick<ToolCall, 'name' | 'arguments'>): string {
  const parsed = parseArguments(call.arguments);
  const value = parsed.value ? Object.fromEntries(Object.entries(parsed.value).sort(([a], [b]) => a.localeCompare(b))) : call.arguments;
  return `${call.name}:${JSON.stringify(value)}`;
}
export const bytesOf = (value: unknown) => (value === null || value === undefined ? 0 : new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length);

// ---- Grounding: are the answer's figures in the data? ----

export type Grounding = { figures: number; grounded: string[]; unsupported: string[] };

// Every number the tool returned, plus the parts of its dates and times, so "28 September" or "14:00" count.
function allowedNumbers(reports: WeatherReport[]): number[] {
  const found: number[] = [];
  const walk = (value: unknown, key = '') => {
    if (typeof value === 'number') found.push(value);
    else if (typeof value === 'string' && /date|time|fetched_at/.test(key)) for (const part of value.match(/\d+/g) ?? []) found.push(Number(part));
    else if (Array.isArray(value)) value.forEach((item) => walk(item, key));
    else if (isObject(value)) for (const [name, item] of Object.entries(value)) walk(item, name);
  };
  for (const report of reports) { walk(report); found.push(report.days.length); }
  return found;
}

// ISO dates and timestamps ("2026-09-28T02:20:54.820Z") and clock times ("14:00") are provenance, not figures.
const timestamps = /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?|\b\d{1,2}:\d{2}\b/g;

// A heuristic, not a proof: each number in the answer should match a value in the tool output, allowing for rounding.
export function checkGrounding(answer: string, reports: WeatherReport[]): Grounding {
  const allowed = allowedNumbers(reports);
  const grounded: string[] = [], unsupported: string[] = [];
  // A minus sign counts only when it is not a range dash, as in "24-26".
  for (const text of answer.replace(timestamps, ' ').match(/(?<![\d.,])-?\d+(?:[.,]\d+)?/g) ?? []) {
    const value = Number(text.replace(',', '.'));
    (allowed.some((item) => Math.abs(item - value) <= 0.5) ? grounded : unsupported).push(text);
  }
  return { figures: grounded.length + unsupported.length, grounded, unsupported };
}

// ---- The run, as the browser sees it ----

export type CheckedResult = ServiceOutcome & { callId: string; turnId: string; name: string; round: number; attempt: number };
export type Moment = { at: number; kind: 'prompt' | 'call' | 'request' | 'reject' | 'result' | 'answer' | 'outcome'; label: string };

export type WeatherRun = {
  id: string;
  prompt: string;
  source: Source;
  fault: Fault;
  toolOffered: boolean;
  sessionId: string | null;
  turnId: string | null;
  turnStatus: TurnStatus;
  rounds: number;
  calls: ToolCall[];
  results: CheckedResult[];
  answer: string;
  events: string[];
  timeline: Moment[];
  error: string | null;
};

export const reportsOf = (run: Pick<WeatherRun, 'results'>) => run.results.flatMap((item) => (item.report ? [item.report] : []));

export type RunVerdict = { tone: 'grounded' | 'partial' | 'reported' | 'ungrounded' | 'direct' | 'failed' | 'unknown'; title: string; text: string };
export function classifyWeatherRun(run: WeatherRun): RunVerdict {
  const reports = reportsOf(run);
  const grounding = checkGrounding(run.answer, reports);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const where = reports.every((report) => report.live) ? 'live service data' : 'recorded sample data';
  if (run.turnStatus === 'cancelled') return { tone: 'failed', title: 'Cancelled', text: run.error ?? 'The turn was cancelled.' };
  if (run.turnStatus === 'failed' || (run.turnStatus !== 'completed' && run.error)) return { tone: 'failed', title: 'Failed', text: run.error ?? 'The turn failed.' };
  if (run.turnStatus !== 'completed') return { tone: 'unknown', title: 'No outcome', text: 'The stream ended before the turn had an outcome.' };
  if (!run.toolOffered) return { tone: 'ungrounded', title: 'No data source', text: grounding.figures ? `The agent had no tool, so none of its ${plural(grounding.figures, 'figure')} can come from the service. Compare with a run that offers the tool.` : 'The agent had no tool and gave no figures. Without a service, the honest answer is “I can’t check that”.' };
  if (!run.calls.length) return { tone: 'direct', title: 'Answered without the tool', text: 'The tool was offered, but the agent did not call it. Nothing in this answer comes from the service.' };
  if (!reports.length) return { tone: 'reported', title: 'Service failed', text: `Every call failed (${[...new Set(run.results.map((item) => item.stage))].join(', ')}). Check that the answer admits it and gives no figures${grounding.figures ? `: it contains ${plural(grounding.figures, 'number')}` : ''}.` };
  if (!grounding.figures) return { tone: 'grounded', title: `Based on ${where}`, text: 'The answer gives no figures to check. Read it against the report below: place, conditions, source, and time.' };
  if (!grounding.unsupported.length) return { tone: 'grounded', title: `Grounded in ${where}`, text: `${plural(grounding.grounded.length, 'figure')} in the answer, and every one matches a value the tool returned.` };
  return { tone: 'partial', title: 'Partly grounded', text: `${plural(grounding.unsupported.length, 'figure')} (${grounding.unsupported.join(', ')}) ${grounding.unsupported.length === 1 ? 'does' : 'do'} not match the tool output. It may be a conversion, a count, or an invented number: check it.` };
}

// Runtime boundary: the browser checks the server's summary before using it.
export function parseWeatherRun(value: unknown, id: string, prompt: string): WeatherRun {
  const fail = (): never => { throw new Error('Invalid run summary.'); };
  if (!isObject(value)) return fail();
  const str = (field: unknown): string | null => (typeof field === 'string' ? field : field === null || field === undefined ? null : fail());
  const call = (raw: unknown): ToolCall => {
    if (!isObject(raw) || typeof raw.callId !== 'string' || typeof raw.name !== 'string') return fail();
    return { callId: raw.callId, name: raw.name, turnId: str(raw.turnId), itemId: str(raw.itemId), status: str(raw.status), arguments: raw.arguments };
  };
  const result = (raw: unknown): CheckedResult => {
    const outcome = parseOutcome(raw);
    if (!isObject(raw) || typeof raw.callId !== 'string' || typeof raw.name !== 'string') return fail();
    return { ...outcome, callId: raw.callId, turnId: typeof raw.turnId === 'string' ? raw.turnId : '', name: raw.name, round: num(raw.round) ? raw.round : 1, attempt: num(raw.attempt) ? raw.attempt : 0 };
  };
  const momentKinds: Moment['kind'][] = ['prompt', 'call', 'request', 'reject', 'result', 'answer', 'outcome'];
  const moment = (raw: unknown): Moment => (isObject(raw) && num(raw.at) && momentKinds.includes(raw.kind as Moment['kind']) && typeof raw.label === 'string' ? { at: raw.at, kind: raw.kind as Moment['kind'], label: raw.label } : fail());
  const statuses: TurnStatus[] = ['completed', 'failed', 'cancelled', 'waiting', 'unknown'];
  if (!statuses.includes(value.turnStatus as TurnStatus) || ![value.calls, value.results, value.events, value.timeline].every(Array.isArray)) return fail();
  return {
    id, prompt,
    source: value.source === 'recorded' ? 'recorded' : 'live',
    fault: faults.some((item) => item.id === value.fault) ? value.fault as Fault : 'none',
    toolOffered: value.toolOffered !== false,
    sessionId: str(value.sessionId), turnId: str(value.turnId), turnStatus: value.turnStatus as TurnStatus,
    rounds: num(value.rounds) ? value.rounds : 0,
    calls: (value.calls as unknown[]).map(call), results: (value.results as unknown[]).map(result),
    answer: typeof value.answer === 'string' ? value.answer : '',
    events: (value.events as unknown[]).filter((item): item is string => typeof item === 'string'),
    timeline: (value.timeline as unknown[]).map(moment),
    error: str(value.error),
  };
}

// Also used for the probe and the server's test results.
export function parseOutcome(raw: unknown): ServiceOutcome {
  const fail = (): never => { throw new Error('Invalid tool outcome.'); };
  if (!isObject(raw) || typeof raw.success !== 'boolean' || !stages.some((item) => item.id === raw.stage)) return fail();
  const text = (field: unknown) => (typeof field === 'string' ? field : null);
  const outcomes: RequestOutcome[] = ['ok', 'blocked', 'timeout', 'network', 'status', 'shape'];
  const requests = Array.isArray(raw.requests) ? raw.requests.filter((item): item is UpstreamRequest => isObject(item) && typeof item.url === 'string' && typeof item.host === 'string' && outcomes.includes(item.outcome as RequestOutcome)) : [];
  const issues = Array.isArray(raw.issues) ? raw.issues.filter((item): item is Issue => isObject(item) && typeof item.path === 'string' && typeof item.message === 'string') : [];
  const report = isObject(raw.report) && isObject(raw.report.place) && Array.isArray(raw.report.days) ? raw.report as WeatherReport : null;
  return {
    stage: raw.stage as Stage, success: raw.success, output: text(raw.output), error: text(raw.error), retryable: raw.retryable === true, issues,
    args: isObject(raw.args) ? raw.args as WeatherArgs : null, internal: text(raw.internal), durationMs: num(raw.durationMs) ? raw.durationMs : 0, requests, report,
  };
}
