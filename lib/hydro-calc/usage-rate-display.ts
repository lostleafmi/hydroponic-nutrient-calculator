/**
 * Whether the calculator's final formulation screen prints usage rates —
 * mL of stock per gallon/liter, injector draw rates, grams of a dry batch per
 * gallon/liter of irrigation water.
 *
 * Off: a rate is something the grower applies on a feeding day, so it belongs
 * to the Feeding Scheduler rather than to the formulation printout. The rates
 * are still computed and still travel in full inside every saved formulation
 * and feeding-schedule entry (`usageRates`, `defaultStockTankSize`,
 * `dilutionRatio`, `directAddCalciumCarbonate`) — see
 * `buildFormulationTanksData` — so the Scheduler's Usage Rates and Stock Tanks
 * views fill in exactly as before. This gates presentation only; nothing
 * behind it may change a salt amount, an elemental target or a save payload.
 *
 * Typed as `boolean` rather than left to literal inference so the gated JSX
 * stays type-checked while the flag is off.
 */
export const SHOW_CALCULATOR_USAGE_RATES: boolean = false
