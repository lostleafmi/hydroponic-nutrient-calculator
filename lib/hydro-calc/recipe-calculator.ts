import "server-only"

/**
 * Core recipe-solving engine — the proprietary logic that turns a
 * guaranteed-analysis + feed-chart input into elemental ppm targets and raw
 * salt amounts.
 *
 * SERVER-ONLY: the `server-only` import above makes the build fail loudly if
 * this module is ever pulled into a Client Component bundle. Nothing in this
 * file should be imported directly by any `"use client"` component — access
 * it exclusively through the Server Actions in `app/actions/calculate-recipe.ts`
 * so the solver logic never ships to the browser.
 */

import type { PartAnalysis } from "@/components/hydro-calc/guaranteed-analysis-screen"
import type { NutrientPart } from "@/components/hydro-calc/feeding-rates-screen"
import {
  emptyElementalTargets,
  emptySaltAmounts,
  getConcentrateGramsPerLiter,
  getEnabledSaltKeys,
  parsePositive,
  RAW_SALTS,
  SALT_DISPLAY_ORDER,
  TANK_1_SALTS,
  TANK_2_SALTS,
  TANK_3_SALTS,
  TANK_A_SALTS,
  TANK_B_SALTS,
  MICRO_KEYS,
  MICRO_TO_FE_RATIO,
  type DirectMixRecipe,
  type ElementalTargets,
  type EstimatedTargets,
  type IncludedSaltsSelection,
  type MicroKey,
  type MultiPartTankRecipe,
  type PartStockTank,
  type SaltAmounts,
  type SaltGapWarning,
  type SaltKey,
  type TankRecipe,
  type ThreeTankRecipe,
} from "@/lib/hydro-calc/recipe-types"

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
  const totals: ElementalTargets = emptyElementalTargets()

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

/** Guaranteed-analysis oxide → elemental conversion factors */
const P2O5_TO_P = 30.974 / 70.974 // ≈ 0.436
const K2O_TO_K = 78.169 / 94.196 // ≈ 0.830

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
 * Tank A — Ca(NO₃)₂ (or CaCO₃ as a nitrogen-free fallback), KNO₃/NH₄NO₃
 *          (remaining N), Fe-DTPA  (see TANK_A_SALTS)
 * Tank B — MKP, MgSO₄, K₂SO₄/(NH₄)₂SO₄ (remaining K), micronutrient sulfates  (see TANK_B_SALTS)
 *
 * Calcium and phosphate are assigned to opposite tanks by construction so they
 * never coexist in a concentrated stock solution where they would precipitate.
 *
 * `includedSalts` restricts which salts the solver is allowed to reach for
 * (see `getEnabledSaltKeys`). When a target's only source salt is disabled,
 * that target is left unmet and reported in `warnings` — the caller should
 * surface a "closest possible recipe" notice. Micronutrient sulfates are
 * always available regardless of the selection.
 */
