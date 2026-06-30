import type { PartAnalysis } from "@/components/hydro-calc/guaranteed-analysis-screen"
import type { NutrientPart, StockTankOption } from "@/components/hydro-calc/feeding-rates-screen"

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
 * Element-to-Fe ratios for filling in missing micronutrients.
 * Based on standard hydroponic recipes (Hoagland-style):
 *   Fe : Mn ≈ 3.5 : 1   → Mn = Fe / 3.5
 *   Fe : Zn ≈ 7   : 1   → Zn = Fe / 7
 *   Fe : B  ≈ 9   : 1   → B  = Fe / 9
 *   Fe : Cu ≈ 18  : 1   → Cu = Fe / 18
 *   Fe : Mo ≈ 1200: 1   → Mo = Fe / 1200
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
  ironDTPA: number
  manganeseSulfate: number
  zincSulfate: number
  boricAcid: number
  copperSulfate: number
  sodiumMolybdate: number
}

export interface TankRecipe {
  tankA: SaltAmounts
  tankB: SaltAmounts
}

export interface ThreeTankRecipe {
  tank1: SaltAmounts
  tank2: SaltAmounts
  tank3: SaltAmounts
  /** True when Tank 3 actually holds any salt — false for micro-free recipes. */
  hasMicroTank: boolean
}

export const RAW_SALTS = {
  calciumNitrate: { name: "Calcium Nitrate", formula: "Ca(NO₃)₂·4H₂O", ca: 0.169, n: 0.118 },
  potassiumNitrate: { name: "Potassium Nitrate", formula: "KNO₃", k: 0.387, n: 0.139 },
  monoPotassiumPhosphate: { name: "Mono Potassium Phosphate (MKP)", formula: "KH₂PO₄", k: 0.287, p: 0.228 },
  magnesiumSulfate: { name: "Magnesium Sulfate (Epsom Salt)", formula: "MgSO₄·7H₂O", mg: 0.099, s: 0.130 },
  potassiumSulfate: { name: "Potassium Sulfate", formula: "K₂SO₄", k: 0.449, s: 0.184 },
  ironDTPA: { name: "Iron DTPA 11%", formula: "Fe-DTPA", fe: 0.11 },
  manganeseSulfate: { name: "Manganese Sulfate", formula: "MnSO₄·H₂O", mn: 0.325 },
  zincSulfate: { name: "Zinc Sulfate", formula: "ZnSO₄·7H₂O", zn: 0.227 },
  boricAcid: { name: "Boric Acid", formula: "H₃BO₃", b: 0.175 },
  copperSulfate: { name: "Copper Sulfate", formula: "CuSO₄·5H₂O", cu: 0.255 },
  sodiumMolybdate: { name: "Sodium Molybdate", formula: "Na₂MoO₄·2H₂O", mo: 0.396 },
} as const

export type SaltKey = keyof typeof RAW_SALTS

/** Max parts for which the Separate Nitrogen tapering layout is offered */
export const SEPARATE_NITROGEN_MAX_PARTS = 3

export function isSeparateNitrogenAvailable(partCount: number): boolean {
  return partCount <= SEPARATE_NITROGEN_MAX_PARTS
}

/** Safe dissolve order when displaying or mixing salts within one stock tank */
export const SALT_DISPLAY_ORDER: SaltKey[] = [
  "calciumNitrate",
  "potassiumNitrate",
  "ironDTPA",
  "monoPotassiumPhosphate",
  "magnesiumSulfate",
  "potassiumSulfate",
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
  "ironDTPA",
] as const satisfies readonly SaltKey[]

