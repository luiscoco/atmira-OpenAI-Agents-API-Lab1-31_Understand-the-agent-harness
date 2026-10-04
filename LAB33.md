# Lab 33 — Apply project rules with AGENTS.md

Open **Harness architecture & security → Lab 33**, or navigate to `#lab33`. Learn which instruction sources apply, compare scoped conventions, and distinguish behavioral guidance from enforced permissions.

## 1. Explore discovery without credentials

Select the repository root, `reports`, `reports/private`, or `data`. Inspect the fixture files and the ordered source chain. Edit the root guidance and observe the report expectations. The fixture's `Title`, `Output`, and `Sections` bullets make conventions independently testable; they are not a special AGENTS.md schema.

At each directory, the explorer selects the first nonempty file: `AGENTS.override.md`, `AGENTS.md`, then configured fallback names. It concatenates sources from repository root to the starting directory. Toggle the reports override and the `TEAM_GUIDE.md` fallback. Ancestor sections remain when a child changes only the title and filename. Sibling and descendant instruction files are not in this starting-directory chain.

The explorer is a bounded, in-memory teaching model of repository discovery. Actual Codex also loads global guidance from its selected home/profile, limits combined instructions (`project_doc_max_bytes`, 32 KiB by default), and rebuilds the chain for a new run. This page does not inspect host instruction files or prove that a particular Codex run loaded them.

## 2. Inspect a labelled synthetic comparison

Use **Show synthetic comparison**. The example shows an illustrative unguided result and a report that follows the fixture conventions. Compare JSON shape, scoped title, output filename, section headings, source attribution, and revenue. Independently, `3 × 12 + 8 × 2 = 52 EUR`.

Synthetic output is not recorded model output. An actual unguided model may satisfy some or all checks; guidance does not guarantee compliance. Editing the explorer does not rewrite previously captured comparison evidence.

## 3. Verify the explicit Agents API loading path

Configure `OPENAI_API_KEY` and an accessible `OPENAI_MODEL` in `.env`, then restart the course server. This exercise needs no Docker or executor key. **Run live API comparison** makes two sequential, fresh sessions with the same model and CSV task. The course application builds each request:

```ts
const { instructions, prompt } = buildRuleRequest(options, guided);
client.beta.agents.sessions.create({
  agent: { model, instructions },
  environment: { type: 'none' },
  input: prompt,
  stream: true,
});
```

For the guided arm, the server explicitly concatenates the selected fixture sources into `agent.instructions`. The unguided arm contains only the shared output contract. Inspect **Exact instructions submitted**, selected source paths, answer, root outcome, and validation results for each arm. The API does not read this host repository. The supplied CSV is prompt text, and the response is a proposed file; no filesystem access or file write is claimed.

The server allows one comparison at a time, bounds request size and output, deduplicates event IDs, waits for a root terminal event, excludes commentary, and uses a two-minute deadline. Stopping or leaving the lab aborts the browser request; the server attempts cancellation of unfinished work and deletion of known API sessions. Cleanup failure remains visible with the session ID. Inspect that ID in Lab 30 if deletion needs further attention. This is a localhost teaching endpoint.

## 4. Run the documented Codex baseline with real files

Download **Codex workspace scaffold** and run it in an empty exercise folder:

```powershell
node .\lab33-workspace.mjs
cd lab33-workspace
codex --version
codex --sandbox workspace-write "List your loaded instruction sources. Read data/sales.csv and create the Markdown sales report required by project guidance."
git status --short
```

The scaffold initializes a fresh Git repository and writes the displayed fixtures. It refuses to overwrite an existing `lab33-workspace` directory. It does not change your Codex profile or global instruction files. Install and authenticate Codex using the official setup appropriate to your environment before this step. Record any inherited global instructions because they can affect the comparison.

Start a new scoped run:

```powershell
codex --cd reports --sandbox workspace-write "List your loaded instruction sources. Read ../data/sales.csv and create the Markdown sales report required by project guidance."
Get-Content reports/reviewed-summary.md
git diff -- data/sales.csv
```

With the default scaffold, the root report uses `Sales summary` and `summary.md`. The reports override uses `Reviewed sales` and `reviewed-summary.md`, while retaining the ancestor's `Summary` and `Totals` sections. Verify actual files rather than relying on the model's claim. Rename the override to a filename outside discovery and run Codex again:

```powershell
Rename-Item -LiteralPath reports/AGENTS.override.md -NewName AGENTS.override.disabled
codex --cd reports --sandbox workspace-write "List your loaded instruction sources. Read ../data/sales.csv and create the Markdown sales report required by project guidance."
Get-Content reports/regional-summary.md
```

Configure `project_doc_fallback_filenames = ["TEAM_GUIDE.md"]` in your selected Codex profile to test the private directory. Start a fresh run:

```powershell
codex --cd reports/private --sandbox workspace-write "List your loaded instruction sources. Read ../../data/sales.csv and create the Markdown sales report required by project guidance."
Get-Content reports/private/private-summary.md
```

Record the CLI version, profile, starting directory, active global and project sources, final file contents, and unchanged CSV. For instruction loading evidence, use the runtime log/trace described in the official AGENTS.md guide; a model-generated list of sources alone is not conclusive. The browser's discovery chain is a prediction, not the actual runtime log.

To compare native Codex without repository guidance, use a second fresh scaffold and rename every instruction file outside the configured discovery names before starting Codex. Keep the same CSV and task and account for global guidance. Never modify the host course repository's instruction files for this exercise.

## 5. Explain guidance and enforcement

“Do not change the input CSV” is guidance. The runtime's sandbox policy, tool permissions, and filesystem configuration enforce access. This lab does not claim that an AGENTS.md rule blocks a write. Lab 35 adds an enforced filesystem boundary. A passing report check establishes consistency for this fixed task, not causal proof or general instruction-following reliability.

Export API comparison evidence and student notes. Attach actual Codex source-loading evidence and report files separately. Demonstrate an override, an ordinary-file restoration, a disabled fallback, and a meaningful failed report check.

## How it was built

| File | Responsibility |
| --- | --- |
| `src/Lab33.tsx` | Explorer, comparisons, downloads, evidence and Viva voice |
| `src/lab33Rules.ts` | Fixture discovery, request construction and independent report checks |
| `src/lab33Tests.ts` | Shared browser/server rule suite |
| `src/lab33Lessons.ts` | Six explained and narrated code snippets |
| `server/lab33.ts` | Bounded localhost routes and official SDK adapter |
| `server/lab33Service.ts` | Observed root outcomes, answer collection and session cleanup |
| `server/lab33.integration.test.ts` | Fake API lifecycle tests and real HTTP route checks |

## Validation

```powershell
npm run test:lab33
npm run build
```

Automated tests use fake API events and local HTTP requests. They require no model credentials and do not establish live account access or native Codex discovery. Browser/server suites share the same fixture expectations.

## Official references

Checked 2026-10-04: [Codex project instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [Agents API configuration](https://developers.openai.com/api/docs/guides/agents-api/configuration), and [Sandbox security](https://developers.openai.com/api/docs/guides/agents-api/environments/security).