export function calculateStockTankRecipe(
  targets: ElementalTargets,
  stockVolumeLiters: number,
  dilutionRatio: number,
  includedSalts?: IncludedSaltsSelection
): TankRecipe {
  const tankA = emptySaltAmounts()
  const tankB = emptySaltAmounts()
  const warnings: SaltGapWarning[] = []

  if (stockVolumeLiters <= 0 || dilutionRatio <= 0) {
    return { tankA, tankB, warnings, isApproximate: false }
  }

  const enabled = getEnabledSaltKeys(includedSalts)
  const isEnabled = (key: SaltKey) => enabled.has(key)

  const assignToTankA = (key: (typeof TANK_A_SALTS)[number], grams: number) => {
    tankA[key] = grams
  }
  const assignToTankB = (key: (typeof TANK_B_SALTS)[number], grams: number) => {
    tankB[key] = grams
  }

  // Calcium & Nitrogen are solved together because Ca(NO₃)₂ is the primary
  // source of *both*. Sizing it off the Calcium target alone (the old
  // behavior) routinely under-supplies Nitrogen for "Core + Bloom" style
  // two-part lines (Athena Core, and equivalents from other brands) that
  // ship Ca(NO₃)₂ as their only enabled Nitrogen salt — the solver would
  // then warn about an unmet Nitrogen target even though bumping up the
  // one already-enabled Calcium Nitrate a bit further would close the gap.
  //
  // Strategy: size Ca(NO₃)₂ off the Calcium target first (as before), then
  // check how much Nitrogen that leaves unmet. If there's a gap, prefer
  // KNO₃ when available (extra Nitrogen with no Calcium overshoot), then
  // fall back to topping up Calcium Nitrate itself before reaching for
  // ammonium sources — more Ca(NO₃)₂ still delivers clean nitrate-form N,
  // whereas ammonium salts introduce ammoniacal-N and (for (NH₄)₂SO₄) extra
  // sulfate. Only once no enabled salt can supply Nitrogen at all do we
  // report the gap.
  //
  // When Calcium Carbonate is *also* explicitly enabled (e.g. "Crop
  // Salt"-style lines that blend both Calcium sources), the two must split
  // the Calcium target rather than one silently zeroing the other out.
  //
  // A prior version capped Calcium Nitrate at whichever was smaller of
  // "enough for the full Nitrogen target" or "enough for the full Calcium
  // target," letting Carbonate top up whatever Calcium was left. In
  // practice that only gave Carbonate a non-zero amount when the target's
  // Calcium:Nitrogen ratio happened to exceed Ca(NO₃)₂'s own ratio
  // (RAW_SALTS.calciumNitrate.ca / .n ≈ 1.43) — i.e. almost never for real
  // guaranteed-analysis inputs, since Calcium Nitrate alone can otherwise
  // always reach the full Calcium target before Nitrogen becomes the
  // binding constraint. Carbonate ended up being a fallback that was
  // "ignored" whenever Nitrate was present, exactly the bug this fixes.
  //
  // Fix: give each explicitly-enabled Calcium source a fixed, guaranteed
  // half of the Calcium target up front — independent of the Nitrogen
  // target — so Carbonate always receives a real, non-zero allocation
  // whenever the user checks it. Calcium Nitrate's half may still be
  // bumped upward afterward to help close a Nitrogen gap (the same
  // Calcium-overshoot trade-off already accepted below when Nitrate is the
  // only enabled Calcium source); Carbonate's half is never reduced by
  // that, since it is the whole point of the user's explicit selection.
  let calciumNitrateGrams = 0
  let calciumCarbonateGrams = 0
  const nitrateEnabled = isEnabled("calciumNitrate")
  const carbonateEnabled = isEnabled("calciumCarbonate")

  if (targets.calcium > 0) {
    if (nitrateEnabled && carbonateEnabled) {
      const halfCalciumPpm = targets.calcium / 2

      calciumNitrateGrams = saltGramsForTargetPpm(
        halfCalciumPpm,
        RAW_SALTS.calciumNitrate.ca,
        stockVolumeLiters,
        dilutionRatio
      )
      calciumCarbonateGrams = saltGramsForTargetPpm(
        halfCalciumPpm,
        RAW_SALTS.calciumCarbonate.ca,
        stockVolumeLiters,
        dilutionRatio
      )
    } else if (nitrateEnabled) {
      calciumNitrateGrams = saltGramsForTargetPpm(
        targets.calcium,
        RAW_SALTS.calciumNitrate.ca,
        stockVolumeLiters,
        dilutionRatio
      )
    } else if (carbonateEnabled) {
      // Nitrogen-free calcium fallback when Calcium Nitrate isn't part of the
      // product being replicated. Contributes no Nitrogen, so the remaining-N
      // logic below still needs another enabled salt to close that gap.
      calciumCarbonateGrams = saltGramsForTargetPpm(
        targets.calcium,
        RAW_SALTS.calciumCarbonate.ca,
        stockVolumeLiters,
        dilutionRatio
      )
    } else {
      warnings.push({ element: "calcium", label: "Calcium" })
    }
  }

  const nitrogenFromCalciumNitrate = ppmFromSaltInStock(
    calciumNitrateGrams,
    RAW_SALTS.calciumNitrate.n,
    stockVolumeLiters,
    dilutionRatio
  )

  // Priority for the remaining N: KNO₃ → more Ca(NO₃)₂ → NH₄NO₃ → (NH₄)₂SO₄
  const remainingNitrogenPpm = Math.max(0, targets.nitrogen - nitrogenFromCalciumNitrate)
  if (remainingNitrogenPpm > 0) {
    if (isEnabled("potassiumNitrate")) {
      assignToTankA(
        "potassiumNitrate",
        saltGramsForTargetPpm(remainingNitrogenPpm, RAW_SALTS.potassiumNitrate.n, stockVolumeLiters, dilutionRatio)
      )
    } else if (nitrateEnabled) {
      // No dedicated nitrate-only salt is enabled, but Calcium Nitrate is —
      // re-size it off the full Nitrogen target instead of its Calcium-only
      // share. This grams value is always ≥ the Calcium-based amount above
      // (it's solving for a requirement that's at least as large on the
      // same salt), so the Calcium target stays fully met — with, when
      // Carbonate is also enabled, some unavoidable Calcium overshoot on
      // top of Carbonate's fixed half-share as the trade-off for hitting
      // Nitrogen. Carbonate's own allocation is untouched either way.
      calciumNitrateGrams = saltGramsForTargetPpm(
        targets.nitrogen,
        RAW_SALTS.calciumNitrate.n,
        stockVolumeLiters,
        dilutionRatio
      )
    } else if (isEnabled("ammoniumNitrate")) {
      assignToTankA(
        "ammoniumNitrate",
        saltGramsForTargetPpm(remainingNitrogenPpm, RAW_SALTS.ammoniumNitrate.n, stockVolumeLiters, dilutionRatio)
      )
    } else if (isEnabled("ammoniumSulfate")) {
      assignToTankB(
        "ammoniumSulfate",
        saltGramsForTargetPpm(remainingNitrogenPpm, RAW_SALTS.ammoniumSulfate.n, stockVolumeLiters, dilutionRatio)
      )
    } else {
      warnings.push({ element: "nitrogen", label: "Nitrogen" })
    }
  }

  assignToTankA("calciumNitrate", calciumNitrateGrams)
  assignToTankA("calciumCarbonate", calciumCarbonateGrams)

  // Iron — Fe-DTPA is the only chelate we model
  if (targets.iron > 0) {
    if (isEnabled("ironDTPA")) {
      assignToTankA(
        "ironDTPA",
        saltGramsForTargetPpm(targets.iron, RAW_SALTS.ironDTPA.fe, stockVolumeLiters, dilutionRatio)
      )
    } else {
      warnings.push({ element: "iron", label: "Iron" })
    }
  }

  // Phosphorus — MKP is the only P source we model
  if (targets.phosphorus > 0) {
    if (isEnabled("monoPotassiumPhosphate")) {
      assignToTankB(
        "monoPotassiumPhosphate",
        saltGramsForTargetPpm(targets.phosphorus, RAW_SALTS.monoPotassiumPhosphate.p, stockVolumeLiters, dilutionRatio)
      )
    } else {
      warnings.push({ element: "phosphorus", label: "Phosphorus" })
    }
  }

  // Magnesium — MgSO₄ is the only Mg source we model
  if (targets.magnesium > 0) {
    if (isEnabled("magnesiumSulfate")) {
      assignToTankB(
        "magnesiumSulfate",
        saltGramsForTargetPpm(targets.magnesium, RAW_SALTS.magnesiumSulfate.mg, stockVolumeLiters, dilutionRatio)
      )
    } else {
      warnings.push({ element: "magnesium", label: "Magnesium" })
    }
  }

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

  if (remainingPotassiumPpm > 0) {
    if (isEnabled("potassiumSulfate")) {
      assignToTankB(
        "potassiumSulfate",
        saltGramsForTargetPpm(remainingPotassiumPpm, RAW_SALTS.potassiumSulfate.k, stockVolumeLiters, dilutionRatio)
      )
    } else {
      warnings.push({ element: "potassium", label: "Potassium" })
    }
  }

  // Sulfur is supplied as a byproduct of MgSO₄ + K₂SO₄ (+ (NH₄)₂SO₄ when used
  // for nitrogen). We intentionally do NOT add extra salt just to chase the
  // sulfur target — that would overshoot other elements. Hydroponic plants
  // tolerate a wide S range, so any deficit is acceptable and not warned on.

  // Micronutrients — always available; no realistic alternative source exists
  assignToTankB(
    "manganeseSulfate",
    saltGramsForTargetPpm(targets.manganese, RAW_SALTS.manganeseSulfate.mn, stockVolumeLiters, dilutionRatio)
  )

  assignToTankB(
    "zincSulfate",
    saltGramsForTargetPpm(targets.zinc, RAW_SALTS.zincSulfate.zn, stockVolumeLiters, dilutionRatio)
  )

  assignToTankB(
    "boricAcid",
    saltGramsForTargetPpm(targets.boron, RAW_SALTS.boricAcid.b, stockVolumeLiters, dilutionRatio)
  )

  assignToTankB(
    "copperSulfate",
    saltGramsForTargetPpm(targets.copper, RAW_SALTS.copperSulfate.cu, stockVolumeLiters, dilutionRatio)
  )

  assignToTankB(
    "sodiumMolybdate",
    saltGramsForTargetPpm(targets.molybdenum, RAW_SALTS.sodiumMolybdate.mo, stockVolumeLiters, dilutionRatio)
  )

  return { tankA, tankB, warnings, isApproximate: warnings.length > 0 }
}

