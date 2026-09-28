export type StudyDay = { day: number; focus: string; activity: string; minutes: number };
export type StudyPlan = { title: string; goal: string; days: StudyDay[] };
export type PlanCheck = { valid: true; plan: StudyPlan; errors: [] } | { valid: false; plan: null; errors: string[] };

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nonempty = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;

export function validateStudyPlan(raw: string, requestedDays: number, minutesPerDay: number): PlanCheck {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return { valid: false, plan: null, errors: ['Output is not valid JSON. Return one JSON object with no Markdown fence or commentary.'] }; }
  const errors: string[] = [];
  if (!object(parsed)) return { valid: false, plan: null, errors: ['The root must be a JSON object.'] };
  for (const key of Object.keys(parsed)) if (!['title', 'goal', 'days'].includes(key)) errors.push(`Unexpected root field: ${key}.`);
  if (!nonempty(parsed.title, 100)) errors.push('title must be a nonempty string of at most 100 characters.');
  if (!nonempty(parsed.goal, 240)) errors.push('goal must be a nonempty string of at most 240 characters.');
  if (!Array.isArray(parsed.days) || parsed.days.length !== requestedDays) {
    errors.push(`days must contain exactly ${requestedDays} entries.`);
  }
  if (Array.isArray(parsed.days)) {
    parsed.days.forEach((entry: unknown, index: number) => {
      const label = `days[${index}]`;
      if (!object(entry)) { errors.push(`${label} must be an object.`); return; }
      for (const key of Object.keys(entry)) if (!['day', 'focus', 'activity', 'minutes'].includes(key)) errors.push(`Unexpected ${label} field: ${key}.`);
      if (entry.day !== index + 1) errors.push(`${label}.day must be ${index + 1}.`);
      if (!nonempty(entry.focus, 100)) errors.push(`${label}.focus must be a nonempty string of at most 100 characters.`);
      if (!nonempty(entry.activity, 300)) errors.push(`${label}.activity must be a nonempty string of at most 300 characters.`);
      if (!Number.isInteger(entry.minutes) || (entry.minutes as number) < 1 || (entry.minutes as number) > minutesPerDay) errors.push(`${label}.minutes must be an integer from 1 to ${minutesPerDay}.`);
    });
  }
  if (errors.length) return { valid: false, plan: null, errors };
  return { valid: true, plan: parsed as StudyPlan, errors: [] };
}

export function studyPlanInstructions(days: number, minutesPerDay: number): string {
  return `Create a practical study plan. Output ONLY one JSON object, with no Markdown fences or prose. Exact shape: {"title":"string","goal":"string","days":[{"day":1,"focus":"string","activity":"string","minutes":number}]}. Include exactly ${days} days, numbered 1 through ${days} in order. Each activity must be concrete and achievable. Each minutes value must be an integer from 1 to ${minutesPerDay}. Keep title at most 100 characters, goal at most 240, focus at most 100, and activity at most 300. Do not add fields.`;
}
