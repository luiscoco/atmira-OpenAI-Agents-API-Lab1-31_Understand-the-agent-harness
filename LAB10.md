# Lab 10 — Design an output contract

Lab 10 builds on the saved tutor preset from [Lab 07](LAB07.md). A study-plan form asks the agent for a precise JSON shape. The server validates the completed answer before the browser displays it as a plan.

## Learning goals

1. Write session instructions that define exact fields, types, day count, and time limits.
2. Treat model output as untrusted text. Parse JSON and validate the full application contract.
3. Explain why valid JSON can still be an invalid plan.
4. Show a rejected answer, its specific errors, one repair request, and the result of revalidation.

## Run the lab

Run `npm ci`, put `OPENAI_API_KEY` in a private `.env` file, and start the app with `npm run dev`. Save a tutor preset in Lab 07. Open **Design an output contract** from the sidebar.

Choose a topic, learning goal, 3–7 days, and 15–120 minutes per day. **Generate and validate plan** creates a new session from the saved agent with session-specific output instructions. The saved agent is not modified. The server captures the completed text, validates it, and only renders a plan after every check passes.

If the first answer fails, the UI displays its raw text and validation errors. The server asks for one corrected complete JSON object in the same session. It validates the second answer and stops, whether accepted or rejected. A failed API turn or broken stream is reported separately from a contract failure. Do not treat a partially streamed draft as a validated plan.

The **Validation playground** needs no API key. Load the malformed sample, validate it, and inspect the missing-day and time-budget errors. Load the valid 3-day sample to see acceptance. Change the form to 4 days to see that the same sample then fails. You can edit either sample and validate your own candidate.

Open **View code** for four snippets and explanations. **Viva voice · Read aloud** speaks each explanation using browser speech synthesis; it does not call an audio API.

## How it was built — step by step

The contract lives in `server/lab10Contract.ts` (pure functions); `server/lab10.ts` runs the live generation (`POST /api/lab10/run`) and the offline validator (`POST /api/lab10/validate`).

### 1. Write the contract as instructions

```ts
// server/lab10Contract.ts
export function studyPlanInstructions(days: number, minutesPerDay: number): string {
  return `Create a practical study plan. Output ONLY one JSON object, with no Markdown fences or prose. ` +
    `Exact shape: {"title":"string","goal":"string","days":[{"day":1,"focus":"string","activity":"string","minutes":number}]}. ` +
    `Include exactly ${days} days, numbered 1 through ${days} in order. … ` +
    `Each minutes value must be an integer from 1 to ${minutesPerDay}. … Do not add fields.`;
}
```

**Why:** The model can only follow rules it has been given. The instructions state the exact shape, the exact number of days, the numbering, the time budget, the length limits, and what **not** to do (no Markdown fences, no prose, no extra fields). They are built from the form values, so the rules the model reads are the same numbers the validator checks in step 3.

### 2. Apply the contract to one session without changing the preset

```ts
// server/lab10.ts, runLab10
const instructions = studyPlanInstructions(requestedDays, requestedMinutes);
const input = `Topic: ${topic}\nLearning goal: ${goal}\nDaily time budget: ${requestedMinutes} minutes.`;
stream = await api.beta.agents.sessions.create({ agent_id: agentId, agent: { instructions }, environment: { type: 'none' }, input, stream: true });
```

**Why:** This is Lab 08's session override put to real use. The saved tutor keeps its own instructions, and this one session also gets the output contract. The form values are checked on the server first (a topic, a goal, 3–7 days, and 15–120 minutes), so the contract can never ask for, say, 50 days.

### 3. Validate the finished text: parse, then check every rule

```ts
// server/lab10Contract.ts
export type PlanCheck = { valid: true; plan: StudyPlan; errors: [] } | { valid: false; plan: null; errors: string[] };

export function validateStudyPlan(raw: string, requestedDays: number, minutesPerDay: number): PlanCheck {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return { valid: false, plan: null, errors: ['Output is not valid JSON. Return one JSON object with no Markdown fence or commentary.'] }; }
  const errors: string[] = [];
  if (!object(parsed)) return { valid: false, plan: null, errors: ['The root must be a JSON object.'] };
  for (const key of Object.keys(parsed)) if (!['title', 'goal', 'days'].includes(key)) errors.push(`Unexpected root field: ${key}.`);
  if (!Array.isArray(parsed.days) || parsed.days.length !== requestedDays) errors.push(`days must contain exactly ${requestedDays} entries.`);
  // for each day: no extra fields, day === index + 1, focus/activity lengths, integer minutes within the budget
  if (errors.length) return { valid: false, plan: null, errors };
  return { valid: true, plan: parsed as StudyPlan, errors: [] };
}
```

