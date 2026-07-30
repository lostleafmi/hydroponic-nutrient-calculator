import type { PartAnalysis } from "@/components/hydro-calc/guaranteed-analysis-screen"
import type { NutrientPart, StockTankOption } from "@/components/hydro-calc/feeding-rates-screen"

/**
 * Client-safe types, constants, and display/formatting helpers for the
 * hydroponic recipe calculator.
 *
 * IMPORTANT: This module must never contain the actual recipe-solving
 * algorithms (elemental target derivation, salt-amount solving, EC
 * estimation, etc). Those live in `lib/hydro-calc/recipe-calculator.ts`,
 * which is a server-only module invoked exclusively through Server Actions
 * (see `app/actions/calculate-recipe.ts`) so the proprietary solver logic is
 * never shipped to the browser.
 */

/** Typical liquid nutrient concentrate density (g/mL) */
export const LIQUID_CONCENTRATE_DENSITY = 1.2

/**
 * US gallons → liters, exact. Every gallon↔liter hop in the calculator goes
 * through this one constant so a rate quoted per gallon and a concentration
 * quoted per liter can never disagree by a rounded conversion.
 */
export const LITERS_PER_GALLON = 3.785411784

/** US gallons → millilitres — `LITERS_PER_GALLON` in the unit stock doses are measured in */
export const ML_PER_GALLON = LITERS_PER_GALLON * 1000

/**
 * Which volume of water the grower measures against — their feed chart's
 * rates, their stock tank size, and the mL-per-water usage rate all quote a
 * volume, and this is the one preference all three follow.
 *
 * `"liters"` does NOT mean "per litre" everywhere it's applied, and the
 * difference is deliberate rather than an oversight. The feed chart input is
 * read per 10 L, because that's the figure a metric chart prints (see
 * `CHART_DOSE_LITERS` and `DoseUnit`). The stock tank's usage rate is read per
 * litre, because that's a dilution the grower measures out themselves with no
 * chart to copy from. Only the chart entry follows the printed convention; ask
 * `doseUnitLiters` rather than assuming a unit implies its own name.
 *
 * It is a display and input basis only. Everything the solver sees is still
 * canonical: volumes in liters (`stockVolumeLiters`) and feed rates
 * normalized to grams per US gallon (`getDoseGramsPerGallon`).
 */
export type VolumeUnit = "gallons" | "liters"

/**
 * How many litres of water a metric feed chart quotes its rates against.
 *
 * Athena, Canna and every other metric chart a grower is likely to be holding
 * print "29 mL per 10 L", not a per-litre figure — a per-litre column would be
 * a string of decimals for the small bottles. Typing what the chart prints is
 * the whole point of that screen, so 10 L is the basis the liters-mode input
 * reads in, and the division to per-litre happens here rather than in the
 * grower's head.
 */
export const CHART_DOSE_LITERS = 10

/**
 * A feed-chart dose as the grower typed it: mL for a liquid concentrate or
 * grams for a dry powder, quoted against whatever volume of working
 * (reservoir) solution the chart it was copied from uses.
 *
 * The two per-gallon values came first and are still what a save written
 * before the volume preference existed carries, so they stay spelled exactly
 * as they were. `ml_per_liter` / `g_per_liter` are likewise frozen: they're
 * what the first liters-mode saves wrote, before the input moved to the per-10 L
 * basis metric charts actually print, and they still mean a true per-litre
 * rate. Nothing writes them any more — a load re-quotes them onto the per-10 L
 * pair (see `migrateLegacyDoseUnit`) — but they must keep parsing.
 */
export type DoseUnit =
  | "ml_per_gallon"
  | "g_per_gallon"
  | "ml_per_10L"
  | "g_per_10L"
  | "ml_per_liter"
  | "g_per_liter"

/** Whether a dose is measured out as liquid millilitres rather than dry grams. */
export function isLiquidDoseUnit(unit: DoseUnit): boolean {
  return unit === "ml_per_gallon" || unit === "ml_per_10L" || unit === "ml_per_liter"
}

/**
 * Litres of working solution one entered dose covers — the denominator behind
 * the unit, and the only thing that separates the three bases from each other.
 *
 * Every conversion a dose goes through (to the solver's per-gallon basis, and
 * between units when the grower flips the toggle) is a ratio of these, so a
 * dose can't mean one volume on screen and another in the recipe.
 */
export function doseUnitLiters(unit: DoseUnit): number {
  switch (unit) {
    case "ml_per_gallon":
    case "g_per_gallon":
      return LITERS_PER_GALLON
    case "ml_per_10L":
    case "g_per_10L":
      return CHART_DOSE_LITERS
    case "ml_per_liter":
    case "g_per_liter":
      return 1
  }
}

/** The volume of solution a dose is quoted against. */
export function doseUnitVolumeUnit(unit: DoseUnit): VolumeUnit {
  return unit === "ml_per_gallon" || unit === "g_per_gallon" ? "gallons" : "liters"
}

/**
 * The dose unit for a given measure and volume basis — the pair the feed
 * chart input actually offers, so liters means the per-10 L chart basis rather
 * than the legacy per-litre one.
 */
export function doseUnitFor(measure: "ml" | "g", volumeUnit: VolumeUnit): DoseUnit {
  if (measure === "ml") return volumeUnit === "liters" ? "ml_per_10L" : "ml_per_gallon"
  return volumeUnit === "liters" ? "g_per_10L" : "g_per_gallon"
}

/** Re-quote a dose unit against another volume, keeping mL vs g as it was. */
export function rebaseDoseUnit(unit: DoseUnit, volumeUnit: VolumeUnit): DoseUnit {
  return doseUnitFor(isLiquidDoseUnit(unit) ? "ml" : "g", volumeUnit)
}

/** The volume a dose unit is quoted against, as it reads on screen: `gal`, `10 L`, `L`. */
export function doseUnitVolumeLabel(unit: DoseUnit): string {
  if (doseUnitVolumeUnit(unit) === "gallons") return volumeUnitShortLabel("gallons")
  const liters = doseUnitLiters(unit)
  return liters === 1 ? "L" : `${liters} L`
}

/** How a dose unit reads on screen, e.g. `g/gal` or `ml/10 L`. */
export function doseUnitLabel(unit: DoseUnit): string {
  const measure = isLiquidDoseUnit(unit) ? "ml" : "g"
  return `${measure}/${doseUnitVolumeLabel(unit)}`
}

/** Unit suffix for a rate or tank size, e.g. `gal` or `L`. */
export function volumeUnitShortLabel(unit: VolumeUnit): string {
  return unit === "liters" ? "L" : "gal"
}

/** The unit spelled out for prose, e.g. "per <b>gallon</b> of reservoir water". */
export function volumeUnitNoun(unit: VolumeUnit, plural = false): string {
  const noun = unit === "liters" ? "liter" : "gallon"
  return plural ? `${noun}s` : noun
}

/**
 * The feed chart's own basis spelled out for prose, e.g. "per <b>10 litres of
 * water</b>". Deliberately not `volumeUnitNoun`: the metric chart input is read
 * per 10 L (see `CHART_DOSE_LITERS`), and prose that says "per liter" beside it
 * is telling the grower to divide a number they should be copying across.
 */
export function chartDoseVolumePhrase(volumeUnit: VolumeUnit): string {
  return volumeUnit === "liters" ? `${CHART_DOSE_LITERS} liters of water` : "gallon"
}

/**
 * How close a rewritten number has to stay to the exact conversion: 0.001%,
 * orders of magnitude finer than any scale or measuring jug a grower mixes
 * with, and finer than the printed recipe resolves to.
 */
const CONVERTED_AMOUNT_TOLERANCE = 1e-5

/**
 * The shortest way to write a converted value that's still the same number to
 * within `CONVERTED_AMOUNT_TOLERANCE`.
 *
 * Significant digits rather than decimal places, because these values span a
 * 0.066 g/L micro dose to a 378 L tank and any fixed decimal count is too
 * coarse at one end or noise at the other. Taking the shortest form inside the
 * tolerance is also what lets a unit flip round-trip: 5 gal becomes 18.927 L,
 * and 18.927 L comes back as 5 rather than 4.9999, because "5" is itself
 * within tolerance of the exact 4.99998.
 */
function formatConvertedAmount(value: number): string {
  if (!Number.isFinite(value)) return ""
  const allowedError = Math.abs(value) * CONVERTED_AMOUNT_TOLERANCE
  for (let digits = 2; digits < 8; digits++) {
    const candidate = Number(value.toPrecision(digits))
    if (Math.abs(candidate - value) <= allowedError) return String(candidate)
  }
  return String(Number(value.toPrecision(8)))
}

/**
 * Convert what's in a numeric input between volume units, leaving anything
 * that isn't a number the grower can see — an empty field, a lone "." or "-"
 * part-way through typing — exactly as it was. Writing a `0` into a field the
 * grower hasn't filled in yet would read as a real entered dose.
 */
function convertInputValue(value: string, factor: number): string {
  const trimmed = value.trim()
  if (trimmed === "") return value
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed === 0) return value
  return formatConvertedAmount(parsed * factor)
}

/** Re-express a volume (a tank or reservoir size) in another unit. */
export function convertVolumeValue(value: string, from: VolumeUnit, to: VolumeUnit): string {
  if (from === to) return value
  return convertInputValue(value, to === "liters" ? LITERS_PER_GALLON : 1 / LITERS_PER_GALLON)
}

/**
 * Re-quote a feed-chart dose against another unit's volume, so flipping the
 * toggle changes what the number is measured against and not how much
 * concentrate the plants end up seeing: 4 g/gal becomes 10.567 g/10 L, the same
 * feed either way.
 *
 * The factor is the ratio of the two units' litres (see `doseUnitLiters`), so
 * every hop — including gal ↔ 10 L, which is neither a plain 3.785 nor a plain
 * 10 — comes off the one `LITERS_PER_GALLON` and the one `CHART_DOSE_LITERS`
 * the solver uses.
 */
export function convertDoseValue(value: string, from: DoseUnit, to: DoseUnit): string {
  if (from === to) return value
  return convertInputValue(value, doseUnitLiters(to) / doseUnitLiters(from))
}

/**
 * A saved dose on the unit pair the feed chart input reads today.
 *
 * The liters input used to be per-litre and now matches what metric charts
 * print, per 10 L (see `CHART_DOSE_LITERS`). A save carrying the old unit means
 * a true per-litre rate, so the number is re-quoted rather than relabelled —
 * relabelling would silently make every reloaded metric formulation a tenth as
 * strong. Anything already on a current unit is returned untouched.
 */
export function migrateLegacyDoseUnit(
  dose: string,
  unit: DoseUnit
): { dose: string; unit: DoseUnit } {
  if (unit !== "ml_per_liter" && unit !== "g_per_liter") return { dose, unit }
  const migrated = rebaseDoseUnit(unit, "liters")
  return { dose: convertDoseValue(dose, unit, migrated), unit: migrated }
}

/**
 * Stock tank size a fresh session starts on, per unit.
 *
 * A gallons default converted straight across lands on 18.927 L, which is not a
 * tank anybody sells or a number anybody types. Both entries are the round size
 * of that unit's common tank, and `convertStockTankSize` swaps one for the
 * other while the grower hasn't touched the field — so the flip round-trips
 * exactly (5 → 20 → 5) instead of drifting through a conversion.
 */
export const DEFAULT_STOCK_TANK_SIZE: Record<VolumeUnit, string> = {
  gallons: "5",
  liters: "20",
}

/**
 * Size the direct-mix layout starts on, per unit.
 *
 * Direct mix has no stock tank — the field is the batch of feed itself — so it
 * starts from a single gallon's worth. Converted straight across that's
 * 3.785 L; 5 L is the round batch a metric grower actually mixes, and the one
 * every "per 5 L" bottle of pH Down is marked for.
 */
export const DIRECT_MIX_RESERVOIR_SIZE: Record<VolumeUnit, string> = {
  gallons: "1",
  liters: "5",
}