export const TANK_B_SALTS = [
  "monoPotassiumPhosphate",
  "magnesiumSulfate",
  "potassiumSulfate",
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
  "monoPotassiumPhosphate",
  "magnesiumSulfate",
  "potassiumSulfate",
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

function emptySaltAmounts(): SaltAmounts {
  return {
    calciumNitrate: 0,
    potassiumNitrate: 0,
    monoPotassiumPhosphate: 0,
    magnesiumSulfate: 0,
    potassiumSulfate: 0,
    ironDTPA: 0,
    manganeseSulfate: 0,
    zincSulfate: 0,
    boricAcid: 0,
    copperSulfate: 0,
    sodiumMolybdate: 0,
  }
}

function parsePositive(value: string | undefined): number {
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

/**
 * Element ppm in the final working solution from a single % (by weight) in the concentrate.
 * ppm = (% / 100) × g concentrate per L × 1000 mg/g
 */
function percentToPpm(percent: number, concentrateGramsPerLiter: number): number {
  return (percent / 100) * concentrateGramsPerLiter * 1000
}

/** Per-part elemental contribution, summed across all dosed parts */
export function calculateElementalTargets(
  partsAnalysis: PartAnalysis[],
  parts: NutrientPart[]
): ElementalTargets {
  const analysisById = new Map(partsAnalysis.map((part) => [part.id, part]))
  const totals: ElementalTargets = {
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

  for (const feedingPart of parts) {
    const analysis = analysisById.get(feedingPart.id)
    if (!analysis) continue

    const concentrateGramsPerLiter = getConcentrateGramsPerLiter(feedingPart)
    if (concentrateGramsPerLiter === 0) continue

    totals.nitrogen += percentToPpm(parsePositive(analysis.nitrogen), concentrateGramsPerLiter)
    totals.phosphorus += percentToPpm(parsePositive(analysis.phosphate) * P2O5_TO_P, concentrateGramsPerLiter)
    totals.potassium += percentToPpm(parsePositive(analysis.potash) * K2O_TO_K, concentrateGramsPerLiter)
    totals.calcium += percentToPpm(parsePositive(analysis.calcium), concentrateGramsPerLiter)
    totals.magnesium += percentToPpm(parsePositive(analysis.magnesium), concentrateGramsPerLiter)
    totals.sulfur += percentToPpm(parsePositive(analysis.sulfur), concentrateGramsPerLiter)
    totals.iron += percentToPpm(parsePositive(analysis.iron), concentrateGramsPerLiter)
    totals.manganese += percentToPpm(parsePositive(analysis.manganese), concentrateGramsPerLiter)
    totals.zinc += percentToPpm(parsePositive(analysis.zinc), concentrateGramsPerLiter)
    totals.boron += percentToPpm(parsePositive(analysis.boron), concentrateGramsPerLiter)
    totals.copper += percentToPpm(parsePositive(analysis.copper), concentrateGramsPerLiter)
    totals.molybdenum += percentToPpm(parsePositive(analysis.molybdenum), concentrateGramsPerLiter)
  }

  return totals
}

/**
 * Fill in any missing micronutrient targets (ppm = 0) using standard
 * hydroponic Fe-anchored ratios. If Fe is missing, the first non-zero micro
 * in priority order is used to back-derive an implied Fe ppm and the rest
 * are estimated from that.
 */
export function applyMicroEstimates(targets: ElementalTargets): EstimatedTargets {
  const estimated = new Set<MicroKey>()
  const result: ElementalTargets = { ...targets }

  let anchor: MicroKey | null = null
  for (const key of MICRO_KEYS) {
    if (targets[key] > 0) {
      anchor = key
      break
    }
  }

  if (anchor === null) {
    return { targets: result, estimated, anchor: null }
  }

  // Back-derive an implied Fe ppm from whatever anchor we have, then estimate
  // every missing micro from that single reference value.
  const impliedIron = result[anchor] / MICRO_TO_FE_RATIO[anchor]

  for (const key of MICRO_KEYS) {
    if (targets[key] > 0) continue
    result[key] = impliedIron * MICRO_TO_FE_RATIO[key]
    estimated.add(key)
  }

  return { targets: result, estimated, anchor }
}

/** Grams of salt in a stock tank to deliver target ppm when diluted 1:ratio */
function saltGramsForTargetPpm(
  targetPpm: number,
  elementFraction: number,
  stockVolumeLiters: number,
  dilutionRatio: number
): number {
  if (targetPpm <= 0 || elementFraction <= 0) return 0
  return (targetPpm * dilutionRatio * stockVolumeLiters) / (elementFraction * 1000)
}

/** ppm contributed when stock tank salt is diluted 1:ratio into working solution */
function ppmFromSaltInStock(
  saltGrams: number,
  elementFraction: number,
  stockVolumeLiters: number,
  dilutionRatio: number
): number {
  if (saltGrams <= 0 || stockVolumeLiters <= 0) return 0
  return ((saltGrams * elementFraction) / stockVolumeLiters) * (1000 / dilutionRatio)
}

/**
 * Build A/B stock tank recipes using a standard hydroponic salt sequence:
 * Tank A — Ca(NO₃)₂, KNO₃ (remaining N), Fe-DTPA  (see TANK_A_SALTS)
 * Tank B — MKP, MgSO₄, K₂SO₄ (remaining K), micronutrient sulfates  (see TANK_B_SALTS)
 *
 * Calcium and phosphate are assigned to opposite tanks by construction so they
 * never coexist in a concentrated stock solution where they would precipitate.
 */
export function calculateStockTankRecipe(
  targets: ElementalTargets,
  stockVolumeLiters: number,
  dilutionRatio: number
): TankRecipe {
  const tankA = emptySaltAmounts()
  const tankB = emptySaltAmounts()

  if (stockVolumeLiters <= 0 || dilutionRatio <= 0) {
    return { tankA, tankB }
  }

  const assignToTankA = (key: (typeof TANK_A_SALTS)[number], grams: number) => {
    tankA[key] = grams
  }
  const assignToTankB = (key: (typeof TANK_B_SALTS)[number], grams: number) => {
    tankB[key] = grams
  }

  // Tank A — calcium-side (Ca²⁺ + nitrates + chelated Fe)
  assignToTankA(
    "calciumNitrate",
    saltGramsForTargetPpm(
      targets.calcium,
      RAW_SALTS.calciumNitrate.ca,
      stockVolumeLiters,
      dilutionRatio
    )
  )

  const nitrogenFromCalciumNitrate = ppmFromSaltInStock(
    tankA.calciumNitrate,
    RAW_SALTS.calciumNitrate.n,
    stockVolumeLiters,
    dilutionRatio
  )

  const remainingNitrogenPpm = Math.max(0, targets.nitrogen - nitrogenFromCalciumNitrate)
  assignToTankA(
    "potassiumNitrate",
    saltGramsForTargetPpm(
      remainingNitrogenPpm,
      RAW_SALTS.potassiumNitrate.n,
      stockVolumeLiters,
      dilutionRatio
    )
  )

  assignToTankA(
    "ironDTPA",
    saltGramsForTargetPpm(
      targets.iron,
      RAW_SALTS.ironDTPA.fe,
      stockVolumeLiters,
      dilutionRatio
    )
  )

  // Tank B — phosphate/sulfate-side (kept apart from Ca to prevent precipitation)
  assignToTankB(
    "monoPotassiumPhosphate",
    saltGramsForTargetPpm(
      targets.phosphorus,
      RAW_SALTS.monoPotassiumPhosphate.p,
      stockVolumeLiters,
      dilutionRatio
    )
  )

  assignToTankB(
    "magnesiumSulfate",
    saltGramsForTargetPpm(
      targets.magnesium,
      RAW_SALTS.magnesiumSulfate.mg,
      stockVolumeLiters,
      dilutionRatio
    )
  )

  const potassiumFromMkp = ppmFromSaltInStock(
    tankB.monoPotassiumPhosphate,
    RAW_SALTS.monoPotassiumPhosphate.k,
    stockVolumeLiters,
    dilutionRatio
  )

  const potassiumFromPotassiumNitrate = ppmFromSaltInStock(
    tankA.potassiumNitrate,
    RAW_SALTS.potassiumNitrate.k,
    stockVolumeLiters,
    dilutionRatio
  )

  const remainingPotassiumPpm = Math.max(
    0,
    targets.potassium - potassiumFromMkp - potassiumFromPotassiumNitrate
  )

  assignToTankB(
    "potassiumSulfate",
    saltGramsForTargetPpm(
      remainingPotassiumPpm,
      RAW_SALTS.potassiumSulfate.k,
      stockVolumeLiters,
      dilutionRatio
    )
  )

  // Sulfur is supplied as a byproduct of MgSO₄ + K₂SO₄. We intentionally do
  // NOT add more K₂SO₄ to chase the sulfur target — that would overshoot K.
  // Hydroponic plants tolerate a wide S range, so any deficit is acceptable.

  assignToTankB(
    "manganeseSulfate",
    saltGramsForTargetPpm(
      targets.manganese,
      RAW_SALTS.manganeseSulfate.mn,
      stockVolumeLiters,
      dilutionRatio
    )
  )

  assignToTankB(
    "zincSulfate",
    saltGramsForTargetPpm(
      targets.zinc,
      RAW_SALTS.zincSulfate.zn,
      stockVolumeLiters,
      dilutionRatio
    )
  )

  assignToTankB(
    "boricAcid",
    saltGramsForTargetPpm(
      targets.boron,
      RAW_SALTS.boricAcid.b,
      stockVolumeLiters,
      dilutionRatio
    )
  )

  assignToTankB(
    "copperSulfate",
    saltGramsForTargetPpm(
      targets.copper,
      RAW_SALTS.copperSulfate.cu,
      stockVolumeLiters,
      dilutionRatio
    )
  )

  assignToTankB(
    "sodiumMolybdate",
    saltGramsForTargetPpm(
      targets.molybdenum,
      RAW_SALTS.sodiumMolybdate.mo,
      stockVolumeLiters,
      dilutionRatio
    )
  )

  return { tankA, tankB }
}

/**
 * Build a 3-tank recipe with calcium nitrate isolated.
 *
 *   Tank 1 — Calcium Nitrate only (Ca²⁺). Taper this to drop N at end of flower.
 *   Tank 2 — Remaining macro salts: KNO₃, MKP, MgSO₄, K₂SO₄.
 *   Tank 3 — Micros: Fe-DTPA, MnSO₄, ZnSO₄, H₃BO₃, CuSO₄, Na₂MoO₄.
 *
 * Tank 3 is reported separately so callers can hide it when no micros are
 * required (the layout naturally collapses to two tanks in that case).
 */
export function calculateSeparateCalciumRecipe(
  targets: ElementalTargets,
  stockVolumeLiters: number,
  dilutionRatio: number
): ThreeTankRecipe {
  const { tankA, tankB } = calculateStockTankRecipe(targets, stockVolumeLiters, dilutionRatio)

  const tank1 = emptySaltAmounts()
  const tank2 = emptySaltAmounts()
  const tank3 = emptySaltAmounts()

  for (const key of TANK_1_SALTS) {
    tank1[key] = tankA[key]
  }
  for (const key of TANK_2_SALTS) {
    tank2[key] = key === "potassiumNitrate" ? tankA[key] : tankB[key]
  }
  for (const key of TANK_3_SALTS) {
    tank3[key] = key === "ironDTPA" ? tankA[key] : tankB[key]
  }

  const hasMicroTank = (Object.values(tank3) as number[]).some((g) => g > 0)

  return { tank1, tank2, tank3, hasMicroTank }
}

function combineSaltAmounts(a: SaltAmounts, b: SaltAmounts): SaltAmounts {
  const combined = emptySaltAmounts()
  for (const key of SALT_DISPLAY_ORDER) {
    combined[key] = a[key] + b[key]
  }
  return combined
}

function saltAmountsHasContent(salts: SaltAmounts): boolean {
  return SALT_DISPLAY_ORDER.some((key) => salts[key] > 0)
}

/** Non-zero salts in a safe mixing order for display */
export function getOrderedSaltEntries(salts: SaltAmounts): Array<[SaltKey, number]> {
  return SALT_DISPLAY_ORDER.filter((key) => salts[key] > 0).map((key) => [key, salts[key]])
}

/**
 * One stock tank per nutrient part the user entered. Each part's guaranteed
 * analysis and feed rate drive the salts in that tank — mirroring how
 * commercial multi-part lines are bottled.
 */
export function calculateMultiPartStockTankRecipe(
  partsAnalysis: PartAnalysis[],
  parts: NutrientPart[],
  stockVolumeLiters: number,
  dilutionRatio: number
): MultiPartTankRecipe {
  const analysisById = new Map(partsAnalysis.map((part) => [part.id, part]))
  const tanks: PartStockTank[] = []
  let tankIndex = 0

  for (const feedingPart of parts) {
    if (parsePositive(feedingPart.dose) === 0) continue
    const analysis = analysisById.get(feedingPart.id)
    if (!analysis) continue

    const rawTargets = calculateElementalTargets([analysis], [feedingPart])
    const hasAnyElement = Object.values(rawTargets).some((value) => value > 0)
    if (!hasAnyElement) continue

    const { targets } = applyMicroEstimates(rawTargets)
    const { tankA, tankB } = calculateStockTankRecipe(
      targets,
      stockVolumeLiters,
      dilutionRatio
    )
    const salts = combineSaltAmounts(tankA, tankB)
    if (!saltAmountsHasContent(salts)) continue

    tankIndex += 1
    tanks.push({
      index: tankIndex,
      name: `Tank ${tankIndex}`,
      partName: feedingPart.name,
      partId: feedingPart.id,
      salts,
    })
  }

  return { tanks }
}

/**
 * Doser-optimized variant of calculateMultiPartStockTankRecipe.
 *
 * Keeps one stock tank per original nutrient part for the macro salts, but
 * strips all micro salts (Fe, Mn, Zn, B, Cu, Mo) out of every per-part tank
 * and accumulates them into a single consolidated "Micros" tank appended at
 * the end.
 *
 * Rationale: splitting micronutrients across many per-part tanks produces
 * unmeasurably small amounts (e.g. 0.001 g of Sodium Molybdate per tank).
 * Consolidating them into one tank keeps the amounts large enough to weigh
 * accurately, while every part still gets its own suction line for macros.
 */
export function calculateDoserMultiPartRecipe(
  partsAnalysis: PartAnalysis[],
  parts: NutrientPart[],
  stockVolumeLiters: number,
  dilutionRatio: number
): MultiPartTankRecipe {
  const analysisById = new Map(partsAnalysis.map((part) => [part.id, part]))
  const macroTanks: PartStockTank[] = []
  const consolidatedMicros = emptySaltAmounts()
  let tankIndex = 0

  const microKeys = new Set<SaltKey>(TANK_3_SALTS)

  for (const feedingPart of parts) {
    if (parsePositive(feedingPart.dose) === 0) continue
    const analysis = analysisById.get(feedingPart.id)
    if (!analysis) continue

    const rawTargets = calculateElementalTargets([analysis], [feedingPart])
    const hasAnyElement = Object.values(rawTargets).some((value) => value > 0)
    if (!hasAnyElement) continue

    const { targets } = applyMicroEstimates(rawTargets)
    const { tankA, tankB } = calculateStockTankRecipe(targets, stockVolumeLiters, dilutionRatio)
    const allSalts = combineSaltAmounts(tankA, tankB)

    const macroSalts = emptySaltAmounts()
    for (const key of SALT_DISPLAY_ORDER) {
      if (microKeys.has(key)) {
        consolidatedMicros[key] += allSalts[key]
      } else {
        macroSalts[key] = allSalts[key]
      }
    }

    if (!saltAmountsHasContent(macroSalts)) continue

    tankIndex += 1
    macroTanks.push({
      index: tankIndex,
      name: `Tank ${tankIndex}`,
      partName: feedingPart.name,
      partId: feedingPart.id,
      salts: macroSalts,
    })
  }

  const tanks = [...macroTanks]

  if (saltAmountsHasContent(consolidatedMicros)) {
    tankIndex += 1
    tanks.push({
      index: tankIndex,
      name: `Tank ${tankIndex}`,
      partName: "Micros",
      partId: "consolidated-micros",
      salts: consolidatedMicros,
      isMicroTank: true,
    })
  }

  return { tanks }
}

/** Working-strength recipe for direct mixing into a reservoir of `reservoirLiters` litres */
export function calculateDirectMixRecipe(targets: ElementalTargets, reservoirLiters: number): SaltAmounts {
  // A 1:1 stock tank of exactly reservoirLiters is equivalent to working-strength direct mix.
  const stockRecipe = calculateStockTankRecipe(targets, reservoirLiters, 1)

  const combined = emptySaltAmounts()
  const keys = Object.keys(combined) as Array<keyof SaltAmounts>

  for (const key of keys) {
    combined[key] = stockRecipe.tankA[key] + stockRecipe.tankB[key]
  }

  return combined
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

/** Molar conductivity at 25 °C, infinite dilution (S·cm²/mol) */
const ION_CONDUCTIVITY = {
  K: 73.5,
  Ca: 59.0,
  Mg: 53.06,
  NO3: 71.44,
  H2PO4: 36.0,
  SO4: 79.8,
} as const

const ION_ATOMIC_WEIGHT = {
  K: 39.098,
  Ca: 40.078,
  Mg: 24.305,
  N: 14.007,
  P: 30.974,
  S: 32.06,
} as const

function ppmToMolPerLiter(ppm: number, atomicWeight: number): number {
  if (ppm <= 0 || atomicWeight <= 0) return 0
  return ppm / (atomicWeight * 1000)
}

function ecContribution(molarity: number, lambda: number): number {
  return molarity * lambda
}

/** EC (mS/cm) from dissolved ions at working-solution strength */
function ecFromSaltAmounts(salts: SaltAmounts): number {
  const caPpm = salts.calciumNitrate * RAW_SALTS.calciumNitrate.ca * 1000
  const nFromCaNo3 = salts.calciumNitrate * RAW_SALTS.calciumNitrate.n * 1000
  const kFromKno3 = salts.potassiumNitrate * RAW_SALTS.potassiumNitrate.k * 1000
  const nFromKno3 = salts.potassiumNitrate * RAW_SALTS.potassiumNitrate.n * 1000
  const kFromMkp = salts.monoPotassiumPhosphate * RAW_SALTS.monoPotassiumPhosphate.k * 1000
  const pFromMkp = salts.monoPotassiumPhosphate * RAW_SALTS.monoPotassiumPhosphate.p * 1000
  const mgPpm = salts.magnesiumSulfate * RAW_SALTS.magnesiumSulfate.mg * 1000
  const sFromMgSO4 = salts.magnesiumSulfate * RAW_SALTS.magnesiumSulfate.s * 1000
  const kFromK2SO4 = salts.potassiumSulfate * RAW_SALTS.potassiumSulfate.k * 1000
  const sFromK2SO4 = salts.potassiumSulfate * RAW_SALTS.potassiumSulfate.s * 1000

  const kPpm = kFromKno3 + kFromMkp + kFromK2SO4
  const nPpm = nFromCaNo3 + nFromKno3
  const sPpm = sFromMgSO4 + sFromK2SO4

  return (
    ecContribution(ppmToMolPerLiter(kPpm, ION_ATOMIC_WEIGHT.K), ION_CONDUCTIVITY.K) +
    ecContribution(ppmToMolPerLiter(caPpm, ION_ATOMIC_WEIGHT.Ca), ION_CONDUCTIVITY.Ca) +
    ecContribution(ppmToMolPerLiter(mgPpm, ION_ATOMIC_WEIGHT.Mg), ION_CONDUCTIVITY.Mg) +
    ecContribution(ppmToMolPerLiter(nPpm, ION_ATOMIC_WEIGHT.N), ION_CONDUCTIVITY.NO3) +
    ecContribution(ppmToMolPerLiter(pFromMkp, ION_ATOMIC_WEIGHT.P), ION_CONDUCTIVITY.H2PO4) +
    ecContribution(ppmToMolPerLiter(sPpm, ION_ATOMIC_WEIGHT.S), ION_CONDUCTIVITY.SO4)
  )
}

/**
 * Empirical multiplier applied to the theoretical ionic-conductivity sum.
 * Accounts for unlisted ionic species in commercial fertilizers (ammoniacal-N,
 * chelating agents, pH buffers, salt-form impurities) that the five-salt model
 * cannot capture. Derived from comparison against real manufacturer EC charts;
 * adjust if future testing across more recipes warrants it.
 */
const EC_REAL_WORLD_FACTOR = 1.1

/**
 * Flat additive buffer (mS/cm) on top of the scaled theoretical EC.
 * Covers chelated micronutrient complexes (Fe-EDTA, Mn-EDTA, etc.) and other
 * low-concentration ionic contributors that are present in every commercial
 * nutrient solution but absent from the guaranteed-analysis label.
 */
const EC_ADDITIVE_BUFFER_MS_CM = 0.08

/**
 * Estimate the EC of the final working reservoir from elemental ppm targets.
 * Uses the same salt selection as the stock-tank recipe at working strength,
 * sums ion conductivity at 25 °C, then applies an empirical real-world
 * correction: baseEC * EC_REAL_WORLD_FACTOR + EC_ADDITIVE_BUFFER_MS_CM.
 * Micronutrients are excluded from the ionic sum (negligible contribution)
 * but their aggregate effect is captured by the additive buffer.
 */
export function estimateEcFromElementalTargets(targets: ElementalTargets): number | null {
  const hasMacro =
    targets.nitrogen > 0 ||
    targets.phosphorus > 0 ||
    targets.potassium > 0 ||
    targets.calcium > 0 ||
    targets.magnesium > 0 ||
    targets.sulfur > 0

  if (!hasMacro) return null

  const stockRecipe = calculateStockTankRecipe(targets, 1, 1)
  const salts = emptySaltAmounts()
  for (const key of Object.keys(salts) as SaltKey[]) {
    salts[key] = stockRecipe.tankA[key] + stockRecipe.tankB[key]
  }

  const baseEc = ecFromSaltAmounts(salts)
  if (!Number.isFinite(baseEc) || baseEc <= 0) return null

  const correctedEc = baseEc * EC_REAL_WORLD_FACTOR + EC_ADDITIVE_BUFFER_MS_CM
  return Number.isFinite(correctedEc) && correctedEc > 0 ? correctedEc : null
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