/**
 * Build a stock tank recipe with Nitrogen + Calcium isolated for end-of-flower
 * tapering.
 *
 *   Tank 1 — Calcium Nitrate only (Ca²⁺ + N). Taper this to drop N at end of flower.
 *   Tank 2 — Everything else: remaining macro salts (KNO₃, MKP, MgSO₄, K₂SO₄)
 *            AND, by default, the micronutrients (Fe-DTPA, MnSO₄, ZnSO₄,
 *            H₃BO₃, CuSO₄, Na₂MoO₄) — giving a clean 2-tank system.
 *   Tank 3 — Micros only, kept isolated instead of merged into Tank 2 when
 *            `keepMicronutrientsSeparate` is true (the advanced 3-tank option).
 *
 * `hasMicroTank` tells callers whether Tank 3 is actually in use (false by
 * default, since micros are merged into Tank 2). `hasMicronutrients` tells
 * callers whether the recipe has any micros at all, regardless of which tank
 * they live in — use this to decide whether to render a "Micronutrients"
 * sub-section inside Tank 2 when the 3-tank option isn't enabled.
 */
export function calculateSeparateCalciumRecipe(
  targets: ElementalTargets,
  stockVolumeLiters: number,
  dilutionRatio: number,
  includedSalts?: IncludedSaltsSelection,
  keepMicronutrientsSeparate: boolean = false
): ThreeTankRecipe {
  const { tankA, tankB, warnings = [], isApproximate = false } = calculateStockTankRecipe(
    targets,
    stockVolumeLiters,
    dilutionRatio,
    includedSalts
  )

  const tank1 = emptySaltAmounts()
  const tank2 = emptySaltAmounts()
  const tank3 = emptySaltAmounts()

  const TANK_A_KEYS_IN_TANK_2 = new Set<SaltKey>(["potassiumNitrate", "ammoniumNitrate"])

  for (const key of TANK_1_SALTS) {
    tank1[key] = tankA[key]
  }
  for (const key of TANK_2_SALTS) {
    tank2[key] = TANK_A_KEYS_IN_TANK_2.has(key) ? tankA[key] : tankB[key]
  }
  for (const key of TANK_3_SALTS) {
    tank3[key] = key === "ironDTPA" ? tankA[key] : tankB[key]
  }

  const hasMicronutrients = (Object.values(tank3) as number[]).some((g) => g > 0)

  if (!keepMicronutrientsSeparate) {
    // 2-tank default: fold the micronutrients into Tank 2 alongside the rest
    // of the non-nitrogen components, and leave Tank 3 empty/unused.
    for (const key of TANK_3_SALTS) {
      tank2[key] = tank3[key]
      tank3[key] = 0
    }
  }

  const hasMicroTank = keepMicronutrientsSeparate && hasMicronutrients

  return { tank1, tank2, tank3, hasMicroTank, hasMicronutrients, warnings, isApproximate }
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

/**
 * One stock tank per nutrient part the user entered. Each part's guaranteed
 * analysis and feed rate drive the salts in that tank — mirroring how
 * commercial multi-part lines are bottled.
 *
 * Each part's own `includedSalts` selection (not a shared/global one) gates
 * which raw salts the solver may reach for while sizing that part's tank.
 * This keeps the tanks faithful to the original product: a part that only
 * lists Calcium Nitrate on its label can never end up with Potassium
 * Nitrate or MKP in its tank, even if those salts are checked on a
 * different part.
 */
export function calculateMultiPartStockTankRecipe(
  partsAnalysis: PartAnalysis[],
  parts: NutrientPart[],
  stockVolumeLiters: number,
  dilutionRatio: number
): MultiPartTankRecipe {
  const analysisById = new Map(partsAnalysis.map((part) => [part.id, part]))
  const tanks: PartStockTank[] = []
  const warningsByElement = new Map<string, SaltGapWarning>()
  let tankIndex = 0

  for (const feedingPart of parts) {
    if (parsePositive(feedingPart.dose) === 0) continue
    const analysis = analysisById.get(feedingPart.id)
    if (!analysis) continue

    const rawTargets = calculateElementalTargets([analysis], [feedingPart])
    const hasAnyElement = Object.values(rawTargets).some((value) => value > 0)
    if (!hasAnyElement) continue

    const { targets } = applyMicroEstimates(rawTargets)
    const { tankA, tankB, warnings = [] } = calculateStockTankRecipe(
      targets,
      stockVolumeLiters,
      dilutionRatio,
      analysis.includedSalts
    )
    for (const warning of warnings) warningsByElement.set(warning.element, warning)

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

  const warnings = Array.from(warningsByElement.values())
  return { tanks, warnings, isApproximate: warnings.length > 0 }
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
 *
 * As with `calculateMultiPartStockTankRecipe`, each part's macro salts are
 * sized using that part's own `includedSalts` selection so a part never
 * borrows a salt that only belongs to a different part's bottle.
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
  const warningsByElement = new Map<string, SaltGapWarning>()
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
    const { tankA, tankB, warnings = [] } = calculateStockTankRecipe(
      targets,
      stockVolumeLiters,
      dilutionRatio,
      analysis.includedSalts
    )
    for (const warning of warnings) warningsByElement.set(warning.element, warning)
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

  const warnings = Array.from(warningsByElement.values())
  return { tanks, warnings, isApproximate: warnings.length > 0 }
}

/** Working-strength recipe for direct mixing into a reservoir of `reservoirLiters` litres */
export function calculateDirectMixRecipe(
  targets: ElementalTargets,
  reservoirLiters: number,
  includedSalts?: IncludedSaltsSelection
): DirectMixRecipe {
  // A 1:1 stock tank of exactly reservoirLiters is equivalent to working-strength direct mix.
  const stockRecipe = calculateStockTankRecipe(targets, reservoirLiters, 1, includedSalts)

  const combined = emptySaltAmounts()
  const keys = Object.keys(combined) as Array<keyof SaltAmounts>

  for (const key of keys) {
    combined[key] = stockRecipe.tankA[key] + stockRecipe.tankB[key]
  }

  return {
    salts: combined,
    warnings: stockRecipe.warnings ?? [],
    isApproximate: stockRecipe.isApproximate ?? false,
  }
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
  // Carbonate's own conductivity contribution is omitted (like the
  // micronutrient sulfates) — Calcium Carbonate's near-zero solubility keeps
  // any real-world dose small enough that the omission is negligible.
  const caPpm =
    salts.calciumNitrate * RAW_SALTS.calciumNitrate.ca * 1000 +
    salts.calciumCarbonate * RAW_SALTS.calciumCarbonate.ca * 1000
  const nFromCaNo3 = salts.calciumNitrate * RAW_SALTS.calciumNitrate.n * 1000
  const kFromKno3 = salts.potassiumNitrate * RAW_SALTS.potassiumNitrate.k * 1000
  const nFromKno3 = salts.potassiumNitrate * RAW_SALTS.potassiumNitrate.n * 1000
  const nFromNh4no3 = salts.ammoniumNitrate * RAW_SALTS.ammoniumNitrate.n * 1000
  const nFromNh4so4 = salts.ammoniumSulfate * RAW_SALTS.ammoniumSulfate.n * 1000
  const sFromNh4so4 = salts.ammoniumSulfate * RAW_SALTS.ammoniumSulfate.s * 1000
  const kFromMkp = salts.monoPotassiumPhosphate * RAW_SALTS.monoPotassiumPhosphate.k * 1000
  const pFromMkp = salts.monoPotassiumPhosphate * RAW_SALTS.monoPotassiumPhosphate.p * 1000
  const mgPpm = salts.magnesiumSulfate * RAW_SALTS.magnesiumSulfate.mg * 1000
  const sFromMgSO4 = salts.magnesiumSulfate * RAW_SALTS.magnesiumSulfate.s * 1000
  const kFromK2SO4 = salts.potassiumSulfate * RAW_SALTS.potassiumSulfate.k * 1000
  const sFromK2SO4 = salts.potassiumSulfate * RAW_SALTS.potassiumSulfate.s * 1000

  const kPpm = kFromKno3 + kFromMkp + kFromK2SO4
  const nPpm = nFromCaNo3 + nFromKno3 + nFromNh4no3 + nFromNh4so4
  const sPpm = sFromMgSO4 + sFromK2SO4 + sFromNh4so4

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
export function estimateEcFromElementalTargets(
  targets: ElementalTargets,
  includedSalts?: IncludedSaltsSelection
): number | null {
  const hasMacro =
    targets.nitrogen > 0 ||
    targets.phosphorus > 0 ||
    targets.potassium > 0 ||
    targets.calcium > 0 ||
    targets.magnesium > 0 ||
    targets.sulfur > 0

  if (!hasMacro) return null

  const stockRecipe = calculateStockTankRecipe(targets, 1, 1, includedSalts)
  const salts = emptySaltAmounts()
  for (const key of Object.keys(salts) as SaltKey[]) {
    salts[key] = stockRecipe.tankA[key] + stockRecipe.tankB[key]
  }

  const baseEc = ecFromSaltAmounts(salts)
  if (!Number.isFinite(baseEc) || baseEc <= 0) return null

  const correctedEc = baseEc * EC_REAL_WORLD_FACTOR + EC_ADDITIVE_BUFFER_MS_CM
  return Number.isFinite(correctedEc) && correctedEc > 0 ? correctedEc : null
}