/**
 * Every size the volume field starts a session on, so a unit flip can swap one
 * unit's round default for the other's rather than converting it.
 *
 * No two rows may carry the same value for the same unit: the unit being
 * converted *from* is the only thing identifying which row an untouched default
 * belongs to. (Gallons reads 5 and 1, liters 20 and 5 — the repeated 5 means
 * different things in different columns, which is exactly why the lookup is by
 * column rather than by value.)
 */
const ROUND_DEFAULT_SIZES: Array<Record<VolumeUnit, string>> = [
  DEFAULT_STOCK_TANK_SIZE,
  DIRECT_MIX_RESERVOIR_SIZE,
]

/**
 * `convertVolumeValue` for the tank/reservoir size field, substituting the
 * other unit's round default (see `ROUND_DEFAULT_SIZES`) for a size the grower
 * hasn't changed. A size they did type is theirs, and is converted like any
 * other volume.
 */
export function convertStockTankSize(value: string, from: VolumeUnit, to: VolumeUnit): string {
  if (from === to) return value
  const trimmed = value.trim()
  const untouched = ROUND_DEFAULT_SIZES.find((sizes) => sizes[from] === trimmed)
  if (untouched) return untouched[to]
  return convertVolumeValue(value, from, to)
}

/** Guaranteed-analysis oxide → elemental conversion factors */
export const P2O5_TO_P = 30.974 / 70.974 // ≈ 0.436
export const K2O_TO_K = 78.169 / 94.196 // ≈ 0.830

export interface ElementalTargets {
  nitrogen: number
  phosphorus: number
  potassium: number
  calcium: number
  magnesium: number
  sulfur: number
  iron: number
  manganese: number
  zinc: number
  boron: number
  copper: number
  molybdenum: number
}

export type MicroKey = "iron" | "manganese" | "zinc" | "boron" | "copper" | "molybdenum"

export const MICRO_KEYS: MicroKey[] = [
  "iron",
  "manganese",
  "zinc",
  "boron",
  "copper",
  "molybdenum",
]

/**
 * Micros allowed to anchor an estimate of the missing ones, in preference
 * order (see `applyMicroEstimates`).
 *
 * Molybdenum is deliberately excluded. Estimating from an anchor means
 * dividing it by its Fe ratio, so the anchor's own rounding error is
 * multiplied by the inverse of that ratio — and Mo sits at 1/1200 of Fe.
 * A label declaring "Mo 0.001%" (already at its printed precision) dosed at
 * 5 g/gal therefore back-derived ~15.9 ppm Fe and ~4.5 ppm Mn out of thin
 * air. The remaining five micros stay within ~18× of Fe, close enough that
 * a declared value carries real signal about the rest of the package.
 */
export const MICRO_ANCHOR_KEYS: MicroKey[] = ["iron", "manganese", "zinc", "boron", "copper"]

export const MICRO_LABELS: Record<MicroKey, string> = {
  iron: "Iron",
  manganese: "Manganese",
  zinc: "Zinc",
  boron: "Boron",
  copper: "Copper",
  molybdenum: "Molybdenum",
}

/**
 * Element-to-Fe ratios for filling in missing micronutrients. Used by the
 * server-side solver (`applyMicroEstimates`); kept here only because the
 * type it configures (`MicroKey`) lives in this shared module.
 */
export const MICRO_TO_FE_RATIO: Record<MicroKey, number> = {
  iron: 1,
  manganese: 1 / 3.5,
  zinc: 1 / 7,
  boron: 1 / 9,
  copper: 1 / 18,
  molybdenum: 1 / 1200,
}

/**
 * Iron ppm for the standard balanced micro profile used when a label declares
 * a micro package but nothing that can anchor a ratio estimate — in practice a
 * Molybdenum-only label (see `MICRO_ANCHOR_KEYS` and `applyMicroEstimates`).
 *
 * A mid-range hydroponic Iron target, chosen as an absolute value rather than
 * back-derived from the declared micro. Fanned out through
 * `MICRO_TO_FE_RATIO` it puts the rest of the package inside the usual
 * hydroponic ranges (Mn ≈ 0.71, Zn ≈ 0.36, B ≈ 0.28, Cu ≈ 0.14 ppm), so the
 * profile stays consistent with the ratios the rest of the calculator uses.
 */
export const DEFAULT_MICRO_PROFILE_IRON_PPM = 2.5

/**
 * How the estimated micro values were arrived at:
 * - `anchor` — scaled off a declared micro (`EstimatedTargets.anchor`)
 * - `default-profile` — the standard balanced profile
 *   (`DEFAULT_MICRO_PROFILE_IRON_PPM`), used when the label declares only
 *   micros that can't anchor a ratio estimate
 * - `none` — nothing was estimated (the label declared no micros at all)
 */
export type MicroEstimateSource = "anchor" | "default-profile" | "none"

export interface EstimatedTargets {
  targets: ElementalTargets
  estimated: Set<MicroKey>
  /**
   * Element the missing micros were scaled off (see `MICRO_ANCHOR_KEYS`);
   * null when the label declared no micro usable as an anchor.
   */
  anchor: MicroKey | null
  /**
   * Micros the label did declare but which can't anchor an estimate (i.e.
   * Molybdenum). Only ever non-empty when `anchor` is null — lets the UI name
   * them when explaining why the balanced default profile was used instead.
   */
  unanchoredMicros: MicroKey[]
  estimateSource: MicroEstimateSource
}

export interface SaltAmounts {
  calciumNitrate: number
  calciumCarbonate: number
  calciumChloride: number
  potassiumNitrate: number
  urea: number
  monoPotassiumPhosphate: number
  monoAmmoniumPhosphate: number
  magnesiumSulfate: number
  magnesiumNitrate: number
  potassiumSulfate: number
  ammoniumNitrate: number
  ammoniumSulfate: number
  ironDTPA: number
  manganeseEDTA: number
  zincEDTA: number
  boricAcid: number
  copperEDTA: number
  sodiumMolybdate: number
}

/** An element target that couldn't be (fully) matched with the currently-enabled salts */
export interface SaltGapWarning {
  element: keyof ElementalTargets
  label: string
}

export const ELEMENT_LABELS: Record<keyof ElementalTargets, string> = {
  nitrogen: "Nitrogen",
  phosphorus: "Phosphorus",
  potassium: "Potassium",
  calcium: "Calcium",
  magnesium: "Magnesium",
  sulfur: "Sulfur",
  ...MICRO_LABELS,
}

/**
 * An element where the recipe's resolved salt amounts can't quite reproduce
 * the label-derived target, reported with both numbers so the grower sees the
 * real gap rather than a target the tanks don't actually deliver.
 *
 * Unlike `SaltGapWarning` — "no checked salt supplies this element at all" —
 * this covers targets that are unreachable *as a set*: every salt carries two
 * or more elements at a fixed ratio, so a label whose own ratios can't be
 * built from the checked salts leaves a residue no amount of rebalancing can
 * remove. A guaranteed analysis listing more Nitrogen per unit Calcium than
 * Ca(NO₃)₂ itself contains, with no second Nitrogen source checked, is the
 * common example.
 */
export interface TargetDeviation {
  element: keyof ElementalTargets
  label: string
  /** ppm the guaranteed-analysis percentages and feed rates asked for */
  targetPpm: number
  /** ppm the resolved salt amounts actually deliver */
  deliveredPpm: number
}

/**
 * How close a delivered ppm has to land to its label-derived target to count
 * as matched, as a fraction of that target.
 *
 * This band does double duty: it decides when the recipe owes the grower a
 * `TargetDeviation`, and it sets how hard the solver's refinement pass fights
 * for each element (each weighted by 1/tolerance², so error is minimized in
 * units of "how much does this element actually care"). Keeping both off one
 * table means the solver is never told to chase an accuracy the UI wouldn't
 * have complained about, and never settles for one it would.
 *
 * Sulfur's band is deliberately the loose one. Hydroponic plants tolerate a
 * wide Sulfur range, and Sulfur is never a salt's reason for being in a recipe
 * — it rides along with the Magnesium in MgSO₄ and the Potassium in K₂SO₄. Held
 * as tightly as Nitrogen, it would drag Nitrogen, Calcium, and Potassium off
 * targets those salts *can* hit exactly, just to close a Sulfur gap the plants
 * won't notice. Wide enough to yield to the other five, still tight enough
 * that a real shortfall pulls in the sulfate salt the grower checked.
 */
const ELEMENT_MATCH_TOLERANCE_FRACTION: Partial<Record<keyof ElementalTargets, number>> = {
  sulfur: 0.05,
}

export const DEFAULT_MATCH_TOLERANCE_FRACTION = 0.02

/** Floor on a declared target's tolerance, so trace targets stay reachable */
export const MATCH_TOLERANCE_FLOOR_PPM = 0.5

/**
 * Tolerance applied to an element the label declares nothing of. Tighter than
 * any real target's band: "this product contains no Calcium" should read as a
 * near-constraint, so the refinement can't quietly add Calcium via Ca(NO₃)₂
 * because it wanted the Nitrogen.
 */
export const ZERO_TARGET_TOLERANCE_PPM = 1

export function matchTolerancePpm(element: keyof ElementalTargets, targetPpm: number): number {
  if (!(targetPpm > 0)) return ZERO_TARGET_TOLERANCE_PPM
  const fraction = ELEMENT_MATCH_TOLERANCE_FRACTION[element] ?? DEFAULT_MATCH_TOLERANCE_FRACTION
  return Math.max(MATCH_TOLERANCE_FLOOR_PPM, targetPpm * fraction)
}

export function isWithinMatchTolerance(
  element: keyof ElementalTargets,
  deliveredPpm: number,
  targetPpm: number
): boolean {
  return Math.abs(deliveredPpm - targetPpm) <= matchTolerancePpm(element, targetPpm)
}

/**
 * Records when the solver reached for a salt the user didn't check on Step
 * 1 because it was the only practical way to fully match an elemental
 * target — see the Potassium fallback in `calculateStockTankRecipe`. Unlike
 * `SaltGapWarning` (which tells the grower "we couldn't match this, go
 * check more salts"), this is a user-friendly failsafe: rather than leaving
 * the target unmet and asking the grower to understand salt chemistry, the
 * solver quietly completes the recipe with a common, easy-to-source salt
 * and simply informs them what it did and why.
 */
export interface SaltAutoAddNote {
  element: keyof ElementalTargets
  elementLabel: string
  saltKey: SaltKey
  saltLabel: string
}

/**
 * Calcium Carbonate (CaCO₃) is essentially insoluble at stock-tank
 * concentrations — see the note in `calculateStockTankRecipe` — so it's
 * never assigned into a stock tank's `SaltAmounts`, even when the user
 * selects it and it's counted toward meeting the Calcium target. Instead
 * every recipe surfaces it here as a "dump straight into the reservoir /
 * batch tank" amount, separate from anything meant to be dissolved into a
 * concentrated stock solution.
 */
export interface DirectAddCalciumCarbonate {
  /** Total grams for one full stock-tank refill's worth of nutrients (same denominator as the accompanying tank amounts) */
  grams: number
  /** Grams to add per US gallon of reservoir/batch water — the actionable dosing rate, independent of stock tank size or dilution ratio */
  gramsPerGallon: number
  /** Grams to add per liter of reservoir/batch water */
  gramsPerLiter: number
}

/** Build the reservoir-relative dosing rate from a raw gram amount, or `undefined` when there's nothing to add. */
export function buildDirectAddCalciumCarbonate(
  grams: number,
  stockVolumeLiters: number,
  dilutionRatio: number
): DirectAddCalciumCarbonate | undefined {
  if (!(grams > 0)) return undefined
  const reservoirLiters = stockVolumeLiters * dilutionRatio
  if (!(reservoirLiters > 0)) return undefined
  const gramsPerLiter = grams / reservoirLiters
  return {
    grams,
    gramsPerLiter,
    gramsPerGallon: gramsPerLiter * LITERS_PER_GALLON,
  }
}

