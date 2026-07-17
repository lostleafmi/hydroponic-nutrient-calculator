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
  potassiumNitrate: number
  monoPotassiumPhosphate: number
  magnesiumSulfate: number
  potassiumSulfate: number
  ammoniumNitrate: number
  ammoniumSulfate: number
  ironDTPA: number
  manganeseSulfate: number
  zincSulfate: number
  boricAcid: number
  copperSulfate: number
  sodiumMolybdate: number
}

/** An element target that couldn't be (fully) matched with the currently-enabled salts */
export interface SaltGapWarning {
  element: keyof ElementalTargets
  label: string
}

export interface TankRecipe {
  tankA: SaltAmounts
  tankB: SaltAmounts
  /** Targets that couldn't be matched because the salt that would supply them is unchecked */
  warnings?: SaltGapWarning[]
  /** True when one or more targets couldn't be perfectly matched with the enabled salts */
  isApproximate?: boolean
}

export interface ThreeTankRecipe {
  tank1: SaltAmounts
  tank2: SaltAmounts
  tank3: SaltAmounts
  /** True when Tank 3 actually holds any salt — false for micro-free recipes
   *  AND false whenever micros were merged into Tank 2 (the 2-tank default). */
  hasMicroTank: boolean
  /** True when the recipe has any micronutrients at all, regardless of which
   *  tank they ended up in. Use this (rather than `hasMicroTank`) to decide
   *  whether to render a micronutrients sub-section inside Tank 2. */
  hasMicronutrients: boolean
  warnings?: SaltGapWarning[]
  isApproximate?: boolean
}

export const RAW_SALTS = {
  calciumNitrate: { name: "Calcium Nitrate", formula: "Ca(NO₃)₂·4H₂O", ca: 0.169, n: 0.118 },
  potassiumNitrate: { name: "Potassium Nitrate", formula: "KNO₃", k: 0.387, n: 0.139 },
  monoPotassiumPhosphate: { name: "Mono Potassium Phosphate (MKP)", formula: "KH₂PO₄", k: 0.287, p: 0.228 },
  magnesiumSulfate: { name: "Magnesium Sulfate (Epsom Salt)", formula: "MgSO₄·7H₂O", mg: 0.099, s: 0.130 },
  potassiumSulfate: { name: "Potassium Sulfate", formula: "K₂SO₄", k: 0.449, s: 0.184 },
  ammoniumNitrate: { name: "Ammonium Nitrate", formula: "NH₄NO₃", n: 0.35 },
  ammoniumSulfate: { name: "Ammonium Sulfate", formula: "(NH₄)₂SO₄", n: 0.212, s: 0.243 },
  ironDTPA: { name: "Iron DTPA 11%", formula: "Fe-DTPA", fe: 0.11 },
  manganeseSulfate: { name: "Manganese Sulfate", formula: "MnSO₄·H₂O", mn: 0.325 },
  zincSulfate: { name: "Zinc Sulfate", formula: "ZnSO₄·7H₂O", zn: 0.227 },
  boricAcid: { name: "Boric Acid", formula: "H₃BO₃", b: 0.175 },
  copperSulfate: { name: "Copper Sulfate", formula: "CuSO₄·5H₂O", cu: 0.255 },
  sodiumMolybdate: { name: "Sodium Molybdate", formula: "Na₂MoO₄·2H₂O", mo: 0.396 },
} as const

export type SaltKey = keyof typeof RAW_SALTS

/**
 * User-facing "Salts & Inputs Included" selection captured on the Guaranteed
 * Analysis screen. Each boolean gates one or more underlying `SaltKey`s in
 * the solver (see `getEnabledSaltKeys`).
 *
 * `chelatedMicronutrients` replaces the old `ironChelate` field and now gates
 * the full micronutrient package: Fe-DTPA, MnSO₄, ZnSO₄, H₃BO₃, CuSO₄,
 * Na₂MoO₄. Most commercial nutrient lines ship all six together.
 */
export interface IncludedSaltsSelection {
  calciumNitrate: boolean
  potassiumNitrate: boolean
  potassiumSulfate: boolean
  monoPotassiumPhosphate: boolean
  magnesiumSulfate: boolean
  ammoniumNitrateOrSulfate: boolean
  chelatedMicronutrients: boolean
}

/** Default for new sessions — all unchecked so the user consciously selects what is in their product. */
export const DEFAULT_INCLUDED_SALTS: IncludedSaltsSelection = {
  calciumNitrate: false,
  potassiumNitrate: false,
  potassiumSulfate: false,
  monoPotassiumPhosphate: false,
  magnesiumSulfate: false,
  ammoniumNitrateOrSulfate: false,
  chelatedMicronutrients: false,
}

/** Used when loading old saved formulations that pre-date per-salt selection. */
export const ALL_SALTS_SELECTED: IncludedSaltsSelection = {
  calciumNitrate: true,
  potassiumNitrate: true,
  potassiumSulfate: true,
  monoPotassiumPhosphate: true,
  magnesiumSulfate: true,
  ammoniumNitrateOrSulfate: true,
  chelatedMicronutrients: true,
}

/** Checkbox options rendered on the "Salts & Inputs Included" screen */
export interface SaltCheckboxOption {
  id: keyof IncludedSaltsSelection
  label: string
  sublabel: string
  /** Underlying solver salt keys this checkbox gates */
  saltKeys: SaltKey[]
}

