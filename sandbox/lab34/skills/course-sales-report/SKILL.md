---
name: course-sales-report
description: Summarize product revenue from a CSV with product, units, and price_cents columns using exact integer-cent arithmetic. Use for sales revenue reporting, not general questions or unrelated file tasks.
---

# Course sales report

LAB34_SKILL_READ

For a revenue report, read [the report contract](references/report-contract.md). Run the bundled helper with the supplied CSV and run-marker paths:

```sh
node /opt/lab34/skills/course-sales-report/scripts/report.mjs /workspace/data/sales.csv /workspace/run-marker.txt
```

The helper reads inputs and prints JSON; it does not write a report. Inspect its result and return the JSON required by the contract. Keep amounts in integer cents. Do not modify the CSV. Only load this skill for a relevant revenue-report task.