**Why:** Model output is untrusted text, even when it looks right. Validation happens in two stages. The first asks whether this is JSON at all. The second asks whether it is the **plan the application needs**: the right number of days, numbered in order, within the time budget, with no unknown fields. Valid JSON can still be an invalid plan. The validator collects **every** error instead of stopping at the first one, and each message names the field. `PlanCheck` is a discriminated union, so the code can only reach `plan` after checking `valid`.

### 4. Validate only a completed turn

```ts
// server/lab10.ts, inside the attempt loop
} else if (event.type === 'agent.session.turn.completed' && event.turn?.subagent_id == null) {
  completed = true; turnId = event.turn.id; break;
}
// …
if (!completed || !sessionId) throw new Error('The stream ended before the turn completed. Inspect the session before retrying.');
const raw = [...parts.values()].join('\n');
const check = validateStudyPlan(raw, requestedDays, requestedMinutes);
writeEvent(response, { type: 'validation', attempt, turnId, raw, ...check });
```

**Why:** A streamed draft is useful to watch, but it is never validated or rendered as a plan. Only the full text of a **completed** turn is checked. A broken stream or a failed turn is reported as an API problem, which is different from a contract failure. The `validation` event carries the raw text, the turn ID, and the errors, so the page can show exactly why an answer was rejected.

### 5. Ask for one repair in the same session, then stop

```ts
// server/lab10.ts
if (check.valid || attempt === 2) { writeEvent(response, { type: 'complete', accepted: check.valid }); break; }
stream = await api.beta.agents.sessions.events.stream(sessionId);
await api.beta.agents.sessions.events.create(sessionId, {
  events: [{ type: 'agent.session.input.message', input: [{ role: 'user', content: [{ type: 'input_text',
    text: `Your previous plan failed validation:\n${check.errors.join('\n')}\nReturn a corrected complete JSON object only. Keep the original topic and goal. Do not add Markdown or commentary.` }] }] }],
});
```

**Why:** The repair is a follow-up in the **same** session (Lab 02). The agent can see its own earlier answer, and it receives the exact validation errors. The loop allows at most two attempts. An unlimited repair loop could run up cost and time without ever converging, so after the second answer the server reports accepted or rejected and stops. Both turn IDs are shown as evidence.

### 6. Offer the same validator without an API key

```ts
// server/lab10.ts, validateLab10
const { raw, days, minutesPerDay } = body;
if (typeof raw !== 'string' || raw.length > 12_000
    || !Number.isInteger(days) || (days as number) < 3 || (days as number) > 7
    || !Number.isInteger(minutesPerDay) || (minutesPerDay as number) < 15 || (minutesPerDay as number) > 120) {
  return sendJson(response, 400, { error: 'Provide plan text, 3–7 days, and 15–120 minutes per day.' });
}
return sendJson(response, 200, validateStudyPlan(raw, days as number, minutesPerDay as number));
```

**Why:** The **Validation playground** posts edited text to the same `validateStudyPlan` the live run uses, so what students learn offline is exactly what the live run enforces. Changing the form's day count makes the valid 3-day sample fail, which shows that the contract depends on the request. **View code** holds four snippets with **Viva voice · Read aloud** buttons.

## Contract

```json
{
  "title": "TypeScript foundations",
  "goal": "Build a typed React component",
  "days": [
    { "day": 1, "focus": "Types", "activity": "Write three typed functions", "minutes": 30 }
  ]
}
```

The example shows one day for brevity. A real accepted plan must contain exactly the requested number of days, numbered consecutively from 1. `title`, `goal`, `focus`, and `activity` must be nonempty strings within their length limits. `minutes` must be an integer from 1 through the requested daily budget. Unknown fields, missing fields, Markdown fences, and non-JSON text fail validation.

## Code map

| File | Role |
| --- | --- |
| `server/lab10Contract.ts` | Builds the output instructions and validates JSON, field types, day order, and limits. |
| `server/lab10.ts` | Handles live generation, one repair turn, and the offline validation endpoint. |
| `server/index.ts` | Routes `POST /api/lab10/run` and `POST /api/lab10/validate`. |
| `src/Lab10.tsx` | Shows the form, streamed draft, attempt evidence, accepted plan, playground, code snippets, and Viva voice. |
| `src/App.tsx` | Adds desktop and mobile Lab 10 navigation. |

## Student challenge

First, make the malformed sample pass by adding the missing days and reducing the over-budget time. Then run a live plan, change one contract limit, and explain why each answer was accepted or rejected using the exact validation evidence. Show the session ID and turn IDs for any live repair.

See [OpenAI Docs: Configuring Agents](https://developers.openai.com/api/docs/guides/agents-api/configuration) for session-specific instructions and [Run and continue sessions](https://developers.openai.com/api/docs/guides/agents-api/sessions) for follow-up turns.