/** Combine two direct-add amounts computed at the same stock volume/ratio (e.g. summing per-part contributions). */
export function combineDirectAddCalciumCarbonate(
  a: DirectAddCalciumCarbonate | undefined,
  b: DirectAddCalciumCarbonate | undefined
): DirectAddCalciumCarbonate | undefined {
  if (!a) return b
  if (!b) return a
  return {
    grams: a.grams + b.grams,
    gramsPerGallon: a.gramsPerGallon + b.gramsPerGallon,
    gramsPerLiter: a.gramsPerLiter + b.gramsPerLiter,
  }
}

/**
 * Convert a literal feed-rate dose — grams of a raw salt per US gallon of
 * working (reservoir) feed — into the grams needed for one full stock-tank
 * refill at the given volume/ratio. This is the inverse of
 * `buildDirectAddCalciumCarbonate`'s `gramsPerGallon` calc: since
 * `reservoirLiters = stockVolumeLiters * dilutionRatio`,
 *   grams = gramsPerGallon * reservoirLiters / LITERS_PER_GALLON.
 *
 * Unlike most of the solver, a dose passed through this function is NOT
 * derived from an elemental ppm target — it's a real, physically-measured
 * amount the user is telling us to mix in (e.g. a Calcium Chloride top-up
 * dose from a product's own instructions, or Calcium Nitrate's own
 * feed-chart dose when it's the sole salt behind a part — see
 * `isCalciumNitrateSoleDoseSource`) — so the conversion here is a straight
 * unit conversion rather than a target-matching calculation.
 */
export function gramsFromFeedRatePerGallon(
  gramsPerGallon: number,
  stockVolumeLiters: number,
  dilutionRatio: number
): number {
  if (!(gramsPerGallon > 0) || stockVolumeLiters <= 0 || dilutionRatio <= 0) return 0
  const reservoirLiters = stockVolumeLiters * dilutionRatio
  return (gramsPerGallon * reservoirLiters) / LITERS_PER_GALLON
}

/**
 * Elemental ppm in the final working (reservoir) solution contributed by a
 * literal feed-rate dose of `gramsPerGallon` of a salt that is
 * `elementFraction` (by weight) the target element.
 *
 *   ppm (mg/L) = (gramsPerGallon / LITERS_PER_GALLON) [g/L] × elementFraction × 1000 [mg/g]
 *
 * This is a plain unit conversion, not a solve — notably it does NOT depend
 * on stock volume or dilution ratio, because ppm is a working-solution
 * concentration: it's the same no matter how the stock tank sizing is set
 * up (see `gramsFromFeedRatePerGallon` for the stock-tank-relative amount,
 * which DOES depend on those).
 */
export function elementalPpmFromDosePerGallon(gramsPerGallon: number, elementFraction: number): number {
  if (!(gramsPerGallon > 0) || elementFraction <= 0) return 0
  return (gramsPerGallon / LITERS_PER_GALLON) * elementFraction * 1000
}

/**
 * Elemental Calcium ppm contributed by a Calcium Chloride g/gal dose (see
 * `elementalPpmFromDosePerGallon`). Calcium Chloride's optional per-gallon
 * amount (entered on the Guaranteed Analysis screen) is a raw salt addition
 * separate from any %-based guaranteed-analysis field, so this is the only
 * place its Calcium ends up counted toward the overall Calcium target —
 * see `calculateElementalTargets`.
 */
export function calciumChlorideElementalCalciumPpm(gramsPerGallon: number): number {
  return elementalPpmFromDosePerGallon(gramsPerGallon, RAW_SALTS.calciumChloride.ca)
}

/**
 * Element ppm in the final working solution from a single % (by weight) in
 * the concentrate. ppm = (% / 100) × g concentrate per L × 1000 mg/g.
 *
 * This is the same unit conversion `calculateElementalTargets` applies to
 * every guaranteed-analysis field (N, P₂O₅, K₂O, Ca, Mg, S, micros) — kept
 * here (rather than duplicated in the server-only solver) so
 * `ureaNitrogenPpmForPart` below, and any other client-safe %-based
 * calculation, can share it.
 */
export function percentToPpm(percent: number, concentrateGramsPerLiter: number): number {
  return (percent / 100) * concentrateGramsPerLiter * 1000
}

/**
 * Elemental Nitrogen ppm contributed by a part's own "% Urea Nitrogen"
 * field (the value listed on the label, e.g. "Urea Nitrogen 46%") — only
 * meaningful when that part has Urea checked in "Salts & Inputs Included".
 * Uses the same %-to-ppm conversion as the main Guaranteed Analysis %N
 * field (see `percentToPpm`), scaled by this part's own dose (via
 * `getConcentrateGramsPerLiter`), so it folds into the overall Nitrogen
 * target the same way Calcium Chloride's dose folds into the Calcium
 * target — see `calculateElementalTargets`.
 */
export function ureaNitrogenPpmForPart(part: NutrientPart, analysis: PartAnalysis): number {
  if (!analysis.includedSalts?.urea) return 0
  const concentrateGramsPerLiter = getConcentrateGramsPerLiter(part)
  if (concentrateGramsPerLiter <= 0) return 0
  return percentToPpm(parsePositive(analysis.ureaNitrogenPercent), concentrateGramsPerLiter)
}

/**
 * Sum every part's Urea-Nitrogen ppm contribution (see
 * `ureaNitrogenPpmForPart`). Used alongside `unionIncludedSalts` by the
 * recipe layouts that recombine nutrients across parts by chemistry rather
 * than by bottle (Separate Nitrogen, Direct Mix, EC estimate), so a %
 * Urea Nitrogen entered on any part still applies to those combined
 * recipes — mirroring `sumCalciumChlorideGramsPerGallon`.
 */
export function sumUreaNitrogenPpm(partsAnalysis: PartAnalysis[], parts: NutrientPart[]): number {
  const partsById = new Map(parts.map((part) => [part.id, part]))
  return partsAnalysis.reduce((total, analysis) => {
    const part = partsById.get(analysis.id)
    if (!part) return total
    return total + ureaNitrogenPpmForPart(part, analysis)
  }, 0)
}

export interface TankRecipe {
  tankA: SaltAmounts
  tankB: SaltAmounts
  /** Targets that couldn't be matched because the salt that would supply them is unchecked */
  warnings?: SaltGapWarning[]
  /** True when one or more targets couldn't be perfectly matched with the enabled salts */
  isApproximate?: boolean
  /** Calcium Carbonate needed for this recipe, to add directly to the reservoir/batch tank instead of into tankA/tankB */
  directAddCalciumCarbonate?: DirectAddCalciumCarbonate
  /** Salts the solver added on the grower's behalf to fully match a target — see `SaltAutoAddNote`. */
  autoAddedSalts?: SaltAutoAddNote[]
  /**
   * Elemental ppm `tankA` + `tankB` (+ `directAddCalciumCarbonate`) ACTUALLY
   * deliver to the reservoir — see `elementalPpmFromSaltAmounts`. This, not the
   * label-derived target set the solver was handed, is what the grower's plants
   * will see, so it's what the "What your plants will get" panel displays.
   */
  delivered: ElementalTargets
  /** Elements where `delivered` can't reach the label-derived target — see `TargetDeviation`. */
  deviations: TargetDeviation[]
}

/**
 * What a Separate Nitrogen tank is for, which is what decides its label, its
 * mixing note, and whether it can be tapered.
 *
 *  - `"calcium"` — every part's Calcium salts, pooled into the one tank that
 *    must stay clear of phosphate and sulfate at stock strength (see
 *    `TANK_1_SALTS`), and with them every Nitrogen salt the grower would taper
 *    (see `TAPERABLE_NITROGEN_SALTS`). This is the Nitrogen tank: Ca(NO₃)₂'s
 *    own Nitrogen can't be moved without its Calcium, so gathering the rest of
 *    the recipe's Nitrogen beside it is what turns a taper into one dial
 *    instead of several.
 *  - `"non-calcium"` — the macro salts that can't share a tank with
 *    concentrated Calcium (see `CALCIUM_INCOMPATIBLE_SALTS`): the phosphates
 *    and sulfates a grower feeds for their Phosphorus, Potassium, Magnesium and
 *    Sulfur, which a Nitrogen taper leaves alone. The micronutrients ride in
 *    one of these, since that's the side of the recipe a taper doesn't reach.
 *
 * There is deliberately no micronutrient role: a micros-only stock tank is
 * never the answer here. See `placeMicronutrients` for the order of preference.
 */
export type SeparateNitrogenTankRole = "calcium" | "non-calcium"

/**
 * Salts whose only nutrient job in a recipe is Nitrogen, give or take a
 * companion cation that carries no phosphate or sulfate — so they can all be
 * gathered into the tank holding the Calcium Nitrate, giving the grower one
 * dial to turn when tapering (see `pourTaperableNitrogenIntoCalciumTank`).
 *
 * Calcium Nitrate is deliberately absent because it doesn't need moving: it
 * defines where that tank is (`TANK_1_SALTS`). Its Nitrogen is the one share
 * that can't be tapered on its own — cutting it means cutting Calcium too —
 * which is precisely why the rest of the Nitrogen belongs beside it rather than
 * in a second tank the grower would have to cut in step.
 *
 * MAP and Ammonium Sulfate are absent for the opposite reason: their Nitrogen
 * is a side effect of supplying Phosphorus or Sulfur, so nobody cuts them to
 * move Nitrogen — and they'd precipitate the Calcium anyway (see
 * `CALCIUM_INCOMPATIBLE_SALTS`).
 */
export const TAPERABLE_NITROGEN_SALTS = [
  "potassiumNitrate",
  "ammoniumNitrate",
  "magnesiumNitrate",
  "urea",
] as const satisfies readonly SaltKey[]

/** True when this salt contributes elemental Nitrogen. */
export function saltCarriesNitrogen(key: SaltKey): boolean {
  const composition: Record<string, unknown> = RAW_SALTS[key]
  return typeof composition.n === "number" && composition.n > 0
}

/**
 * True when any salt in `salts` contributes Nitrogen at all — so dialling this
 * tank back moves the recipe's Nitrogen to some degree. A tank that fails this
 * is Nitrogen-free, which makes it the natural home for the micronutrients:
 * nothing about a Nitrogen taper reaches it (see `placeMicronutrients`).
 */
export function saltAmountsCarryNitrogen(salts: SaltAmounts): boolean {
  return SALT_DISPLAY_ORDER.some((key) => salts[key] > 0 && saltCarriesNitrogen(key))
}

/**
 * True when `salts` holds Nitrogen the grower would actually reach for to
 * taper (see `TAPERABLE_NITROGEN_SALTS`) — the tanks micronutrients have to
 * stay out of.
 *
 * Weaker than `saltAmountsCarryNitrogen` on purpose. A tank whose only Nitrogen
 * arrives inside Calcium Nitrate or MAP isn't where a grower cuts Nitrogen:
 * they'd be giving up the Calcium or the Phosphorus they bought that salt for.
 * So it's a perfectly good home for micros when no Nitrogen-free tank exists,
 * which is what keeps the layout from spending a whole tank on the micro
 * package (see `placeMicronutrients`).
 */
export function saltAmountsCarryTaperableNitrogen(salts: SaltAmounts): boolean {
  return TAPERABLE_NITROGEN_SALTS.some((key) => salts[key] > 0)
}

/**
 * Whether `grams` of one salt stays in solution in a single tank of
 * `stockVolumeLiters`, at the same conservative margin the solubility report
 * holds every tank to (see `checkTankSolubility` /
 * `SOLUBILITY_SAFETY_FACTOR`).
 *
 * Used to decide whether a salt spread over several tanks can be gathered into
 * one (see `pourTaperableNitrogenIntoCalciumTank`). Note this asks only about
 * the salt being moved: nothing else in the destination tank changes
 * concentration, and whether the two salts can coexist at all is a separate,
 * purely chemical question answered by `CALCIUM_INCOMPATIBLE_SALTS`.
 */
