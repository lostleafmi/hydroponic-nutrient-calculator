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

/** US gallons → liters */
export const LITERS_PER_GALLON = 3.785

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

/** Preferred order for picking an anchor when estimating missing micros */
export const MICRO_KEYS: MicroKey[] = [
  "iron",
  "manganese",
  "zinc",
  "boron",
  "copper",
  "molybdenum",
]

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

export interface EstimatedTargets {
  targets: ElementalTargets
  estimated: Set<MicroKey>
  /** Element used to derive the missing micros; null if no micros were provided */
  anchor: MicroKey | null
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
  /**
   * True when `tankA.ammoniumNitrate` above was sized as this part's share
   * of a Ca(NO₃)₂/NH₄NO₃ double-salt split (Ammonium Nitrate checked
   * ALONGSIDE Calcium Nitrate — see `SALT_CHECKBOX_OPTIONS`'s double-salt
   * disclaimer and the Nitrogen-solving block in `calculateStockTankRecipe`)
   * rather than as an independently-checked Nitrogen salt. Layouts that
   * split salts across multiple physical stock tanks — currently only
   * `calculateSeparateCalciumRecipe`'s Tank 1 / Tank 2 split — use this to
   * keep Ammonium Nitrate grouped with Calcium Nitrate instead of routing
   * it to a separate "remaining macros" tank, since it's chemically the
   * same double-salt product rather than a distinct ingredient.
   */
  ammoniumNitrateIsCalciumDoubleSalt?: boolean
  /** Salts the solver added on the grower's behalf to fully match a target — see `SaltAutoAddNote`. */
  autoAddedSalts?: SaltAutoAddNote[]
}

export interface ThreeTankRecipe {
  tank1: SaltAmounts
  /** Remaining macros plus the micronutrients — always merged together (see `TANK_2_SALTS`/`TANK_3_SALTS`). */
  tank2: SaltAmounts
  /** True when the recipe has any micronutrients at all. Use this to decide
   *  whether to render a micronutrients sub-section inside Tank 2. */
  hasMicronutrients: boolean
  warnings?: SaltGapWarning[]
  isApproximate?: boolean
  /** Calcium Carbonate needed for this recipe, to add directly to the reservoir/batch tank instead of into Tank 1 */
  directAddCalciumCarbonate?: DirectAddCalciumCarbonate
  /** Salts the solver added on the grower's behalf to fully match a target — see `SaltAutoAddNote`. */
  autoAddedSalts?: SaltAutoAddNote[]
}

export const RAW_SALTS = {
  calciumNitrate: { name: "Calcium Nitrate", formula: "Ca(NO₃)₂·4H₂O", ca: 0.169, n: 0.118 },
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

/** Used when loading old saved formulations that pre-date per-salt selection. */
export const ALL_SALTS_SELECTED: IncludedSaltsSelection = {
  calciumNitrate: true,
  calciumCarbonate: true,
  calciumChloride: true,
  calciumAcetate: true,
  calciumGluconate: true,
  potassiumNitrate: true,
  urea: true,
  potassiumSulfate: true,
  monoPotassiumPhosphate: true,
  monoAmmoniumPhosphate: true,
  magnesiumSulfate: true,
  magnesiumNitrate: true,
  ammoniumNitrateOrSulfate: true,
  chelatedMicronutrients: true,
}

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
    sublabel: "Select this and Calcium Nitrate for\nAmmonium calcium nitrate double salt.",
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
 * parts by chemistry rather than by original bottle (the "Separate Nitrogen"
 * 3-tank layout, the Direct Mix layout, and the EC estimate) — those modes
 * aren't trying to mirror which part a salt came from, so any salt the user
 * indicated is present *anywhere* in their product is fair game. Per-part
 * tank layouts (A+B / doser "one tank per part") must NOT use this — they
 * read each part's own `includedSalts` directly so salts stay confined to
 * the part the user said they belong to.
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

/** Max parts for which the Separate Nitrogen tapering layout is offered */
export const SEPARATE_NITROGEN_MAX_PARTS = 3

export function isSeparateNitrogenAvailable(partCount: number): boolean {
  return partCount <= SEPARATE_NITROGEN_MAX_PARTS
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
}

export interface DirectMixRecipe {
  salts: SaltAmounts
  warnings: SaltGapWarning[]
  isApproximate: boolean
  /** Calcium Carbonate needed for this recipe, to add directly to the reservoir rather than mixing it in with the rest of the salts */
  directAddCalciumCarbonate?: DirectAddCalciumCarbonate
  /** Salts the solver added on the grower's behalf to fully match a target — see `SaltAutoAddNote`. */
  autoAddedSalts?: SaltAutoAddNote[]
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
 * Two-tank layout for the "Separate Calcium Nitrate" mode. The split keeps
 * the calcium ion completely isolated so it can be tapered down at the end of
 * flower without rebalancing the rest of the recipe.
 *
 * Tank 1 — Calcium source only: Calcium Nitrate, and/or Calcium Chloride or
 *          Calcium Carbonate when used instead (or alongside) as a
 *          nitrogen-free calcium source (taper Tank 1 for end-of-flower N
 *          reduction when Calcium Nitrate is the source)
 * Tank 2 — Everything else: remaining macros (KNO₃, Mg(NO₃)₂, MKP/MAP,
 *          MgSO₄, K₂SO₄, Urea) plus the micronutrients (Fe-DTPA, Mn/Zn/Cu
 *          EDTA chelates, boric acid, sodium molybdate) — always merged
 *          together into one clean Tank 2 rather than split into a separate
 *          micros tank.
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
 * The micronutrient salts, grouped for two purposes: (1) merging them into
 * Tank 2 in `calculateSeparateCalciumRecipe` below, and (2) identifying
 * which salts to consolidate into a single "Micros" tank in
 * `calculateDoserMultiPartRecipe` (a separate, per-part-doser feature —
 * see `recipe-calculator.ts`).
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
  calciumNitrate: 1290,
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
 * A+B / multi-tank setups too, not just doser mode.
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
 * A nutrient part's own feed-chart dose, normalized to dry grams per US
 * gallon of working (reservoir) feed — converting a liquid `ml_per_gallon`
 * dose via the standard liquid-concentrate density when needed.
 */
export function getDoseGramsPerGallon(part: NutrientPart): number {
  const dose = parsePositive(part.dose)
  if (dose === 0) return 0
  return part.unit === "ml_per_gallon" ? dose * LIQUID_CONCENTRATE_DENSITY : dose
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
    return total + (part.unit === "ml_per_gallon" ? dose : dose / LIQUID_CONCENTRATE_DENSITY)
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

export function formatPpm(ppm: number): string {
  if (!Number.isFinite(ppm) || ppm <= 0) return "—"
  if (ppm < 1) return `${ppm.toFixed(3)} ppm`
  return `${ppm.toFixed(1)} ppm`
}

export function formatMl(ml: number): string {
  if (!Number.isFinite(ml) || ml <= 0) return "—"
  if (ml >= 100) return ml.toFixed(0)
  if (ml >= 10) return ml.toFixed(1)
  return ml.toFixed(2)
}

export type { StockTankOption }
