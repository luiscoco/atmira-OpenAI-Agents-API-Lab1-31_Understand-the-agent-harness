# Lab 19 — Connect a read-only service

In Labs 16–18 the tool answered from a list in our own code. Lab 19 puts a **real external API** behind it: the free, keyless [Open-Meteo](https://open-meteo.com) weather service. The service is wrapped in **one narrow, typed function**, `get_weather_forecast`. The model chooses a city, a number of days, and the units. The server chooses everything else: it builds the request, checks where it goes, puts one deadline on it, validates the JSON that comes back, and returns a small result with its **source and time**. The page then checks that the agent's answer is **grounded** in that result.

## Learning goals

1. Declare a **narrow** tool (three small arguments) rather than a proxy. The model never chooses a URL, host, method, or field list.
2. Build requests **in code** from fixed bases with `URLSearchParams`, and guard every request: HTTPS, `GET` only, an allowlisted host and path, no redirects.
3. Make the real HTTP call **only on the server**, with **one deadline** for the whole tool call and an abort signal that really stops `fetch`.
4. Treat the service's response as `unknown` too. Validate its shape, lengths, and units, so **shape drift** is caught instead of passed on.
5. **Narrow** the result to the fields the agent needs, add provenance (`source`, `fetched_at`, the resolved place, a `match_note`), and cache validated responses.
6. Tell each failure apart (timeout, unreachable, HTTP 5xx, shape changed, place not found) and give the agent the right instruction for each.
7. Check that the answer is **grounded**: every number in it should match a value the tool returned.

## Run the lab

Run `npm ci`, put `OPENAI_API_KEY` in a private `.env` file, and start the app with `npm run dev`. Open **Connect a read-only service** in the sidebar (`#lab19`), under **Function tools & human control**. The server needs outbound HTTPS access to `geocoding-api.open-meteo.com` and `api.open-meteo.com` for live data. Open-Meteo needs no key. If the network is blocked, choose **Recorded sample**.

**The wrapper.** The declaration the model sees, next to the list of things the server fixes, and eight gates: Name → Input → Request → Network → Status → Response → Place → Result.

**Service probe (no OpenAI key needed).** This sends arguments straight to the same `runWeatherTool` the agent loop uses (`POST /api/lab19/probe`). Choose the data source (**Live Open-Meteo** or **Recorded sample**) and a fault. The result shows the gates, each upstream request (host, path, status, time, size, cache hit), a readable forecast card, **raw size → tool output size**, the exact `tool_result` event, the server log, and the raw responses the agent never sees. Call the same live arguments twice to see a **cache hit**, and use **Clear the cache** (`DELETE /api/lab19/cache`) to reset. **Try the request guard** checks any URL and method against the allowlist in the browser.

**Service test page (no network, no key).** 18 cases run against recorded responses in the Open-Meteo format:

| Group | Cases | Expected stop |
| --- | --- | --- |
| Valid calls | a city for three days, `Paris, Texas` (the qualifier wins over Paris, France), arguments as a JSON string, extra spaces, the same call twice (second one fully cached) | Result |
| Rejected before the network | a URL as the city, an extra `endpoint` field, coordinates as the city, 14 days, 2.5 days, `kelvin`, a write function | Input or Name |
| What the service can do | a place that does not exist, the right name with the wrong country, too slow, unreachable, HTTP 503, shape changed | Place, Network, Status, or Response |

**Run all in the browser** and **Run all on the server** (`POST /api/lab19/test`) run the same code with a 300 ms deadline.

**Live run.** Pick a question and choose:

| Option | Effect |
| --- | --- |
| **The weather tool** / **No tool** | Offer `get_weather_forecast`, or run the same model with no data source for comparison. |
| **Live Open-Meteo** / **Recorded sample** | Real HTTPS requests from the server, or the recorded data (Madrid, London, Paris, New York, Tokyo). Recorded results say `NOT live data`. |
| **Works normally** | Requests go through unchanged. Live responses are cached for 10 minutes. |
| **Too slow** | Each request would take 10 s. The 4 s deadline aborts it; the agent may try once more. |
| **Unreachable** | The connection fails (`fetch failed: getaddrinfo ENOTFOUND …`); the agent may try once more. |
| **HTTP 503** | The service answers with an error status; the agent may try once more. |
| **Shape changed** | The forecast arrives with `temperature_2m_max` renamed. Validation stops it, and the agent is told not to retry. |

The result shows a verdict (*grounded*, *partly grounded*, *service failed*, *answered without the tool*, or *no data source*), the answer, a **grounding check** that marks each number green (found in the data) or red (not found), a timed trace that includes each upstream `GET`, and every call with its outcome. **Read the saved items** shows the `function_call_output` items.

Open **View code** for six snippets and explanations. **Viva voice · Read aloud** reads one explanation aloud, and **Viva voice · Read all six** reads them all in order. Both use browser speech synthesis and do not call an audio API.

## How it was built — step by step

### 1. Declare a narrow tool

```ts
// src/lab19Service.ts
export const weatherTool: FunctionToolDeclaration = {
  type: 'function',
  name: 'get_weather_forecast',
  description: 'Get the current weather and a daily forecast (1 to 7 days, starting today) for a city, from the live Open-Meteo service. ' +
    'Use it whenever the user asks about the weather, temperature, rain, or wind somewhere today or in the next few days. ' +
    'It is read-only. Do not use it for past weather, climate averages, or dates more than 7 days ahead.',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', minLength: 2, maxLength: 80, description: '… Not a URL or coordinates.' },
      days: { type: 'integer', minimum: 1, maximum: 7, description: '…' },
      units: { type: 'string', enum: ['celsius', 'fahrenheit'], description: '…' },
    },
    required: ['city', 'days', 'units'],
    additionalProperties: false,
  },
};
```

**Why:** Open-Meteo accepts dozens of parameters and up to 16 forecast days. The tool promises less: three arguments and at most 7 days. A generic "fetch this URL" tool would hand the model the server's network. This one hands it one question it is allowed to ask. `checkSchema` from Lab 18 gained `minimum` and `maximum` for `days`.

### 2. Validate the arguments, including what a place name is not

```ts
// src/lab19Service.ts
const notAPlace = /(?:^|\s)[a-z][a-z0-9+.-]*:\/\/|[/\\@]|^\s*-?\d+(?:\.\d+)?\s*[,;\s]\s*-?\d+(?:\.\d+)?\s*$/i;

export function validateWeatherArgs(raw: unknown): Validation {
  const parsed = parseArguments(raw);                                  // object or JSON string
  const shape = checkSchema(parsed.value, weatherTool.parameters);     // Lab 18's checker
  const args: WeatherArgs = { city: …, days: …, units: … };             // typed only after the schema passes
  if (controlCharacters.test(args.city)) issues.push({ layer: 'meaning', path: '/city', code: 'control', … });
  else if (notAPlace.test(args.city)) issues.push({ layer: 'meaning', path: '/city', code: 'place', message: 'must be a place name, not a URL, a path, an email address, or coordinates.' });
  return { ok: true, value: { ...args, city: args.city.trim().replace(/\s+/g, ' ') }, issues: [] };
}
```

**Why:** This is Lab 18's boundary with one more meaning rule. A city that contains `://`, a slash, an `@`, or a pair of coordinates is rejected before any request is built. A failure here is stage **Input**, with every issue listed for the agent.

### 3. Build the request in code, then guard it

```ts
// src/lab19Service.ts
export const service = {
  geocodeBase: 'https://geocoding-api.open-meteo.com/v1/search',
  forecastBase: 'https://api.open-meteo.com/v1/forecast',
  allowed: { 'geocoding-api.open-meteo.com': '/v1/search', 'api.open-meteo.com': '/v1/forecast' },
  maxBytes: 200_000,
  cacheTtlMs: 10 * 60_000,
};

export function forecastUrl(place, days, units) {
  const url = new URL(service.forecastBase);
  url.search = new URLSearchParams({ latitude: String(place.latitude), longitude: String(place.longitude),
    current: currentFields.join(','), daily: dailyFields.join(','), timezone: 'auto',
    forecast_days: String(days), temperature_unit: units, wind_speed_unit: 'kmh', precipitation_unit: 'mm' }).toString();
  return url.toString();
}

export function checkRequest(url: string, method: string): Guard {
  if (method.trim().toUpperCase() !== 'GET') return block('… read-only: GET only.');
  if (target.protocol !== 'https:') return block('… HTTPS only.');
  if (target.username || target.password) return block('credentials inside the URL are not allowed.');
  if (target.port) return block(`port ${target.port} is not allowed.`);
  const path = service.allowed[target.hostname];
  if (!path) return block(`host ${target.hostname} is not on the allowlist (…).`);
  if (target.pathname !== path) return block(`path ${target.pathname} is not allowed on ${target.hostname}. Only ${path}.`);
  return { ok: true, reason: null };
}
```

**Why:** `URLSearchParams` encodes every value, so a city can never change the host, the path, or the other parameters. The guard runs before every request as a second line of defence. It checks the exact hostname, so `api.open-meteo.com.evil.example` is blocked, and so are cloud metadata addresses. If the guard ever fires, the request is marked `blocked`, the call stops at **Request**, and the agent is told not to retry.

### 4. One real fetch, on the server only

```ts
// server/lab19.ts
const httpFetcher: Fetcher = async (url, signal) => {
  const response = await fetch(url, { method: 'GET', signal, redirect: 'error', headers: { Accept: 'application/json', 'User-Agent': 'agents-api-labs/lab19 (course demo)' } });
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > service.maxBytes) { await response.body?.cancel(); return { status: response.status, body: null, bytes: declared }; }
  const raw = await response.text();
  let body: unknown = raw;
  try { body = JSON.parse(raw); } catch { /* not JSON: validation reports it */ }
  return { status: response.status, body, bytes: Buffer.byteLength(raw) };
};
```

**Why:** The browser never talks to the weather service. `redirect: 'error'` matters because a redirect could send the request to a host that is not on the allowlist. The network is **injected** as a `Fetcher`, so the same wrapper runs with this real fetcher, with `recordedFetcher` in the tests, and with `withFault` wrapped around either one.

### 5. One GET, with every failure told apart

```ts
// src/lab19Service.ts, getJson()
const guard = checkRequest(url, 'GET');
if (!guard.ok) throw new RequestBlockedError(…);
const hit = ctx.cache?.get(url);                                      // validated responses only
try { upstream = await ctx.fetcher(url, signal); }
catch (caught) { if (signal.aborted) throw signal.reason; throw new NetworkError(…); }
if (upstream.status < 200 || upstream.status >= 300) throw new UpstreamStatusError(upstream.status, reasonOf(upstream.body));
if (upstream.bytes > service.maxBytes) throw new UpstreamShapeError([…]);
const parsed = parse(upstream.body);
if (parsed.value === null) throw new UpstreamShapeError(parsed.issues);
ctx.cache?.set(url, upstream.body, upstream.bytes);
```

```ts
// src/lab19Service.ts, runWeatherTool()
const report = await withTimeout((signal) => weatherService(args, ctx, signal, …), options.timing.timeoutMs);   // 4000 ms, both requests
```

**Why:** A timeout, a dropped connection, an HTTP error, and a changed response need different answers, so each has its own error type. One deadline covers the whole tool call, geocoding and forecast together, because that is how long the user waits. Every request is recorded in order (`ok`, `blocked`, `timeout`, `network`, `status`, `shape`, or a cache hit), and the live run streams each one onto the timeline.

### 6. Validate the response

```ts
// src/lab19Service.ts
export function parseForecast(body: unknown, expect: Pick<WeatherArgs, 'days' | 'units'>): Parsed<Forecast> {
  if (!Array.isArray(time) || !time.every(isIsoDate)) issues.push('daily.time must be an array of YYYY-MM-DD dates.');
  else if (time.length !== expect.days) issues.push(`daily.time has ${time.length} days; ${expect.days} were requested.`);
  const max = column('temperature_2m_max', false);                   // numbers, same length as time
  const probability = column('precipitation_probability_max', true); // numbers or null
  if (dailyUnits.temperature_2m_max !== wanted) issues.push(`… ${wanted} was requested.`);
}
export function parseGeocode(body: unknown): Parsed<Place[]> {
  if (body.results === undefined) return { value: [], issues: [] };  // Open-Meteo's "nothing found"
}
```

**Why:** The response is text from outside your code, just like the model's arguments. Every field the wrapper uses is checked, including the column lengths and the units. When the **Shape changed** fault renames `temperature_2m_max`, nothing crashes and no wrong numbers reach the agent. The server log records `daily.temperature_2m_max is missing`, and the agent gets `unexpected format (ref err_…). Do not retry`.

### 7. Choose the place honestly

```ts
// src/lab19Service.ts
export function pickPlace(places: Place[], qualifier: string): Place | null {
  if (!qualifier) return places[0] ?? null;                          // trust the service's ranking
  return places.find((place) => [place.country, place.countryCode, place.region].some((field) => field && fold(field) === fold(qualifier))) ?? … ?? null;
}
// narrow(): match_note when the resolved name differs from the one asked for
```

**Why:** Open-Meteo ranks results by population. In testing, preferring an exact name match made results worse: `Washington` became a small town instead of Washington D.C., and `Frankfurt` a small Frankfurt instead of Frankfurt am Main. So the wrapper trusts the ranking, and it adds a `match_note` whenever the resolved place is not simply the name that was asked for (for example, `Wakanda` → *Wakanda Park, Wisconsin*). The instructions tell the agent to pass that on. A qualifier (`Paris, Texas`) must match a country or region. If it matches nothing (`Madrid, Japan`), the call stops at **Place**, and the error lists the places that do exist.

### 8. Narrow the result and label its source

```ts
// src/lab19Service.ts
export function narrow(place, forecast, live, fetchedAt, requested): WeatherReport {
  return {
    source: live ? 'Weather data by Open-Meteo.com (CC BY 4.0), fetched live' : 'Recorded sample in the Open-Meteo format. NOT live data.',
    live, fetched_at: fetchedAt, requested, match_note,
    place: { name, region, country, latitude, longitude, timezone },
    units: forecast.units,
    current: { time, temperature, conditions: describeCode(code), wind_speed },
    days: forecast.days.map((day) => ({ date, conditions, max, min, precipitation_probability, precipitation, wind_max })),
  };
}
```

**Why:** The raw responses carry postcodes, internal IDs, generation times, and numeric weather codes. The agent gets only what answers the question, with the codes turned into words. It also gets provenance: where the data came from, when it was fetched, and which place was used. For Madrid over three days, about 4.7 KB of raw JSON became an 870-byte tool output. Open-Meteo's free API asks for attribution under CC BY 4.0, which the `source` line carries. Validated live responses are cached for 10 minutes. Faults and recorded data never use the cache, so they cannot pollute it.

### 9. Check that the answer is grounded

```ts
// src/lab19Service.ts
export function checkGrounding(answer: string, reports: WeatherReport[]): Grounding {
  const allowed = allowedNumbers(reports);                           // every value, plus date parts
  for (const text of answer.replace(timestamps, ' ').match(/(?<![\d.,])-?\d+(?:[.,]\d+)?/g) ?? []) {
    const value = Number(text.replace(',', '.'));
    (allowed.some((item) => Math.abs(item - value) <= 0.5) ? grounded : unsupported).push(text);
  }
}
```

```ts
// server/lab19.ts, instructions
'Base every figure you give on the tool output and do not convert or invent numbers. Name the place and country the tool resolved, ' +
'and if the tool returns a match_note, tell the user which place you used. ' +
'End with one short line naming the source and the fetched_at time. If the source says it is a recorded sample, say it is not live data. ' +
'If the tool fails or cannot find the place, say so plainly. Never estimate the weather.'
```

**Why:** The instructions ask for grounded answers, and the page checks them. ISO timestamps and clock times are provenance, so they are removed before counting. Each remaining number must be within 0.5 of a value the tool returned. It is a heuristic, not a proof: a converted temperature or an invented figure shows up red, while a correct day count or date part is allowed.

### 10. The live loop and the test suite

The live loop is Lab 18's: every call gets exactly one `tool_result`, repeated rejected arguments get a sharper error, and Lab 17's four-round cap applies. `runWeatherTool` replaces Lab 18's `runTool`, and an `onRequest` callback streams each upstream `GET` onto the timeline. The 18 test cases (`src/lab19Tests.ts`) each state the gate where the call must stop. They use `recordedFetcher`, which answers both Open-Meteo endpoints from recorded places with a seeded forecast in the real response format, including Open-Meteo's own 400 body for an out-of-range `forecast_days`.

## What a live run showed

These runs used `gpt-5.6-terra` and live Open-Meteo on 28 September 2026 while the lab was being built. Run them again before recording, because model behaviour and the weather both change.

- **"Do I need an umbrella in London over the next 3 days?"** One call (`London`, 3 days, celsius) made two real requests: geocoding in about 230 ms and forecast in about 220 ms. The answer was "Yes, bring one, especially Wednesday: drizzle and 4.2 mm forecast…", followed by the source line. The grounding check found 2/2 figures in the data. Raw 4.2 KB became an 869-byte tool output.
- **The same question with No tool:** "I can't access a live forecast here…" with no figures. The verdict was *No data source*.
- **"Is it sunny in Wakanda today?"** The tool resolved *Wakanda Park, Wisconsin, United States* with a `match_note`. The agent said "I used this closest match for 'Wakanda'."
- **"Compare today's weather in Tokyo and New York." with Shape changed:** two calls in one pause, both stopped at **Response**, and the server logged two `UpstreamShapeError`s with references. The agent answered "Live weather is unavailable right now for both Tokyo and New York, so I can't compare today's conditions without estimating."
- **"How hot will it get in Paris, Texas tomorrow? Use Fahrenheit." with Recorded sample:** the call used `units: "fahrenheit"` and 2 days, and the answer said "Source: Open-Meteo recorded sample, not live data".
- **Probe notes:** `Atlantis` and `Narnia` are real places (in South Africa and Bangladesh), so the not-found examples use `Qwertyville`. `São Paulo` and `Sao Paulo` both resolve to São Paulo, Brazil.

## Rules the page follows

```text
name not implemented                   → stage name,    do not retry
arguments fail parse / schema / meaning→ stage input,   every issue listed, fix and retry
request fails the guard                → stage request, ref err_…, do not retry
deadline (4 s, whole call) passes      → stage network, request aborted, try once more
connection fails                       → stage network, try once more
HTTP 5xx or 429                        → stage status,  try once more
HTTP 4xx                               → stage status,  ref err_…, do not retry (this server built a bad request)
response too large / wrong shape       → stage shape,   ref err_…, do not retry; details only in the server log
no place / qualifier matches nothing   → stage found,   list real candidates, ask the user, do not guess
success                                → narrow report with source, fetched_at, place, match_note
every call                             → exactly one tool_result, matched by call_id
```

## Code map

| File | Role |
| --- | --- |
| `src/lab19Service.ts` | `weatherTool`; `service` config and `checkRequest`; `geocodeUrl`/`forecastUrl`; `validateWeatherArgs`; `parseGeocode`/`parseForecast`; `pickPlace`; `narrow`; `ResponseCache`; `withFault`; `recordedFetcher`; `runWeatherTool`; `checkGrounding`; `classifyWeatherRun`, `parseWeatherRun`, and `parseOutcome` (runtime boundaries). |
| `src/lab19Tests.ts` | The 18 cases, `runServiceTest`, and `runServiceSuite`. |
| `src/lab18Validate.ts` | `checkSchema` gains `minimum` and `maximum`. |
| `server/lab19.ts` | `httpFetcher` (the only real network call), the shared live cache, `runLab19` (the agent loop), `probeLab19`, `clearLab19Cache`, and `testLab19`. |
| `server/index.ts` | Routes `POST /api/lab19/run`, `POST /api/lab19/probe`, `DELETE /api/lab19/cache`, `POST /api/lab19/test`, and `GET /api/lab19/items` (Lab 17's item reader). |
| `src/Lab19.tsx` | The wrapper, probe, request guard, test page, live run, grounding check, result, run history, code snippets, and Viva voice. |
| `src/App.tsx`, `src/styles.css`, `tsconfig.lab6.json` | The sidebar entry, Lab 19 styles, and strict type checking for the new modules. |

## Student challenge

1. Probe **Madrid · 3 days** against live Open-Meteo. Show the two requests, the raw responses, and the size of the tool output. Call it again and show the cache hit.
2. Run the suite on the server and show **18/18 passed**. In **Try the request guard**, explain why the look-alike host is blocked.
3. Ask *Do I need an umbrella in London over the next 3 days?* live. Show the grounding check with every figure green, and the source line in the answer.
4. Ask the same question with **No tool** and with **Shape changed**, and explain the difference between the three answers.

See [Open-Meteo API docs](https://open-meteo.com/en/docs) and [OpenAI Docs: Function tools](https://developers.openai.com/api/docs/guides/agents-api/tools/functions).