export function saltFitsOneTank(
  key: SaltKey,
  grams: number,
  stockVolumeLiters: number,
  safetyFactor: number = SOLUBILITY_SAFETY_FACTOR
): boolean {
  if (!(stockVolumeLiters > 0)) return false
  return grams / stockVolumeLiters <= SOLUBILITY_LIMITS_G_PER_L[key] * safetyFactor
}

/** One physical stock tank in the Separate Nitrogen layout. */
export interface SeparateNitrogenTank {
  index: number
  name: string
  role: SeparateNitrogenTankRole
  /**
   * The original nutrient part this tank stands in for, set on the tanks of a
   * line whose parts are kept apart (see
   * `SEPARATE_NITROGEN_PER_PART_SOLVE_MIN_PARTS`). Below that threshold the
   * parts are pooled and re-solved as one, so no tank has a part to name.
   *
   * Never set on the Calcium tank: it draws its Calcium from every part and its
   * Nitrogen from every part, so it stands for the recipe rather than for one
   * bottle. Nothing else can end up in there to make it one bottle's tank
   * either — every macro salt that could legally sit beside concentrated
   * Calcium is itself a taperable Nitrogen salt, and so already pooled (an
   * invariant `assertTanksAreDisjoint` pins down).
   */
  partName?: string
  partId?: string
  salts: SaltAmounts
  /** True when this tank holds any of `TANK_3_SALTS` — drives its micronutrient sub-section. */
  hasMicronutrients: boolean
}

export interface SeparateNitrogenRecipe {
  /**
   * The physical tanks, in mixing order, with the Nitrogen/Calcium tank first.
   * Tanks that came out empty are never included, so a part that's pure Calcium
   * Nitrate and KNO₃ doesn't leave a blank tank behind — which means
   * `index`/`name` count the tanks the grower actually mixes rather than the
   * parts they came from. On a multi-part line that count never exceeds the
   * number of parts: neither gathering the Calcium and Nitrogen nor placing the
   * micronutrients ever buys an extra tank (see
   * `calculateSeparateNitrogenMultiPartRecipe` / `placeMicronutrients`).
   */
  tanks: SeparateNitrogenTank[]
  /**
   * Taperable Nitrogen salts that had to stay spread over more than one tank
   * because the combined amount wouldn't stay dissolved in a single tank of the
   * grower's chosen size (see `saltFitsOneTank`). Empty in the normal case,
   * where all of it is in the Calcium tank.
   *
   * Splitting a salt across two tanks halves its concentration in each, so this
   * is a real remedy rather than a shortcoming of the layout — but it costs the
   * grower the single taper dial this mode is chosen for, so it's surfaced
   * rather than left for them to notice in the tank cards.
   */
  nitrogenKeptApart?: SaltKey[]
  warnings?: SaltGapWarning[]
  isApproximate?: boolean
  /** Calcium Carbonate needed for this recipe, to add directly to the reservoir/batch tank instead of into the Calcium tank */
  directAddCalciumCarbonate?: DirectAddCalciumCarbonate
  /** Salts the solver added on the grower's behalf to fully match a target — see `SaltAutoAddNote`. */
  autoAddedSalts?: SaltAutoAddNote[]
  /** Elemental ppm this layout's tanks actually deliver — see `TankRecipe.delivered`. */
  delivered: ElementalTargets
  /** Elements where `delivered` can't reach the label-derived target — see `TargetDeviation`. */
  deviations: TargetDeviation[]
}

export const RAW_SALTS = {
  // Commercial greenhouse/hydroponic grade — YaraLiva CalciNit and equivalents,
  // labelled 15.5-0-0 + 19% Ca — rather than pure tetrahydrate. That grade is
  // the calcium ammonium nitrate double salt, which is why it runs richer than
  // Ca(NO₃)₂·4H₂O's 16.9% Ca / 11.8% N and declares a small ammoniacal-N share
  // (~1.1% of the 15.5%) alongside its nitrate-N. Total Nitrogen is stored as a
  // single figure because `ElementalTargets` doesn't model NH₄-N separately.
  calciumNitrate: { name: "Calcium Nitrate", formula: "5Ca(NO₃)₂·NH₄NO₃·10H₂O", ca: 0.19, n: 0.155 },
  calciumCarbonate: { name: "Calcium Carbonate", formula: "CaCO₃", ca: 0.401 },
  // Dihydrate form (CaCl₂·2H₂O) — the common hydroponic/food-grade form. `cl`
  // isn't part of `ElementalTargets` (chloride isn't a modeled nutrient
  // target), but is kept here for the EC estimate, which does account for it.
  calciumChloride: { name: "Calcium Chloride", formula: "CaCl₂·2H₂O", ca: 0.2726, cl: 0.4823 },
  potassiumNitrate: { name: "Potassium Nitrate", formula: "KNO₃", k: 0.387, n: 0.139 },
  // Pure Urea is 46.6% N by weight. The user-entered "% Urea Nitrogen" label
  // value drives how much elemental Nitrogen this contributes (see
  // `ureaNitrogenPpmForPart`); this fixed fraction is only used to convert
  // that known Nitrogen ppm back into grams of dry Urea for the stock tank
  // (and for the EC/solubility estimates), the same way every other salt's
  // grams are derived from an elemental target.
  urea: { name: "Urea", formula: "CO(NH₂)₂", n: 0.466 },
  monoPotassiumPhosphate: { name: "Mono Potassium Phosphate (MKP)", formula: "KH₂PO₄", k: 0.287, p: 0.228 },
  monoAmmoniumPhosphate: { name: "Monoammonium Phosphate (MAP)", formula: "NH₄H₂PO₄", n: 0.122, p: 0.269 },
  magnesiumSulfate: { name: "Magnesium Sulfate (Epsom Salt)", formula: "MgSO₄·7H₂O", mg: 0.099, s: 0.130 },
  // Hexahydrate form (Mg(NO₃)₂·6H₂O) — the common hydroponic/lab-grade form.
  // Both fractions derived from the salt's molecular weight (256.4 g/mol):
  // Mg 24.31/256.4 ≈ 9.5%, N (2 × 14.01)/256.4 ≈ 10.9%.
  magnesiumNitrate: { name: "Magnesium Nitrate", formula: "Mg(NO₃)₂·6H₂O", mg: 0.095, n: 0.109 },
  potassiumSulfate: { name: "Potassium Sulfate", formula: "K₂SO₄", k: 0.449, s: 0.184 },
  ammoniumNitrate: { name: "Ammonium Nitrate", formula: "NH₄NO₃", n: 0.35 },
  ammoniumSulfate: { name: "Ammonium Sulfate", formula: "(NH₄)₂SO₄", n: 0.212, s: 0.243 },
  ironDTPA: { name: "Iron DTPA 11%", formula: "Fe-DTPA", fe: 0.11 },
  // Chelated micronutrients are the default salt forms (see
  // `SALT_CHECKBOX_OPTIONS.chelatedMicronutrients`) — sulfate forms
  // (MnSO₄, ZnSO₄, CuSO₄) are deliberately not modeled here. Percentages
  // reflect standard commercial chelated-micronutrient product labels.
  manganeseEDTA: { name: "Manganese EDTA 13%", formula: "Mn-EDTA", mn: 0.13 },
  zincEDTA: { name: "Zinc EDTA 14%", formula: "Zn-EDTA", zn: 0.14 },
  boricAcid: { name: "Boric Acid", formula: "H₃BO₃", b: 0.175 },
  copperEDTA: { name: "Copper EDTA 13%", formula: "Cu-EDTA", cu: 0.13 },
  sodiumMolybdate: { name: "Sodium Molybdate", formula: "Na₂MoO₄·2H₂O", mo: 0.396 },
} as const

export type SaltKey = keyof typeof RAW_SALTS

/**
 * User-facing "Salts & Inputs Included" selection captured on the Guaranteed
 * Analysis screen. Each boolean gates one or more underlying `SaltKey`s in
 * the solver (see `getEnabledSaltKeys`).
 *
 * `chelatedMicronutrients` replaces the old `ironChelate` field and now gates
 * the full micronutrient package: Fe-DTPA, Mn-EDTA, Zn-EDTA, H₃BO₃, Cu-EDTA,
 * Na₂MoO₄. Most commercial nutrient lines ship all six together. All six are
 * chelated (or, for Boron/Molybdenum, already non-sulfate) forms by design —
 * see `RAW_SALTS` — since sulfate micronutrient salts (MnSO₄, ZnSO₄, CuSO₄)
 * aren't a true match for the chelated inputs this option is meant to
 * represent. Revisit if an explicit sulfate-micronutrient option is ever
 * added.
 */
export interface IncludedSaltsSelection {
  calciumNitrate: boolean
  calciumCarbonate: boolean
  calciumChloride: boolean
  /**
   * Specialty label-only Calcium sources (see `SPECIALTY_CALCIUM_SALT_IDS`).
   * These show up on a "Derived from" section but aren't practical to
   * source as standalone hydroponic salts — checking one never adds a
   * `SaltKey` of its own (never assigned into a stock tank or the Shopping
   * List, see `SALT_CHECKBOX_OPTIONS`). Their elemental Calcium is already
   * captured by the part's overall %Calcium field, and `getEnabledSaltKeys`
   * substitutes Calcium Nitrate (or leaves Calcium Chloride/Carbonate alone
   * if already checked) so the solver still has a real salt to hit that
   * Calcium target with.
   */
  calciumAcetate: boolean
  calciumGluconate: boolean
  potassiumNitrate: boolean
  urea: boolean
  potassiumSulfate: boolean
  monoPotassiumPhosphate: boolean
  monoAmmoniumPhosphate: boolean
  magnesiumSulfate: boolean
  magnesiumNitrate: boolean
  ammoniumNitrateOrSulfate: boolean
  chelatedMicronutrients: boolean
}

/** Default for new sessions — all unchecked so the user consciously selects what is in their product. */
export const DEFAULT_INCLUDED_SALTS: IncludedSaltsSelection = {
  calciumNitrate: false,
  calciumCarbonate: false,
  calciumChloride: false,
  calciumAcetate: false,
  calciumGluconate: false,
  potassiumNitrate: false,
  urea: false,
  potassiumSulfate: false,
  monoPotassiumPhosphate: false,
  monoAmmoniumPhosphate: false,
  magnesiumSulfate: false,
  magnesiumNitrate: false,
  ammoniumNitrateOrSulfate: false,
  chelatedMicronutrients: false,
}

/*
 * There is deliberately no "every salt checked" constant here. Loading an old
 * formulation used to reach for one when the save carried nothing per-part,
 * which handed every bottle in the line a full fourteen-salt kit the grower
 * never selected. `hydrateSavedPartsAnalysis` narrows what the save does have
 * to each part's own analysis instead.
 */

/** Checkbox options rendered on the "Salts & Inputs Included" screen */
export interface SaltCheckboxOption {
  id: keyof IncludedSaltsSelection
  label: string
  /**
   * Short elemental shorthand shown as its own centered line directly under
   * `label` (e.g. "Fe, Mn, Zn, B, Cu, Mo"). Only used by options whose label
   * alone doesn't convey which elements are covered — most options leave
   * this unset.
   */
  elementsLabel?: string
  /**
   * Short helper note shown in small, secondary text under `label`. A
   * literal `"\n"` marks an intentional line break (e.g. so a short phrase
   * like "Ammonium calcium nitrate double salt" always renders as its own
   * unbroken line instead of wrapping wherever happens to fit) — most
   * sublabels are a single unbroken line and wrap normally.
   */
  sublabel: string
  /**
   * Center `label`/`elementsLabel`/`sublabel` as a block instead of the
   * default left alignment. Normally implied by the presence of
   * `elementsLabel`; set this explicitly for options that want a centered
   * sublabel without an elemental shorthand line.
   */
  centerSublabel?: boolean
  /** Underlying solver salt keys this checkbox gates */
  saltKeys: SaltKey[]
}