export const SALT_CHECKBOX_OPTIONS: SaltCheckboxOption[] = [
  { id: "calciumNitrate", label: "Calcium Nitrate", sublabel: "", saltKeys: ["calciumNitrate"] },
  { id: "potassiumNitrate", label: "Potassium Nitrate", sublabel: "", saltKeys: ["potassiumNitrate"] },
  { id: "potassiumSulfate", label: "Potassium Sulfate", sublabel: "", saltKeys: ["potassiumSulfate"] },
  {
    id: "monoPotassiumPhosphate",
    label: "Monopotassium Phosphate",
    sublabel: "",
    saltKeys: ["monoPotassiumPhosphate"],
  },
  {
    id: "magnesiumSulfate",
    label: "Magnesium Sulfate",
    sublabel: "",
    saltKeys: ["magnesiumSulfate"],
  },
  {
    id: "ammoniumNitrateOrSulfate",
    label: "Ammonium Nitrate / Ammonium Sulfate",
    sublabel: "",
    saltKeys: ["ammoniumNitrate", "ammoniumSulfate"],
  },
  {
    id: "chelatedMicronutrients",
    label: "Chelated Micronutrients (Fe, Mn, Zn, B, Cu, Mo)",
    sublabel: "Iron EDTA/DTPA, Manganese EDTA, Copper EDTA, Zinc EDTA, Boric Acid, Sodium Molybdate, etc.",
    saltKeys: ["ironDTPA", "manganeseSulfate", "zincSulfate", "boricAcid", "copperSulfate", "sodiumMolybdate"],
  },
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
  return enabled
}

/** Max parts for which the Separate Nitrogen tapering layout is offered */
export const SEPARATE_NITROGEN_MAX_PARTS = 3

export function isSeparateNitrogenAvailable(partCount: number): boolean {
  return partCount <= SEPARATE_NITROGEN_MAX_PARTS
}

/** Safe dissolve order when displaying or mixing salts within one stock tank */
export const SALT_DISPLAY_ORDER: SaltKey[] = [
  "calciumNitrate",
  "potassiumNitrate",
  "ammoniumNitrate",
  "ironDTPA",
  "monoPotassiumPhosphate",
  "magnesiumSulfate",
  "potassiumSulfate",
  "ammoniumSulfate",
  "manganeseSulfate",
  "zincSulfate",
  "boricAcid",
  "copperSulfate",
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
}

export interface DirectMixRecipe {
  salts: SaltAmounts
  warnings: SaltGapWarning[]
  isApproximate: boolean
}

/**
 * Tank assignment is driven by precipitation chemistry, not by recipe order.
 *
 * Calcium ions (Ca²⁺) form insoluble precipitates with phosphate (PO₄³⁻) and
 * sulfate (SO₄²⁻) when held at stock-tank concentrations. They MUST live in
 * different concentrated tanks. Once diluted into the working reservoir the
 * concentrations are low enough that the same ions coexist safely.
 *
 * Tank A — calcium-side (Ca²⁺ source + compatible nitrates / chelated iron)
 * Tank B — phosphate / sulfate-side (PO₄³⁻ + SO₄²⁻ salts, including micro sulfates)
 */
export const TANK_A_SALTS = [
  "calciumNitrate",
  "potassiumNitrate",
  "ammoniumNitrate",
  "ironDTPA",
] as const satisfies readonly SaltKey[]

export const TANK_B_SALTS = [
  "monoPotassiumPhosphate",
  "magnesiumSulfate",
  "potassiumSulfate",
  "ammoniumSulfate",
  "manganeseSulfate",
  "zincSulfate",
  "boricAcid",
  "copperSulfate",
  "sodiumMolybdate",
] as const satisfies readonly SaltKey[]

/**
 * Three-tank layout for the "Separate Calcium Nitrate" mode. The split keeps
 * the calcium ion completely isolated so it can be tapered down at the end of
 * flower without rebalancing the rest of the recipe.
 *
 * Tank 1 — Calcium Nitrate only (taper this for end-of-flower N reduction)
 * Tank 2 — Remaining macros: KNO₃, MKP, MgSO₄, K₂SO₄
 * Tank 3 — Micros (Fe-DTPA + micro sulfates + boric acid + sodium molybdate)
 *
 * Tank 3 is only used when the recipe actually contains micronutrients. Without
 * micros the calculator naturally collapses to a 2-tank layout (1 + 2).
 */
export const TANK_1_SALTS = ["calciumNitrate"] as const satisfies readonly SaltKey[]

export const TANK_2_SALTS = [
  "potassiumNitrate",
  "ammoniumNitrate",
  "monoPotassiumPhosphate",
  "magnesiumSulfate",
  "potassiumSulfate",
  "ammoniumSulfate",
] as const satisfies readonly SaltKey[]

export const TANK_3_SALTS = [
  "ironDTPA",
  "manganeseSulfate",
  "zincSulfate",
  "boricAcid",
  "copperSulfate",
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
  potassiumNitrate: 316,
  monoPotassiumPhosphate: 226,
  magnesiumSulfate: 710,
  potassiumSulfate: 111,
  ammoniumNitrate: 1920,
  ammoniumSulfate: 754,
  ironDTPA: 500,
  manganeseSulfate: 700,
  zincSulfate: 960,
  boricAcid: 47,
  copperSulfate: 317,
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
    potassiumNitrate: 0,
    monoPotassiumPhosphate: 0,
    magnesiumSulfate: 0,
    potassiumSulfate: 0,
    ammoniumNitrate: 0,
    ammoniumSulfate: 0,
    ironDTPA: 0,
    manganeseSulfate: 0,
    zincSulfate: 0,
    boricAcid: 0,
    copperSulfate: 0,
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

/** Grams of concentrate applied per liter of working (reservoir) solution */
export function getConcentrateGramsPerLiter(part: NutrientPart): number {
  const dose = parsePositive(part.dose)
  if (dose === 0) return 0

  const gramsPerGallon =
    part.unit === "ml_per_gallon" ? dose * LIQUID_CONCENTRATE_DENSITY : dose

  return gramsPerGallon / LITERS_PER_GALLON
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
