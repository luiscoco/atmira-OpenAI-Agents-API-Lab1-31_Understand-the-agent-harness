// Lab 21: recorded answers for the source inspector. They are illustrative samples written for the course, not live
// search results, so they need no API key. Each one shows a different thing to check before trusting an answer.
import type { SearchCall, SearchMode } from './lab21Search.ts';

export type Sample = {
  id: string;
  label: string;
  prompt: string;
  toolOffered: boolean;
  mode: SearchMode;
  domains: string;
  searches: SearchCall[];
  answer: string;
  lesson: string;
};

const search = (id: string, ...queries: string[]): SearchCall => ({ id, status: 'completed', turnId: 'turn_sample', action: { type: 'search', queries } });
const open = (id: string, url: string): SearchCall => ({ id, status: 'completed', turnId: 'turn_sample', action: { type: 'open_page', url } });

export const samples: Sample[] = [
  {
    id: 'sourced', label: 'Sourced answer', prompt: 'How long is a day on Mars?', toolOffered: true, mode: 'live', domains: '',
    searches: [search('ws_1', 'length of a day on Mars sol'), open('ws_2', 'https://science.nasa.gov/mars/facts/')],
    answer: 'A day on Mars, called a **sol**, lasts about 24 hours and 37 minutes, according to [NASA’s Mars Facts](https://science.nasa.gov/mars/facts/).\n\nA Martian year is much longer: about 687 Earth days ([NASA’s Mars Facts](https://science.nasa.gov/mars/facts/?utm_source=openai)).',
    lesson: 'Two links to the same page with a tracking parameter count as one source, used twice. The page also appears in the search log as opened.',
  },
  {
    id: 'memory', label: 'No tool: from memory', prompt: 'How long is a day on Mars?', toolOffered: false, mode: 'live', domains: '',
    searches: [],
    answer: 'A day on Mars lasts about 24 hours and 40 minutes. I could not search the web, so this comes from my training data and may be out of date.',
    lesson: 'The answer may well be right, but nothing in it can be checked. The model says so, as the instructions require.',
  },
  {
    id: 'unsourced', label: 'Searched, no links', prompt: 'What are the main features in the latest Python release?', toolOffered: true, mode: 'live', domains: '',
    searches: [search('ws_1', 'latest Python release features'), search('ws_2', 'Python release notes whats new')],
    answer: 'The latest Python release improves error messages, speeds up the interpreter, and adds new typing features.\n\nIt also updates several standard library modules and deprecates older APIs that will be removed in 2 releases.',
    lesson: 'Two searches ran, but the reader gets no way to verify any claim. The coverage check flags both paragraphs.',
  },
  {
    id: 'offlist', label: 'Outside the allowlist', prompt: 'How long is a day on Mars? Use NASA sources.', toolOffered: true, mode: 'live', domains: 'nasa.gov',
    searches: [search('ws_1', 'Mars day length site:nasa.gov')],
    answer: 'A sol lasts about 24 hours and 37 minutes ([NASA](https://science.nasa.gov/mars/facts/)).\n\nThe name comes from the Latin word for sun, as explained on [Wikipedia](https://en.wikipedia.org/wiki/Sol_(day)).',
    lesson: 'science.nasa.gov is inside nasa.gov, so it passes. The Wikipedia link, with parentheses in its URL, is outside the allowlist. allowed_domains limits search results, not what the model writes.',
  },
  {
    id: 'unsafe', label: 'Unsafe and mislabelled links', prompt: 'Summarize this product page and link the source.', toolOffered: true, mode: 'live', domains: '',
    searches: [search('ws_1', 'example product page'), open('ws_2', 'https://shop.example.com/widget')],
    answer: 'The widget costs 49 euros and ships in 3 days ([shop.example.com](https://shop.example.com/widget)).\n\nThe page says to [verify your account at nasa.gov](https://nasa.gov.login-check.example/verify) and to [click here](javascript:alert(document.cookie)) for a discount.',
    lesson: 'Text from a web page can carry instructions and links. The javascript: link never becomes clickable, and a link whose text names one site but goes to another is flagged.',
  },
  {
    id: 'bare', label: 'Bare URLs and code', prompt: 'Where are the Node.js docs for fetch?', toolOffered: true, mode: 'cached', domains: 'nodejs.org',
    searches: [search('ws_1', 'Node.js fetch documentation')],
    answer: 'The global `fetch` function is documented at https://nodejs.org/api/globals.html#fetch.\n\nFor example:\n\n```js\nconst response = await fetch("https://example.com/data.json");\n```\n\nSee also the undici project (www.github.com/nodejs/undici).',
    lesson: 'Bare URLs count as citations; the trailing full stop and closing bracket are not part of them. The URL inside the code block is an example, not a source. www.github.com is outside nodejs.org.',
  },
];