// Alphabetized by `label` — except `chelatedMicronutrients`, which is
// deliberately pinned last since it's the larger full-width option (see
// `fullWidth` in guaranteed-analysis-screen.tsx). Order here drives the
// on-screen checkbox order directly; it has no effect on solver behavior
// (every other consumer of this list uses `.some()` or builds a `Set`).
export const SALT_CHECKBOX_OPTIONS: SaltCheckboxOption[] = [
  {
    id: "ammoniumNitrateOrSulfate",
    label: "Ammonium Nitrate / Ammonium Sulfate",
    // No longer tells growers to pair this with Calcium Nitrate to build the
    // calcium ammonium nitrate double salt: `RAW_SALTS.calciumNitrate` models
    // that commercial grade directly, ammoniacal share included.
    sublabel: "Only if your label declares more ammoniacal\nNitrogen than Calcium Nitrate supplies.",
    centerSublabel: true,
    saltKeys: ["ammoniumNitrate", "ammoniumSulfate"],
  },
  { id: "calciumAcetate", label: "Calcium Acetate", sublabel: "", saltKeys: [] },
  { id: "calciumCarbonate", label: "Calcium Carbonate", sublabel: "", saltKeys: ["calciumCarbonate"] },
  { id: "calciumChloride", label: "Calcium Chloride", sublabel: "", saltKeys: ["calciumChloride"] },
  { id: "calciumGluconate", label: "Calcium Gluconate", sublabel: "", saltKeys: [] },
  { id: "calciumNitrate", label: "Calcium Nitrate", sublabel: "", saltKeys: ["calciumNitrate"] },
  {
    id: "magnesiumNitrate",
    label: "Magnesium Nitrate",
    sublabel: "",
    saltKeys: ["magnesiumNitrate"],
  },
  {
    id: "magnesiumSulfate",
    label: "Magnesium Sulfate",
    sublabel: "",
    saltKeys: ["magnesiumSulfate"],
  },
  {
    id: "monoAmmoniumPhosphate",
    label: "Monoammonium Phosphate (MAP)",
    sublabel: "",
    saltKeys: ["monoAmmoniumPhosphate"],
  },
  {
    id: "monoPotassiumPhosphate",
    label: "Monopotassium Phosphate",
    sublabel: "",
    saltKeys: ["monoPotassiumPhosphate"],
  },
  { id: "potassiumNitrate", label: "Potassium Nitrate", sublabel: "", saltKeys: ["potassiumNitrate"] },
  { id: "potassiumSulfate", label: "Potassium Sulfate", sublabel: "", saltKeys: ["potassiumSulfate"] },
  { id: "urea", label: "Urea", sublabel: "", saltKeys: ["urea"] },
  {
    id: "chelatedMicronutrients",
    label: "Chelated Micronutrients",
    elementsLabel: "Fe, Mn, Zn, B, Cu, Mo",
    sublabel:
      "Iron EDTA/DTPA, Manganese EDTA, Copper EDTA, Zinc EDTA, Boric Acid, Sodium Borate, Sodium Molybdate",
    saltKeys: ["ironDTPA", "manganeseEDTA", "zincEDTA", "boricAcid", "copperEDTA", "sodiumMolybdate"],
  },
]

/**
 * Specialty label-only Calcium sources — see the `IncludedSaltsSelection`
 * doc comment. Neither ever maps to a `SaltKey` (`SALT_CHECKBOX_OPTIONS`
 * gives both an empty `saltKeys`), so they never appear on the Shopping
 * List or in any stock tank; `getEnabledSaltKeys` uses this list to decide
 * when to substitute a practical Calcium salt on a part's behalf.
 */
export const SPECIALTY_CALCIUM_SALT_IDS: Array<keyof IncludedSaltsSelection> = [
  "calciumAcetate",
  "calciumGluconate",
]

/**
 * Resolve which raw salts the solver is allowed to use from the checkbox
 * selection. When `selection` is omitted, or when every gateable checkbox is
 * unchecked, we fall back to "any common salt" (the pre-feature behavior) so
 * existing users and empty/default state never produce an impossible recipe.
 */
export function getEnabledSaltKeys(selection?: IncludedSaltsSelection): Set<SaltKey> {
  const allSaltKeys = Object.keys(RAW_SALTS) as SaltKey[]

  if (!selection) {
    return new Set(allSaltKeys)
  }

  const anyChecked = SALT_CHECKBOX_OPTIONS.some((opt) => selection[opt.id])
  if (!anyChecked) {
    return new Set(allSaltKeys)
  }

  const enabled = new Set<SaltKey>()
  for (const opt of SALT_CHECKBOX_OPTIONS) {
    if (selection[opt.id]) {
      for (const key of opt.saltKeys) enabled.add(key)
    }
  }

  // Calcium Acetate / Calcium Gluconate never contribute a SaltKey of their
  // own (they're hard to source — see the doc comment above), so a part
  // that lists ONLY one of them as its Calcium source would otherwise leave
  // the solver with no way to hit that part's Calcium target at all. Fall
  // back to Calcium Nitrate in that case so the recipe still matches the
  // label's elemental Calcium using an obtainable salt. If Calcium
  // Nitrate, Carbonate, or Chloride is already checked on the part, leave
  // it alone — that source is "already part of the solution" and takes
  // priority (Calcium Chloride included, per the same minor-share treatment
  // it already gets elsewhere).
  const hasSpecialtyCalciumSource = SPECIALTY_CALCIUM_SALT_IDS.some((id) => selection[id])
  const hasPracticalCalciumSource =
    enabled.has("calciumNitrate") || enabled.has("calciumCarbonate") || enabled.has("calciumChloride")
  if (hasSpecialtyCalciumSource && !hasPracticalCalciumSource) {
    enabled.add("calciumNitrate")
  }

  return enabled
}

/**
 * Combine every part's "Salts & Inputs" selection into a single selection
 * where a checkbox is true if ANY part checked it.
 *
 * Used only by recipe layouts that intentionally recombine nutrients across
 * parts by chemistry rather than by original bottle (the Direct Mix layout,
 * the EC estimate, and the Separate Nitrogen layout below three parts — see
 * `SEPARATE_NITROGEN_PER_PART_SOLVE_MIN_PARTS`) — those modes aren't trying
 * to mirror which part a salt came from, so any salt the user indicated is
 * present *anywhere* in their product is fair game. Every layout built from
 * per-part solves (`"per-part"`, the doser's "one tank per part", and
 * Separate Nitrogen from three parts up) must NOT use this — they read each
 * part's own `includedSalts` directly so salts stay confined to the part the
 * user said they belong to, which is what makes them the faithful
 * replication path.
 */
export function unionIncludedSalts(parts: PartAnalysis[]): IncludedSaltsSelection {
  const union: IncludedSaltsSelection = { ...DEFAULT_INCLUDED_SALTS }
  for (const part of parts) {
    const selection = part.includedSalts
    if (!selection) continue
    for (const opt of SALT_CHECKBOX_OPTIONS) {
      if (selection[opt.id]) union[opt.id] = true
    }
  }
  return union
}

/**
 * Sum every part's user-specified Calcium Chloride g/gal-of-feed dose (see
 * `gramsFromFeedRatePerGallon`). Used alongside `unionIncludedSalts`
 * by the recipe layouts that recombine nutrients across parts by chemistry
 * rather than by bottle, so a dose entered on any part still applies to
 * those combined recipes.
 */
export function sumCalciumChlorideGramsPerGallon(parts: PartAnalysis[]): number {
  return parts.reduce((total, part) => {
    if (!part.includedSalts?.calciumChloride) return total
    return total + parsePositive(part.calciumChlorideGramsPerGallon)
  }, 0)
}

/**
 * From this many parts up, the Separate Nitrogen layout solves every part on
 * its own — exactly like the per-part tanks — and keeps them apart afterwards
 * too: it lifts every part's Calcium and taperable Nitrogen into one tank and
 * leaves each remaining bottle a tank of its own, so a three-part line still
 * mixes three tanks (see `calculateSeparateNitrogenMultiPartRecipe`). So the grams
 * are the ones the grower's own parts called for rather than a fresh recipe
 * solved from every part's salts pooled together, which is what used to pull a
 * 3-part line away from the feed it was replicating — and the parts stay
 * individually adjustable, which merging them into one tank took away.
 *
 * Below this count the layout keeps the pooled solve and the single merged
 * non-Calcium tank that goes with it (see `calculateSeparateCalciumRecipe`
 * and `unionIncludedSalts`). With one part there is nothing to pool in the
 * first place, and with two the pooled solve has enough freedom to land closer
 * to the label's summed ppm than solving each bottle alone does — the drift
 * only becomes the bigger of the two problems once there are three or more
 * bottles to shuffle nutrients between.
 */
export const SEPARATE_NITROGEN_PER_PART_SOLVE_MIN_PARTS = 3

export function separateNitrogenSolvesPartsIndependently(partCount: number): boolean {
  return partCount >= SEPARATE_NITROGEN_PER_PART_SOLVE_MIN_PARTS
}

/**
 * From this many parts up, "one stock tank per part" is the highest-fidelity
 * way to reproduce the original nutrient line, and the UI should present it
 * that way.
 *
 * Every other layout recombines the parts by chemistry and re-solves the
 * merged elemental targets in one pass (see `unionIncludedSalts`). That's a
 * strictly larger search space, so the merged solve can land closer to the
 * *summed* targets — but it does so by moving nutrients between bottles,
 * which is exactly the drift growers notice when they compare against the
 * line they were replicating. Solving each part on its own instead keeps
 * every tank tied to the label it came from.
 *
 * One part has nothing to recombine, so the distinction only starts to
 * matter at two.
 */
export const PER_PART_REPLICATION_MIN_PARTS = 2

export function isPerPartReplicationPreferred(partCount: number): boolean {
  return partCount >= PER_PART_REPLICATION_MIN_PARTS
}

/**
 * Beyond a handful of parts, spelling every tank letter out stops reading as
 * a name and starts reading as a list, so the title falls back to naming the
 * rule instead. No commercial line comes close to this many bottles.
 */
const MAX_LETTERED_PARTS = 6

/**
 * Name the per-part option after the tanks it actually produces — "Combine
 * into A + B tanks" for a two-part line, "Combine into A, B & C tanks" for
 * three, and so on. The letters are positional (Part A, Part B, … — the same
 * order and lettering the Guaranteed Analysis screen names new parts after),
 * not the grower's own part names, which they're free to rename to anything.
 *
 * A single part has no pair of tanks to spell out, so it falls back to naming
 * the rule instead — as does an implausibly long line (see
 * `MAX_LETTERED_PARTS`).
 */
export function perPartStockTankOptionTitle(partCount: number): string {
  if (partCount < 2 || partCount > MAX_LETTERED_PARTS) return "One Stock Tank per Part"
  const letters = Array.from({ length: partCount }, (_, index) => String.fromCharCode(65 + index))
  if (partCount === 2) return `Combine into ${letters.join(" + ")} tanks`
  const last = letters[letters.length - 1]
  return `Combine into ${letters.slice(0, -1).join(", ")} & ${last} tanks`
}

/**
 * `"per-part"` was previously the stored value `"ab"`, from when the option
 * was hard-coded around a two-part line. The layout builds one tank per part
 * in the feed chart whatever the part count, so the stored value is now named
 * after that rule and the A/B wording lives only in the on-screen title, where
 * it follows the actual number of parts (see
 * `perPartStockTankOptionTitle`). Saved formulations still carry the old
 * value, so normalize whatever comes back from storage before using it.
 */
export function normalizeStockTankOption(value: unknown): StockTankOption | null {
  if (value === "ab") return "per-part"
  if (value === "separate" || value === "doser" || value === "per-part" || value === "direct") {
    return value
  }
  return null
}

/**
 * Which layout a fresh session should start on. Multi-part lines default to
 * the per-part tanks that reproduce them most faithfully (see
 * `isPerPartReplicationPreferred`); a single-part feed has no parts to keep
 * separate, so it starts on the Separate Nitrogen layout instead, which buys
 * end-of-flower tapering for free.
 */
