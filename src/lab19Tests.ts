// Lab 19: the service test page. Every case runs the real wrapper (runWeatherTool) against recorded Open-Meteo
// responses, so it needs no network and no API key. Faults wrap the recorded fetcher exactly as they wrap the live one.
import { recordedFetcher, ResponseCache, runWeatherTool, service, testTiming, weatherTool, withFault, type Fault, type ServiceOutcome, type Stage, type Timing } from './lab19Service.ts';

export type TestGroup = 'valid' | 'input' | 'upstream';
export type ServiceTest = { id: string; label: string; group: TestGroup; name: string; args: unknown; fault: Fault; expect: Stage; note: string; twice?: boolean };
export type TestResult = { id: string; outcome: ServiceOutcome; pass: boolean };

const test = (id: string, label: string, group: TestGroup, args: unknown, expect: Stage, note: string, extra: Partial<ServiceTest> = {}): ServiceTest =>
  ({ id, label, group, name: weatherTool.name, args, fault: 'none', expect, note, ...extra });

export const serviceTests: ServiceTest[] = [
  test('madrid', 'A city, three days', 'valid', { city: 'Madrid', days: 3, units: 'celsius' }, 'ok', 'Two GETs: find the place, then its forecast.'),
  test('qualified', 'A qualified name', 'valid', { city: 'Paris, Texas', days: 2, units: 'fahrenheit' }, 'ok', 'The qualifier picks Paris, Texas over the larger Paris, France.'),
  test('string', 'Arguments as a JSON string', 'valid', '{"city":"Tokyo","days":1,"units":"celsius"}', 'ok', 'The API may send a string; parse it first.'),
  test('spaces', 'Extra spaces', 'valid', { city: '  New   York ', days: 1, units: 'celsius' }, 'ok', 'Normalised to "New York" before the request is built.'),
  test('cache', 'The same call twice', 'valid', { city: 'London', days: 2, units: 'celsius' }, 'ok', 'The second call is served from the cache: no request leaves the server.', { twice: true }),
  test('url', 'A URL as the city', 'input', { city: 'https://evil.example/steal?city=Madrid', days: 1, units: 'celsius' }, 'input', 'The model never chooses where the request goes.'),
  test('endpoint', 'An extra endpoint field', 'input', { city: 'Madrid', days: 1, units: 'celsius', endpoint: 'http://169.254.169.254/' }, 'input', 'additionalProperties is false, so the field is rejected, not ignored.'),
  test('coords', 'Coordinates as the city', 'input', { city: '40.41, -3.70', days: 1, units: 'celsius' }, 'input', 'The tool takes place names; the service resolves the coordinates.'),
  test('range', 'Fourteen days', 'input', { city: 'Madrid', days: 14, units: 'celsius' }, 'input', 'maximum is 7. The service allows 16, but this tool promises less.'),
  test('fraction', 'Half a day', 'input', { city: 'Madrid', days: 2.5, units: 'celsius' }, 'input', 'days must be an integer.'),
  test('kelvin', 'Wrong units', 'input', { city: 'Madrid', days: 1, units: 'kelvin' }, 'input', '"kelvin" is not in the enum.'),
  test('write', 'A write function', 'input', { city: 'Madrid', message: 'Storm warning' }, 'name', 'This server has no write functions to run.', { name: 'post_weather_alert' }),
  test('nowhere', 'A place that does not exist', 'upstream', { city: 'Qwertyville', days: 3, units: 'celsius' }, 'found', 'The service answers 200 with no results. The agent is told not to guess.'),
  test('mismatch', 'Right name, wrong country', 'upstream', { city: 'Madrid, Japan', days: 1, units: 'celsius' }, 'found', 'There is no safe choice, so the error lists the places that do exist.'),
  test('slow', 'Service too slow', 'upstream', { city: 'Madrid', days: 1, units: 'celsius' }, 'network', 'The deadline fires and the request is aborted.', { fault: 'slow' }),
  test('down', 'Service unreachable', 'upstream', { city: 'Madrid', days: 1, units: 'celsius' }, 'network', 'The connection fails. Worth one retry.', { fault: 'down' }),
  test('http', 'HTTP 503', 'upstream', { city: 'Madrid', days: 1, units: 'celsius' }, 'status', 'A 5xx is temporary: try once more.', { fault: 'http_error' }),
  test('drift', 'The response shape changed', 'upstream', { city: 'Madrid', days: 1, units: 'celsius' }, 'shape', 'Nothing crashes, but validation notices the missing field. Do not retry.', { fault: 'drift' }),
];

export async function runServiceTest(item: Pick<ServiceTest, 'id' | 'name' | 'args' | 'fault' | 'expect' | 'twice'>, timing: Timing = testTiming): Promise<TestResult> {
  const fetcher = withFault(recordedFetcher(timing.latencyMs), item.fault, timing);
  const cache = new ResponseCache(service.cacheTtlMs);
  const call = { name: item.name, arguments: item.args };
  const options = { fetcher, timing, live: false, cache };
  let outcome = await runWeatherTool(call, options);
  if (!item.twice) return { id: item.id, outcome, pass: outcome.stage === item.expect };
  outcome = await runWeatherTool(call, options);
  return { id: item.id, outcome, pass: outcome.stage === item.expect && outcome.requests.length > 0 && outcome.requests.every((request) => request.cached) };
}

// Cases are independent (each has its own cache), so they run in parallel; the timeout case sets the pace.
export const runServiceSuite = (timing: Timing = testTiming) => Promise.all(serviceTests.map((item) => runServiceTest(item, timing)));
