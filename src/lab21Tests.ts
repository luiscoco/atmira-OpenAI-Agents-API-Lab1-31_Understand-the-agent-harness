// Lab 21: the test page. Every case runs the real functions (buildSearchTool, extractCitations, buildReport,
// classifySearchRun) on fixed inputs, so it needs no network and no API key, in the browser or on the server.
import {
  buildReport, buildSearchTool, classifySearchRun, defaultSettings, emptyLocation, extractCitations, hostMatches,
  type SearchCall, type SearchSettings,
} from './lab21Search.ts';

export type TestGroup = 'declare' | 'extract' | 'check';
export type SearchTest = { id: string; label: string; group: TestGroup; expect: string; note: string; run: () => { got: string; detail: string } };
export type TestResult = { id: string; got: string; detail: string; pass: boolean };

const settings = (patch: Partial<SearchSettings>): SearchSettings => ({ ...defaultSettings, ...patch });
const declared = (patch: Partial<SearchSettings>) => {
  const { tool, findings } = buildSearchTool(settings(patch));
  const levels = findings.some((item) => item.level === 'error') ? 'error' : findings.some((item) => item.level === 'warn') ? 'warn' : 'ok';
  return { got: tool ? `${levels} · ${JSON.stringify(tool.allowed_domains ?? [])}` : `${levels} · no tool`, detail: [JSON.stringify(tool), ...findings.map((item) => `${item.level}: ${item.text}`)].join('\n') };
};
const cites = (text: string) => {
  const found = extractCitations(text);
  return { got: found.map((item) => `${item.kind}:${item.url}`).join(' ') || 'none', detail: JSON.stringify(found, null, 2) };
};
const searched: SearchCall[] = [{ id: 'ws_1', status: 'completed', turnId: 't', action: { type: 'search', queries: ['q'] } }];
const report = (answer: string, domains: string[] = [], searches = searched) => buildReport({ answer, searches, allowedDomains: domains, toolOffered: true, mode: 'live' });