export function defaultStockTankOption(partCount: number): StockTankOption {
  return isPerPartReplicationPreferred(partCount) ? "per-part" : "separate"
}

/**
 * Safe dissolve order when displaying or mixing salts within one stock tank.
 *
 * Macros are listed first, then micronutrients as a group (Iron DTPA
 * dissolved first among them) — this mirrors the "add the salts in the
 * order listed above, dissolving the Iron DTPA first among the
 * micronutrients" mixing instructions shown on-screen, so every consumer of
 * `getOrderedSaltEntries` (on-screen cards *and* the saved formulation
 * payload) stays in agreement.
 */
export const SALT_DISPLAY_ORDER: SaltKey[] = [
  "calciumNitrate",
  "calciumCarbonate",
  "calciumChloride",
  "potassiumNitrate",
  "ammoniumNitrate",
  "magnesiumNitrate",
  "urea",
  "monoPotassiumPhosphate",
  "monoAmmoniumPhosphate",
  "magnesiumSulfate",
  "potassiumSulfate",
  "ammoniumSulfate",
  "ironDTPA",
  "manganeseEDTA",
  "zincEDTA",
  "boricAcid",
  "copperEDTA",
  "sodiumMolybdate",
]

export interface PartStockTank {
  index: number
  name: string
  partName: string
  partId: string
  salts: SaltAmounts
  /** True for the consolidated micro tank added by calculateDoserMultiPartRecipe */
  isMicroTank?: boolean
}

export interface MultiPartTankRecipe {
  tanks: PartStockTank[]
  warnings?: SaltGapWarning[]
  isApproximate?: boolean
  /** Calcium Carbonate needed across all parts' recipes, consolidated and to be added directly to the reservoir/batch tank rather than into any part's tank */
  directAddCalciumCarbonate?: DirectAddCalciumCarbonate
  /** Salts the solver added on the grower's behalf to fully match a target — see `SaltAutoAddNote`. */
  autoAddedSalts?: SaltAutoAddNote[]
  /**
   * Elemental ppm every part's tank delivers, summed — see
   * `TankRecipe.delivered`. Per-part tanks are solved independently against
   * each part's own label and salt selection, so this can differ from the
   * combined layouts: a salt checked on one part can't cover another part's
   * target here, which leaves less room to balance the recipe as a whole.
   */
  delivered: ElementalTargets
  /** Elements where `delivered` can't reach the label-derived target — see `TargetDeviation`. */
  deviations: TargetDeviation[]
}

export interface DirectMixRecipe {
  salts: SaltAmounts
  warnings: SaltGapWarning[]
  isApproximate: boolean
  /** Calcium Carbonate needed for this recipe, to add directly to the reservoir rather than mixing it in with the rest of the salts */
  directAddCalciumCarbonate?: DirectAddCalciumCarbonate
  /** Salts the solver added on the grower's behalf to fully match a target — see `SaltAutoAddNote`. */
  autoAddedSalts?: SaltAutoAddNote[]
  /** Elemental ppm `salts` actually deliver — see `TankRecipe.delivered`. */
  delivered: ElementalTargets
  /** Elements where `delivered` can't reach the label-derived target — see `TargetDeviation`. */
  deviations: TargetDeviation[]
}

/**
 * Tank assignment is driven by precipitation chemistry, not by recipe order.
 *
 * Calcium ions (Ca²⁺) form insoluble precipitates with phosphate (PO₄³⁻) and
 * sulfate (SO₄²⁻) when held at stock-tank concentrations. They MUST live in
 * different concentrated tanks. Once diluted into the working reservoir the
 * concentrations are low enough that the same ions coexist safely.
 *
 * Tank A — calcium-side (Ca²⁺ source, incl. Calcium Chloride + compatible
 *          nitrates / chelated iron). Urea is a neutral, non-ionic molecule
 *          that doesn't react with Ca²⁺, PO₄³⁻, or SO₄²⁻, so it's grouped
 *          here alongside the other Nitrogen sources rather than for any
 *          precipitation-avoidance reason. Magnesium Nitrate lives here too,
 *          not with Magnesium Sulfate in Tank B — Mg²⁺ is fully compatible
 *          with the nitrate salts (no precipitation risk with Ca²⁺), but it
 *          WOULD risk precipitating as insoluble magnesium phosphate
 *          (Mg₃(PO₄)₂) if it shared a concentrated stock tank with Tank B's
 *          MKP/MAP.
 * Tank B — phosphate / sulfate-side (PO₄³⁻ + SO₄²⁻ salts, plus the chelated
 *          micronutrients — chelates are compatible with both tanks
 *          chemically, but grouped here alongside the other non-Calcium
 *          salts)
 */
export const TANK_A_SALTS = [
  "calciumNitrate",
  "calciumCarbonate",
  "calciumChloride",
  "potassiumNitrate",
  "ammoniumNitrate",
  "magnesiumNitrate",
  "urea",
  "ironDTPA",
] as const satisfies readonly SaltKey[]

export const TANK_B_SALTS = [
  "monoPotassiumPhosphate",
  "monoAmmoniumPhosphate",
  "magnesiumSulfate",
  "potassiumSulfate",
  "ammoniumSulfate",
  "manganeseEDTA",
  "zincEDTA",
  "boricAcid",
  "copperEDTA",
  "sodiumMolybdate",
] as const satisfies readonly SaltKey[]

/**
 * The two SIDES of the "Separate Nitrogen" mode, as the solver reads them off a
 * solved A/B pair. What matters chemically is only that the calcium ion stays
 * away from phosphate and sulfate at stock strength; which physical tank each
 * salt then lands in is decided afterwards, on tapering grounds.
 *
 * Calcium side (`TANK_1_SALTS`) — the Calcium sources: Calcium Nitrate, and/or
 *          Calcium Chloride or Calcium Carbonate when used instead of (or
 *          alongside) it as a nitrogen-free calcium source. All of it lands in
 *          one physical tank, pooled across every part — and since Ca(NO₃)₂'s
 *          Nitrogen can't be tapered without its Calcium, that tank is where
 *          the taperable Nitrogen joins it, making it the recipe's one
 *          Nitrogen tank (see `pourTaperableNitrogenIntoCalciumTank`).
 * Non-calcium side (`TANK_2_SALTS`) — the remaining macros (KNO₃, Mg(NO₃)₂,
 *          Urea, MKP/MAP, MgSO₄, K₂SO₄). Every one of them is either a
 *          taperable Nitrogen salt bound for the Calcium tank or a phosphate /
 *          sulfate that can never go in there, with nothing in between (an
 *          invariant `assertTanksAreDisjoint` pins down) — so what's left after
 *          the Nitrogen moves is the part of the recipe a taper doesn't touch.
 * Micronutrients (`TANK_3_SALTS`) — Fe-DTPA, Mn/Zn/Cu EDTA chelates, boric acid
 *          and sodium molybdate, which ride with those Nitrogen-free macros
 *          rather than taking a tank of their own, so a taper can't drag them
 *          down with it (see `placeMicronutrients`).
 *
 * How the non-Calcium side becomes physical tanks is a layout decision: one
 * merged tank when the parts were pooled and re-solved as one, one tank per
 * part when they weren't (see
 * `SEPARATE_NITROGEN_PER_PART_SOLVE_MIN_PARTS`).
 */
export const TANK_1_SALTS = [
  "calciumNitrate",
  "calciumCarbonate",
  "calciumChloride",
] as const satisfies readonly SaltKey[]

export const TANK_2_SALTS = [
  "potassiumNitrate",
  "ammoniumNitrate",
  "magnesiumNitrate",
  "urea",
  "monoPotassiumPhosphate",
  "monoAmmoniumPhosphate",
  "magnesiumSulfate",
  "potassiumSulfate",
  "ammoniumSulfate",
] as const satisfies readonly SaltKey[]

/**
 * The micronutrient salts, grouped so the layouts that keep them together can
 * find them: the Separate Nitrogen layout, which sets them beside the
 * Nitrogen-free macros and clear of the taper path (see
 * `placeMicronutrients`), and `calculateDoserMultiPartRecipe`, which pools them
 * into a single "Micros" suction line so the per-part amounts stay weighable.
 */
export const TANK_3_SALTS = [
  "ironDTPA",
  "manganeseEDTA",
  "zincEDTA",
  "boricAcid",
  "copperEDTA",
  "sodiumMolybdate",
] as const satisfies readonly SaltKey[]

/**
 * The only salts that genuinely can't share a stock tank with concentrated
 * Calcium: the phosphate and sulfate carriers, which drop out as dicalcium
 * phosphate or gypsum at stock strength.
 *
 * The rest of the non-Calcium side is safe beside Calcium Nitrate — the
 * nitrates and Urea are exactly what a conventional "Tank A" holds alongside it
 * (see `TANK_A_SALTS`). That's what lets the Separate Nitrogen layout pour every
 * part's taperable Nitrogen into the Calcium tank, at any stock strength a
 * grower would mix (see `pourTaperableNitrogenIntoCalciumTank`), instead of
 * leaving a second Nitrogen source in a tank of its own.
 *
 * This list answers "would these precipitate together", and nothing more. The
 * chelated micronutrients are equally safe beside concentrated Calcium — that's
 * a conventional "Tank A" — which is why the Calcium tank can take them when no
 * Nitrogen-free macro tank exists to (see `placeMicronutrients`).
 */
export const CALCIUM_INCOMPATIBLE_SALTS = [
  "monoPotassiumPhosphate",
  "monoAmmoniumPhosphate",
  "magnesiumSulfate",
  "potassiumSulfate",
  "ammoniumSulfate",
] as const satisfies readonly SaltKey[]

/**
 * Compile-time + runtime guarantee that no salt ends up in incompatible
 * tanks. Each layout relies on this invariant to keep calcium apart from
 * phosphate / sulfate at concentrated storage strength.
 */
function assertTanksAreDisjoint(): void {
  const abOverlap = TANK_A_SALTS.filter((key) => (TANK_B_SALTS as readonly string[]).includes(key))
  if (abOverlap.length > 0) {
    throw new Error(
      `A/B tank assignment is unsafe — salts present in both tanks: ${abOverlap.join(", ")}`
    )
  }

  const triple = [TANK_1_SALTS, TANK_2_SALTS, TANK_3_SALTS]
  const seen = new Set<string>()
  for (const tank of triple) {
    for (const key of tank) {
      if (seen.has(key)) {
        throw new Error(
          `Three-tank assignment is unsafe — salt appears in multiple tanks: ${key}`
        )
      }
      seen.add(key)
    }
  }

  // A new phosphate or sulfate salt added to the Tank-B side has to show up in
  // `CALCIUM_INCOMPATIBLE_SALTS` too, or the Separate Nitrogen layout would
  // happily fold it in beside pooled Calcium. Chelated micronutrients are the
  // documented exception: they're grouped with Tank B but safe either side.
  const microKeys = new Set<string>(TANK_3_SALTS)
  const unguarded = TANK_B_SALTS.filter(
    (key) => !microKeys.has(key) && !(CALCIUM_INCOMPATIBLE_SALTS as readonly string[]).includes(key)
  )
  if (unguarded.length > 0) {
    throw new Error(
      "Salts could be folded in beside concentrated Calcium — add them to " +
        `CALCIUM_INCOMPATIBLE_SALTS: ${unguarded.join(", ")}`
    )
  }

  // Separate Nitrogen pours every taperable Nitrogen salt in with the pooled
  // Calcium, so none of them may be one of the salts that precipitates it.
  const precipitating = TAPERABLE_NITROGEN_SALTS.filter((key) =>
    (CALCIUM_INCOMPATIBLE_SALTS as readonly string[]).includes(key)
  )
  if (precipitating.length > 0) {
    throw new Error(
      "Separate Nitrogen would pour these in beside concentrated Calcium — drop them " +
        `from TAPERABLE_NITROGEN_SALTS: ${precipitating.join(", ")}`
    )
  }

  // And nothing on the non-Calcium side may fall between the two: a macro salt
  // that neither moves with the Nitrogen nor is barred from the Calcium tank
  // would be left in a tank of its own for no chemical reason, and would make
  // the Calcium tank one bottle's tank again (see
  // `SeparateNitrogenTank.partName`).
  const taperableKeys = new Set<string>(TAPERABLE_NITROGEN_SALTS)
  const stranded = TANK_2_SALTS.filter(
    (key) =>
      !taperableKeys.has(key) && !(CALCIUM_INCOMPATIBLE_SALTS as readonly string[]).includes(key)
  )
  if (stranded.length > 0) {
    throw new Error(
      "Non-Calcium macro salts belong either with the tapered Nitrogen or away from the " +
        `Calcium — classify them: ${stranded.join(", ")}`
    )
  }
}

