# Revenue report contract

LAB34_REFERENCE_READ

Return only JSON with these fields:

- `total_cents`: the exact sum of units multiplied by price_cents for all products.
- `currency`: `EUR`.
- `source`: `data/sales.csv`.
- `marker`: the trimmed contents of the supplied run-marker file.

The CSV has the header `product,units,price_cents`, no quoted fields, and nonnegative integer quantities and prices. Never round through binary floating point or invent missing values.
