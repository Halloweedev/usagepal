# Share model costs need embedded $ or provider-total derivation

Share’s model table only shows Today / 7d / 30d dollars from each model breakdown value (e.g. `65% · Today $8.00 · …`). Overview can also derive `provider Today total × model %` for percent-only rows; Share now does the same via `enrichModelBreakdownParsed` + `modelCostBasis` from the provider’s full probe lines (not just checked card lines — Models preset omits detail-scoped Today / Last 30 Days).

Plugin notes:
- Codex/Claude ccusage: prefer `modelBreakdowns[].cost`; else split day `costUSD`/`totalCost` across `models` by token share.
- Cursor: imputes CSV row costs from `CURSOR_PRICING`; Today/7d windows must use UTC day keys to match CSV ISO dates. Unknown slugs → $0 on the model line; Share still fills Today/30d from the provider totals when present.
- 7d is never derived on Share (no provider-level 7d summary); plugins must embed it.