assertTanksAreDisjoint()

/**
 * Approximate solubility limits in pure water at 20 °C (g of dry salt per
 * litre of water). Cold storage and elevated TDS reduce this further, so the
 * checker below applies a conservative safety factor before flagging a
 * concentration as risky.
 *
 * Sources: Merck Index, USGS Water-Solubility tables, JR Peters technical
 * sheets. Values rounded to two significant figures.
 */
export const SOLUBILITY_LIMITS_G_PER_L: Record<SaltKey, number> = {
  // 1200 g/L per YaraLiva CalciNit's technical sheet — the commercial grade
  // modelled in `RAW_SALTS`, slightly below pure tetrahydrate's 1290 g/L.
  calciumNitrate: 1200,
  // Calcium Carbonate is nearly insoluble in plain water (~0.013 g/L at 20 °C).
  // Kept accurate rather than optimistic so the solubility checker still warns
  // when a recipe leans on it for meaningful Ca — it dissolves far better once
  // reservoir pH is buffered acidic, but stock-tank strength is the risk case.
  calciumCarbonate: 0.013,
  // Dihydrate form, ~74.5 g/100 mL (745 g/L) at 20 °C — highly soluble.
  calciumChloride: 745,
  potassiumNitrate: 316,
  // Highly soluble — 1080 g/L at 20 °C (Merck Index / OECD SIDS data).
  urea: 1080,
  monoPotassiumPhosphate: 226,
  monoAmmoniumPhosphate: 368,
  magnesiumSulfate: 710,
  // Hexahydrate form, 420 g/L at 20 °C (Sigma-Aldrich / Merck technical data).
  magnesiumNitrate: 420,
  potassiumSulfate: 111,
  ammoniumNitrate: 1920,
  ammoniumSulfate: 754,
  ironDTPA: 500,
  // Chelated micronutrient solubility figures (disodium EDTA salts, 20 °C):
  // Mn-EDTA ~400 g/L, Zn-EDTA ~900 g/L, Cu-EDTA ~1000 g/L — all comfortably
  // more soluble than the sulfate forms they replace.
  manganeseEDTA: 400,
  zincEDTA: 900,
  boricAcid: 47,
  copperEDTA: 1000,
  sodiumMolybdate: 840,
}

/**
 * Default safety factor: hold each salt below 60 % of its 20 °C solubility
 * limit. This leaves headroom for cold storage, TDS-driven activity loss, and
 * minor measurement error.
 */
export const SOLUBILITY_SAFETY_FACTOR = 0.6

export interface SaltSolubility {
  grams: number
  concentrationGPerL: number
  safeLimitGPerL: number
  rawLimitGPerL: number
  /** Below the safe (factored) limit */
  safe: boolean
  /** Maximum dilution ratio at which this salt would still fit the safe limit */
  maxSafeDilutionRatio: number
}

export interface TankSolubilityReport {
  /** Salt that hits its safe limit first when ratio is increased */
  limitingSalt: SaltKey | null
  /** Maximum dilution ratio at which every salt in the tank stays in solution */
  maxSafeDilutionRatio: number
  /** Whether the tank is currently fully in solution */
  safe: boolean
  perSalt: Partial<Record<SaltKey, SaltSolubility>>
}

/**
 * Check whether every salt in a tank stays below its safe solubility limit at
 * the chosen stock volume and dilution ratio, and report the maximum dilution
 * ratio that would still be safe.
 *
 * Note that `stockVolumeLiters` cancels out of the safe-ratio formula:
 *   grams(r)/V = (target_ppm · r) / (f · 1000)
 * so the recommendation depends only on the targets and elemental fractions —
 * exactly the property we want from a "what's the maximum I can run" check.
 */
export function checkTankSolubility(
  salts: SaltAmounts,
  stockVolumeLiters: number,
  dilutionRatio: number,
  safetyFactor: number = SOLUBILITY_SAFETY_FACTOR
): TankSolubilityReport {
  const perSalt: Partial<Record<SaltKey, SaltSolubility>> = {}
  let maxSafeRatio = Number.POSITIVE_INFINITY
  let limitingSalt: SaltKey | null = null
  let allSafe = true

  if (stockVolumeLiters <= 0 || dilutionRatio <= 0) {
    return {
      limitingSalt: null,
      maxSafeDilutionRatio: Number.POSITIVE_INFINITY,
      safe: true,
      perSalt,
    }
  }

  const saltEntries = Object.entries(salts) as Array<[SaltKey, number]>
  for (const [key, grams] of saltEntries) {
    if (!Number.isFinite(grams) || grams <= 0) continue
    const rawLimit = SOLUBILITY_LIMITS_G_PER_L[key]
    const safeLimit = rawLimit * safetyFactor
    const concentration = grams / stockVolumeLiters
    const safe = concentration <= safeLimit
    if (!safe) allSafe = false

    // grams(r) / V scales linearly with ratio. r_safe = safeLimit · r / concentration.
    const maxSafe = (safeLimit * dilutionRatio) / concentration
    if (maxSafe < maxSafeRatio) {
      maxSafeRatio = maxSafe
      limitingSalt = key
    }

    perSalt[key] = {
      grams,
      concentrationGPerL: concentration,
      safeLimitGPerL: safeLimit,
      rawLimitGPerL: rawLimit,
      safe,
      maxSafeDilutionRatio: maxSafe,
    }
  }

  return {
    limitingSalt,
    maxSafeDilutionRatio: maxSafeRatio,
    safe: allSafe,
    perSalt,
  }
}

export interface TankInput {
  name: string
  salts: SaltAmounts
}

export interface MultiTankSolubilityReport {
  perTank: Array<TankSolubilityReport & { name: string }>
  /** Lowest safe ratio across every concentrated tank */
  maxSafeDilutionRatio: number
  /** Tank that determines the overall recommendation */
  limitingTankName: string | null
  limitingSalt: SaltKey | null
  safe: boolean
}

export function checkRecipeSolubility(
  tanks: TankInput[],
  stockVolumeLiters: number,
  dilutionRatio: number,
  safetyFactor: number = SOLUBILITY_SAFETY_FACTOR
): MultiTankSolubilityReport {
  let maxSafeRatio = Number.POSITIVE_INFINITY
  let limitingTankName: string | null = null
  let limitingSalt: SaltKey | null = null
  let allSafe = true

  const perTank = tanks.map(({ name, salts }) => {
    const report = checkTankSolubility(salts, stockVolumeLiters, dilutionRatio, safetyFactor)
    if (!report.safe) allSafe = false
    if (report.maxSafeDilutionRatio < maxSafeRatio) {
      maxSafeRatio = report.maxSafeDilutionRatio
      limitingTankName = name
      limitingSalt = report.limitingSalt
    }
    return { name, ...report }
  })

  return {
    perTank,
    maxSafeDilutionRatio: maxSafeRatio,
    limitingTankName,
    limitingSalt,
    safe: allSafe,
  }
}

/** Round a ratio down to a "nice" number (nearest 10 below) for display + auto-apply. */
export function roundDownToNiceRatio(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0
  if (ratio < 10) return Math.max(1, Math.floor(ratio))
  return Math.floor(ratio / 10) * 10
}

/**
 * Practical ceiling for the *auto-recommended* dilution ratio — separate
 * from (and always ≤ than) the purely mathematical solubility ceiling
 * (`maxSafeDilutionRatio`).
 *
 * `checkTankSolubility`'s safe ratio is ratio-invariant: it depends only on
 * each salt's elemental target/dose relative to its own solubility limit,
 * never on the resulting stock-tank/reservoir size. That's correct for
 * "will this salt precipitate," but it has no opinion on whether the ratio
 * is something a real stock tank would ever run at. A part with an
 * especially small feed-chart dose — e.g. a liquid-line "booster" bottle
 * dosed at well under 1 mL/gal, or a Calcium Chloride top-up dose that's a
 * tiny fraction of the Calcium target — can mathematically tolerate a ratio
 * in the hundreds (1:600, 1:800+) without any salt actually approaching its
 * solubility limit, since so little of it is needed either way. Nobody
 * mixes a stock tank that concentrated by hand, and even the strongest
 * common commercial doser/proportioner tops out around 1:200 (see
 * `DOSER_PRESET_RATIOS`) — so this doubles as a sensible ceiling for manual
 * hand-mixed multi-tank setups too, not just doser mode.
 *
 * Only caps the *auto-picked* recommendation — a user who explicitly types
 * in a higher custom ratio is still free to do so.
 */
export const MAX_PRACTICAL_DILUTION_RATIO = 200

/**
 * `roundDownToNiceRatio`, clamped to `MAX_PRACTICAL_DILUTION_RATIO` — this is
 * the "nice number" callers should actually auto-apply. Kept as a distinct
 * export (rather than folding the cap into `roundDownToNiceRatio` itself) so
 * the underlying salt-safe math stays inspectable/testable on its own.
 */
export function pickPracticalAutoDilutionRatio(maxSafeDilutionRatio: number): number {
  return Math.min(roundDownToNiceRatio(maxSafeDilutionRatio), MAX_PRACTICAL_DILUTION_RATIO)
}

/**
 * Common dilution ratios that commercial dosers / proportioners are built
 * around. Listed high-to-low so the picker can find the strongest preset that
 * still leaves the stock tank safely in solution.
 *
 *   1 : 200  — Dosatron D25RE2, MixRite TF-10
 *   1 : 128  — "1 oz per gallon", common Hozon / siphon-style dosers
 *   1 : 100  — Dosatron D14MZ2, Anderson injectors (the most common default)
 */
export const DOSER_PRESET_RATIOS = [200, 128, 100] as const

export type DoserPresetRatio = (typeof DOSER_PRESET_RATIOS)[number]

/**
 * Pick the strongest doser preset that is still at or below the maximum
 * solubility-safe ratio for the recipe. Returns null when no preset is safe —
 * the caller should fall back to the salt-safe ratio (and recommend a bigger
 * stock tank).
 */
export function pickDoserPresetForRatio(
  maxSafeRatio: number
): DoserPresetRatio | null {
  if (!Number.isFinite(maxSafeRatio) || maxSafeRatio <= 0) return null
  for (const preset of DOSER_PRESET_RATIOS) {
    if (preset <= maxSafeRatio) return preset
  }
  return null
}

export function emptySaltAmounts(): SaltAmounts {
  return {
    calciumNitrate: 0,
    calciumCarbonate: 0,
    calciumChloride: 0,
    potassiumNitrate: 0,
    urea: 0,
    monoPotassiumPhosphate: 0,
    monoAmmoniumPhosphate: 0,
    magnesiumSulfate: 0,
    magnesiumNitrate: 0,
    potassiumSulfate: 0,
    ammoniumNitrate: 0,
    ammoniumSulfate: 0,
    ironDTPA: 0,
    manganeseEDTA: 0,
    zincEDTA: 0,
    boricAcid: 0,
    copperEDTA: 0,
    sodiumMolybdate: 0,
  }
}

export function emptyElementalTargets(): ElementalTargets {
  return {
    nitrogen: 0,
    phosphorus: 0,
    potassium: 0,
    calcium: 0,
    magnesium: 0,
    sulfur: 0,
    iron: 0,
    manganese: 0,
    zinc: 0,
    boron: 0,
    copper: 0,
    molybdenum: 0,
  }
}