export const searchTests: SearchTest[] = [
  { id: 'plain', label: 'One clean domain', group: 'declare', expect: 'ok · ["nasa.gov"]', note: 'The simplest allowlist.', run: () => declared({ domains: 'nasa.gov' }) },
  { id: 'url', label: 'A URL instead of a domain', group: 'declare', expect: 'warn · ["docs.python.org"]', note: 'The scheme and the path are dropped, with a warning.', run: () => declared({ domains: 'https://docs.python.org/3/library/' }) },
  { id: 'wildcard', label: 'A wildcard and a duplicate', group: 'declare', expect: 'warn · ["mozilla.org"]', note: '*.mozilla.org becomes mozilla.org; MOZILLA.org is the same domain.', run: () => declared({ domains: '*.mozilla.org, MOZILLA.org' }) },
  { id: 'invalid', label: 'Not a domain', group: 'declare', expect: 'error · no tool', note: 'An error blocks the run: the server never sends a broken declaration.', run: () => declared({ domains: 'nasa gov' }) },
  { id: 'ip', label: 'An IP address', group: 'declare', expect: 'error · no tool', note: 'allowed_domains takes names, not addresses.', run: () => declared({ domains: '127.0.0.1' }) },
  { id: 'many', label: '101 domains', group: 'declare', expect: 'error · no tool', note: 'The documented limit is 100.', run: () => declared({ domains: Array.from({ length: 101 }, (_, index) => `site${index}.example`).join(' ') }) },
  { id: 'country', label: 'Country written out', group: 'declare', expect: 'error · no tool', note: 'location.country is a two-letter ISO code.', run: () => declared({ location: { ...emptyLocation, country: 'Spain' } }) },
  { id: 'off', label: 'Tool left out', group: 'declare', expect: 'ok · no tool', note: 'The only way to turn search off: do not declare it.', run: () => declared({ offered: false, domains: 'nasa.gov' }) },
  { id: 'markdown', label: 'A Markdown link', group: 'extract', expect: 'markdown:https://science.nasa.gov/mars/facts/', note: 'How the Agents API cites a source.', run: () => cites('About 24 h 37 min ([NASA](https://science.nasa.gov/mars/facts/)).') },
  { id: 'parens', label: 'Parentheses in the URL', group: 'extract', expect: 'markdown:https://en.wikipedia.org/wiki/Sol_(day)', note: 'Balanced brackets are part of the URL.', run: () => cites('See [Sol](https://en.wikipedia.org/wiki/Sol_(day)).') },
  { id: 'bare', label: 'A bare URL at the end of a sentence', group: 'extract', expect: 'bare:https://nodejs.org/api/globals.html', note: 'The full stop is not part of the URL.', run: () => cites('Read https://nodejs.org/api/globals.html.') },
  { id: 'code', label: 'URLs in code and images', group: 'extract', expect: 'none', note: 'An example in code and an image are not sources.', run: () => cites('Try `fetch("https://example.com/a")` and ![chart](https://example.com/c.png)') },
  { id: 'dedupe', label: 'The same page twice', group: 'check', expect: '1 source · 2 uses', note: 'Tracking parameters, the fragment, and www. do not make a new source.', run: () => { const r = report('[A](https://www.nasa.gov/mars#facts) and [B](https://nasa.gov/mars?utm_source=openai)'); return { got: `${r.sources.length} source · ${r.sources[0]?.uses ?? 0} uses`, detail: JSON.stringify(r.sources, null, 2) }; } },
  { id: 'subdomain', label: 'A subdomain of an allowed domain', group: 'check', expect: 'ok', note: 'science.nasa.gov is inside nasa.gov.', run: () => { const r = report('[NASA](https://science.nasa.gov/mars/)', ['nasa.gov']); const check = r.checks.find((item) => item.id === 'allowlist'); return { got: check?.level ?? '?', detail: check?.detail ?? '' }; } },
  { id: 'lookalike', label: 'Look-alike hosts', group: 'check', expect: 'false false true', note: 'The dot boundary matters: evilnasa.gov and nasa.gov.example are not nasa.gov.', run: () => ({ got: [hostMatches('evilnasa.gov', 'nasa.gov'), hostMatches('nasa.gov.example', 'nasa.gov'), hostMatches('mars.nasa.gov', 'nasa.gov')].join(' '), detail: 'hostMatches(host, domain) = host === domain || host.endsWith("." + domain)' }) },
  { id: 'javascript', label: 'A javascript: link', group: 'check', expect: 'fail', note: 'It is shown as text and never becomes a link.', run: () => { const r = report('[Click](javascript:alert(1))'); const check = r.checks.find((item) => item.id === 'safe'); return { got: check?.level ?? '?', detail: check?.detail ?? '' }; } },
  { id: 'mislabel', label: 'Link text names another site', group: 'check', expect: 'fail', note: 'The text says nasa.gov; the link goes elsewhere.', run: () => { const r = report('[nasa.gov](https://nasa.gov.login.example/)'); const check = r.checks.find((item) => item.id === 'labels'); return { got: check?.level ?? '?', detail: check?.detail ?? '' }; } },
  { id: 'coverage', label: 'A paragraph with a figure and no link', group: 'check', expect: 'warn', note: 'One of two factual paragraphs has no source.', run: () => { const r = report('Mars has 2 moons ([NASA](https://science.nasa.gov/mars/)).\n\nIts year lasts 687 days.'); const check = r.checks.find((item) => item.id === 'coverage'); return { got: check?.level ?? '?', detail: check?.detail ?? '' }; } },
  { id: 'verdict-memory', label: 'Links with no search', group: 'check', expect: 'memory', note: 'The model wrote links from memory: open them before trusting them.', run: () => { const verdict = classifySearchRun({ tool: { type: 'web_search', mode: 'live', context_size: 'medium' }, searches: [], answer: '[NASA](https://nasa.gov/)', annotations: [], turnStatus: 'completed', error: null }); return { got: verdict.tone, detail: `${verdict.title}: ${verdict.text}` }; } },
  { id: 'verdict-unsourced', label: 'A search and no links', group: 'check', expect: 'unsourced', note: 'Searching is not the same as citing.', run: () => { const verdict = classifySearchRun({ tool: { type: 'web_search', mode: 'live', context_size: 'medium' }, searches: searched, answer: 'Mars has two moons.', annotations: [], turnStatus: 'completed', error: null }); return { got: verdict.tone, detail: `${verdict.title}: ${verdict.text}` }; } },
];

export function runSearchTest(item: SearchTest): TestResult {
  try {
    const { got, detail } = item.run();
    return { id: item.id, got, detail, pass: got === item.expect };
  } catch (error) {
    return { id: item.id, got: 'crashed', detail: error instanceof Error ? error.message : String(error), pass: false };
  }
}

export const runSearchSuite = () => searchTests.map(runSearchTest);