export function parsePositive(value: string | undefined): number {
  const parsed = parseFloat(value ?? "")
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/**
 * Which `ElementalTargets` field each `RAW_SALTS` composition fraction feeds.
 * Chloride is deliberately absent — it isn't a modeled nutrient target (only
 * the EC estimate accounts for it, see `ecFromSaltAmounts`).
 */
const SALT_FRACTION_TO_ELEMENT = {
  n: "nitrogen",
  p: "phosphorus",
  k: "potassium",
  ca: "calcium",
  mg: "magnesium",
  s: "sulfur",
  fe: "iron",
  mn: "manganese",
  zn: "zinc",
  b: "boron",
  cu: "copper",
  mo: "molybdenum",
} as const satisfies Record<string, keyof ElementalTargets>

/**
 * Every element one salt carries, paired with its weight fraction — the
 * composition half of any grams→ppm conversion, split out from the unit
 * arithmetic so the two can be checked against each other.
 *
 * `elementalPpmFromSaltAmounts` below converts grams held in a stock tank;
 * `deliveredPpmFromStockTankDose` (see `displayed-recipe.ts`) converts the
 * g-per-gallon-of-stock and mL/gal rate the grower actually reads off the
 * screen. Both must land on the same ppm, and they only do so unconditionally
 * if they agree about what's in each salt — hence one shared table.
 */
export function saltElementFractions(key: SaltKey): Array<[keyof ElementalTargets, number]> {
  const composition: Record<string, unknown> = RAW_SALTS[key]
  const fractions: Array<[keyof ElementalTargets, number]> = []
  for (const [fraction, element] of Object.entries(SALT_FRACTION_TO_ELEMENT)) {
    const elementFraction = composition[fraction]
    if (typeof elementFraction !== "number" || elementFraction <= 0) continue
    fractions.push([element, elementFraction])
  }
  return fractions
}

/**
 * Elemental ppm a set of resolved stock-tank salt amounts ACTUALLY delivers
 * to the working (reservoir) solution once diluted 1:`dilutionRatio`.
 *
 * This is the inverse of how the solver sizes each salt
 * (`saltGramsForTargetPpm`), summed over every salt and every element that
 * salt carries — so it answers "what will the grower's plants really get from
 * these grams?" rather than "what did the label-derived targets ask for?".
 * Those two are NOT the same thing whenever the solver can't hit a target
 * exactly (an unchecked source salt) or overshoots one as a side effect of
 * hitting another (Potassium riding along with KNO₃ sized for Nitrogen), which
 * is exactly the mismatch this function exists to make measurable.
 *
 * Pass the union of every tank in a layout (plus any direct-add Calcium
 * Carbonate — see `DirectAddCalciumCarbonate`, which never lives in a tank but
 * does dissolve into the reservoir). For a direct-mix recipe use
 * `stockVolumeLiters = reservoirLiters` and `dilutionRatio = 1`, matching how
 * `calculateDirectMixRecipe` builds it.
 */
export function elementalPpmFromSaltAmounts(
  salts: SaltAmounts,
  stockVolumeLiters: number,
  dilutionRatio: number
): ElementalTargets {
  const delivered = emptyElementalTargets()
  if (!(stockVolumeLiters > 0) || !(dilutionRatio > 0)) return delivered

  for (const saltKey of Object.keys(RAW_SALTS) as SaltKey[]) {
    const grams = salts[saltKey]
    if (!(grams > 0)) continue
    for (const [element, elementFraction] of saltElementFractions(saltKey)) {
      delivered[element] += ((grams * elementFraction) / stockVolumeLiters) * (1000 / dilutionRatio)
    }
  }

  return delivered
}

/** Sum two salt-amount sets recorded at the same stock volume / dilution ratio. */
export function sumSaltAmounts(...sets: SaltAmounts[]): SaltAmounts {
  const total = emptySaltAmounts()
  for (const set of sets) {
    for (const key of Object.keys(total) as SaltKey[]) total[key] += set[key]
  }
  return total
}

/**
 * A nutrient part's own feed-chart dose, normalized to dry grams per US
 * gallon of working (reservoir) feed — converting a liquid dose via the
 * standard liquid-concentrate density, then dividing by the litres the unit
 * quotes against (`doseUnitLiters`) and multiplying back up by
 * `LITERS_PER_GALLON`. Per-gallon grams stay the one basis the solver ever
 * sees, whichever unit the feed chart was typed in.
 *
 * The division is what keeps a metric chart honest: 29 mL/10 L is 2.9 mL/L, so
 * it must reach the solver as the same feed as 10.98 mL/gal — not ten times it.
 */
export function getDoseGramsPerGallon(part: NutrientPart): number {
  const dose = parsePositive(part.dose)
  if (dose === 0) return 0
  const grams = isLiquidDoseUnit(part.unit) ? dose * LIQUID_CONCENTRATE_DENSITY : dose
  return (grams / doseUnitLiters(part.unit)) * LITERS_PER_GALLON
}

/** Grams of concentrate applied per liter of working (reservoir) solution */
export function getConcentrateGramsPerLiter(part: NutrientPart): number {
  return getDoseGramsPerGallon(part) / LITERS_PER_GALLON
}

/**
 * True when a part's declared salts are (at most) Calcium Nitrate + Calcium
 * Chloride + the always-available chelated-micronutrient package — i.e.
 * nothing else on the label competes for a share of the part's own
 * feed-chart dose. Only in that narrow case is it safe to treat the part's
 * dose as literally "grams of Calcium Nitrate per gallon" rather than
 * re-deriving Calcium Nitrate's amount from the elemental Calcium/Nitrogen
 * targets — once another macro salt (KNO₃, MKP, MgSO₄, Calcium Carbonate,
 * etc.) is also checked on the same part, the dose represents a blend and
 * can no longer be attributed to Calcium Nitrate alone.
 *
 * See the Calcium-solving block in `calculateStockTankRecipe` (recipe
 * solver) for where this gates using the literal dose instead of the usual
 * ppm-target-derived amount.
 */
export function isCalciumNitrateSoleDoseSource(selection: IncludedSaltsSelection | undefined): boolean {
  if (!selection || !selection.calciumNitrate) return false
  const OTHER_MACRO_KEYS: Array<keyof IncludedSaltsSelection> = [
    "calciumCarbonate",
    "potassiumNitrate",
    "urea",
    "potassiumSulfate",
    "monoPotassiumPhosphate",
    "monoAmmoniumPhosphate",
    "magnesiumSulfate",
    "magnesiumNitrate",
    "ammoniumNitrateOrSulfate",
  ]
  return OTHER_MACRO_KEYS.every((key) => !selection[key])
}

/**
 * Sum every part's own feed-chart dose (see `getDoseGramsPerGallon`), but
 * ONLY for parts where Calcium Nitrate is the sole macro salt behind that
 * dose (see `isCalciumNitrateSoleDoseSource`) AND that part also carries an
 * explicit Calcium Chloride top-up dose — i.e. exactly the "generic Calcium
 * Nitrate + a measured pinch of Calcium Chloride" bottle the literal-dose
 * treatment is meant for. Used alongside `sumCalciumChlorideGramsPerGallon`
 * by the recipe layouts that recombine nutrients across parts by chemistry
 * rather than by bottle, so those doses still carry through to those
 * combined recipes instead of being silently dropped back to the usual
 * ppm-target-derived amount.
 */
export function sumCalciumNitrateGramsPerGallon(partsAnalysis: PartAnalysis[], parts: NutrientPart[]): number {
  const partsById = new Map(parts.map((part) => [part.id, part]))
  return partsAnalysis.reduce((total, analysis) => {
    if (!analysis.includedSalts?.calciumChloride) return total
    if (parsePositive(analysis.calciumChlorideGramsPerGallon) === 0) return total
    if (!isCalciumNitrateSoleDoseSource(analysis.includedSalts)) return total
    const part = partsById.get(analysis.id)
    if (!part) return total
    return total + getDoseGramsPerGallon(part)
  }, 0)
}

/** Non-zero salts in a safe mixing order for display */
export function getOrderedSaltEntries(salts: SaltAmounts): Array<[SaltKey, number]> {
  return SALT_DISPLAY_ORDER.filter((key) => salts[key] > 0).map((key) => [key, salts[key]])
}

export function hasValidRecipeInput(partsAnalysis: PartAnalysis[], parts: NutrientPart[]): boolean {
  const hasDose = parts.some((part) => parsePositive(part.dose) > 0)
  if (!hasDose) return false

  const analysisById = new Map(partsAnalysis.map((part) => [part.id, part]))
  return parts.some((feedingPart) => {
    if (parsePositive(feedingPart.dose) === 0) return false
    const analysis = analysisById.get(feedingPart.id)
    if (!analysis) return false

    return (
      parsePositive(analysis.nitrogen) > 0 ||
      parsePositive(analysis.phosphate) > 0 ||
      parsePositive(analysis.potash) > 0 ||
      parsePositive(analysis.calcium) > 0 ||
      parsePositive(analysis.magnesium) > 0 ||
      parsePositive(analysis.sulfur) > 0
    )
  })
}

export function getTotalDoseMlPerGallon(parts: NutrientPart[]): number {
  return parts.reduce((total, part) => {
    const dose = parsePositive(part.dose)
    if (dose === 0) return total
    const ml = isLiquidDoseUnit(part.unit) ? dose : dose / LIQUID_CONCENTRATE_DENSITY
    return total + (ml / doseUnitLiters(part.unit)) * LITERS_PER_GALLON
  }, 0)
}

/** mL of one stock tank per liter of working reservoir at dilution 1:ratio */
export function stockTankMlPerLiter(dilutionRatio: number): number {
  if (!Number.isFinite(dilutionRatio) || dilutionRatio <= 0) return 0
  return 1000 / dilutionRatio
}

/** mL of one stock tank per US gallon of working reservoir at dilution 1:ratio */
export function stockTankMlPerGallon(dilutionRatio: number): number {
  return stockTankMlPerLiter(dilutionRatio) * LITERS_PER_GALLON
}

export function formatEc(ec: number): string {
  if (!Number.isFinite(ec) || ec <= 0) return "—"
  if (ec < 0.01) return `${(ec * 1000).toFixed(0)} µS/cm`
  return `${ec.toFixed(2)} mS/cm`
}

export function formatGrams(g: number): string {
  if (!Number.isFinite(g) || g <= 0) return "—"
  if (g < 0.01) return `${g.toFixed(4)} g`
  if (g < 1) return `${g.toFixed(3)} g`
  return `${g.toFixed(2)} g`
}

/**
 * Enough decimals that a printed ppm reconciles with the grams it came from.
 *
 * The 1–10 band is where the micronutrients that aren't sub-1 ppm land, and it
 * used to print one decimal: a Manganese target of 1.374 ppm — the ppm a
 * grower gets back by working forward from the tank card's own g/gal and
 * mL/gal — showed as "1.4 ppm", off by enough to read as a 2% discrepancy
 * rather than as rounding. It also made the deviation callout capable of
 * printing "1.4 vs 1.4" while flagging a gap. Two decimals there matches what
 * `formatGrams` already does from 1 g up. Above 10 ppm one decimal is finer
 * than any grower can mix to, and below 1 ppm three are needed to say anything
 * at all.
 */
export function formatPpm(ppm: number): string {
  if (!Number.isFinite(ppm) || ppm <= 0) return "—"
  if (ppm < 1) return `${ppm.toFixed(3)} ppm`
  if (ppm < 10) return `${ppm.toFixed(2)} ppm`
  return `${ppm.toFixed(1)} ppm`
}

export function formatMl(ml: number): string {
  if (!Number.isFinite(ml) || ml <= 0) return "—"
  if (ml >= 100) return ml.toFixed(0)
  if (ml >= 10) return ml.toFixed(1)
  return ml.toFixed(2)
}

export type { StockTankOption }
