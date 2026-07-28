"use server"

/**
 * Server Action boundary for the recipe solver.
 *
 * Client components must call `calculateRecipeAction` instead of importing
 * anything from `lib/hydro-calc/recipe-calculator.ts` directly — that module
 * is server-only (guarded by the `server-only` package) and contains the
 * proprietary target-derivation / salt-solving logic. This action is the
 * only sanctioned way for the browser to trigger that logic; only the
 * resulting plain-data recipe is ever sent back down to the client.
 */

import type { PartAnalysis } from "@/components/hydro-calc/guaranteed-analysis-screen"
import type { NutrientPart } from "@/components/hydro-calc/feeding-rates-screen"
import {
  applyMicroEstimates,
  calciumNitrateLiteralDoseEcPpmDelta,
  calculateDirectMixRecipe,
  calculateDoserMultiPartRecipe,
  calculateElementalTargets,
  calculateMultiPartStockTankRecipe,
  calculateSeparateCalciumRecipe,
  estimateEcFromElementalTargets,
  saltDerivedSulfurPpm,
} from "@/lib/hydro-calc/recipe-calculator"
import {
  sumCalciumChlorideGramsPerGallon,
  sumCalciumNitrateGramsPerGallon,
  sumUreaNitrogenPpm,
  unionIncludedSalts,
  type DirectMixRecipe,
  type ElementalTargets,
  type MicroEstimateSource,
  type MicroKey,
  type MultiPartTankRecipe,
  type StockTankOption,
  type ThreeTankRecipe,
} from "@/lib/hydro-calc/recipe-types"

export interface CalculateRecipeInput {
  partsAnalysis: PartAnalysis[]
  parts: NutrientPart[]
  stockTankOption: StockTankOption
  stockVolumeLiters: number
  dilutionRatio: number
}

export interface CalculateRecipeResult {
  /**
   * What the guaranteed-analysis percentages and feed rates ask for. This is
   * the input the salt solving below aims at — NOT necessarily what the
   * resulting recipe delivers, since every salt carries several elements in a
   * fixed ratio and a label's own ratios aren't always buildable from the
   * salts the grower checked. Each recipe layout reports what it actually
   * delivers as its own `delivered` (see `TankRecipe.delivered`), which is what
   * the UI shows the grower.
   */
  targets: ElementalTargets
  /** Set is not serializable across the Server Action boundary — sent as an array */
  estimatedMicros: MicroKey[]
  anchor: MicroKey | null
  /**
   * Declared micros that can't anchor an estimate (Molybdenum) — non-empty
   * only when `anchor` is null, i.e. when the balanced default profile was
   * used instead. See `applyMicroEstimates`.
   */
  unanchoredMicros: MicroKey[]
  /** Whether the estimated micros came from a declared anchor or the default profile */
  microEstimateSource: MicroEstimateSource
  estimatedEc: number | null
  /**
   * How much of `estimatedEc` above comes from correcting a literally-dosed
   * Calcium Nitrate part's ion content to its real declared label %N/%Ca
   * instead of `RAW_SALTS.calciumNitrate`'s generic assumed composition
   * (see `calciumNitrateLiteralDoseEcPpmDelta`). Zero when no part
   * qualifies. Exposed so the UI can show this piece of the EC calculation
   * path.
   */
  calciumNitrateEcPpmDelta: { calciumPpmDelta: number; nitrogenPpmDelta: number }
  /**
   * How much of `targets.sulfur` above is filled in from Magnesium Sulfate /
   * Potassium Sulfate / Ammonium Sulfate actually being allocated in the
   * resolved recipe (see `saltDerivedSulfurPpm`). Only ever non-zero when
   * the Guaranteed Analysis itself declares 0 / no Sulfur — when the label
   * declares a real %S, that value is used as-is and this is always 0, since
   * the declared %S already reflects the product's total elemental Sulfur
   * (including whatever it derives from its own sulfate salts). Exposed so
   * the UI can show this piece of the Sulfur calculation path.
   */
  saltDerivedSulfurPpm: number
  threeTankRecipe: ThreeTankRecipe
  multiPartRecipe: MultiPartTankRecipe
  directRecipe: DirectMixRecipe
  /**
   * The sanitized volume/ratio actually used to produce the salt amounts
   * above. Client-side solubility checks must be run against *this* ratio
   * rather than whatever `dilutionRatio` happens to be in local state at
   * render time — those can briefly disagree while a debounced recalculation
   * is in flight, and feeding a mismatched ratio into the (ratio-invariant)
   * solubility formula makes it report a wildly wrong "safe ratio".
   */
  stockVolumeLiters: number
  dilutionRatio: number
}

function sanitizePositiveNumber(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export async function calculateRecipeAction(
  input: CalculateRecipeInput
): Promise<CalculateRecipeResult> {
  const { partsAnalysis, parts, stockTankOption } = input
  const stockVolumeLiters = sanitizePositiveNumber(input.stockVolumeLiters, 5)
  const dilutionRatio = sanitizePositiveNumber(input.dilutionRatio, 100)

  const rawTargets = calculateElementalTargets(partsAnalysis, parts)
  const {
    targets: targetsBeforeSaltSulfur,
    estimated,
    anchor,
    unanchoredMicros,
    estimateSource: microEstimateSource,
  } = applyMicroEstimates(rawTargets)

  // The Separate-Nitrogen and Direct-Mix layouts intentionally recombine
  // nutrients across parts by chemistry rather than by bottle, so they draw
  // from the union of every part's salt selection. Per-part tank layouts
  // (A+B / doser "one tank per part") instead read each part's own
  // selection directly inside calculate*MultiPart*Recipe below.
  const combinedIncludedSalts = unionIncludedSalts(partsAnalysis)
  const combinedCalciumChlorideGramsPerGallon = sumCalciumChlorideGramsPerGallon(partsAnalysis)
  const combinedCalciumNitrateGramsPerGallon = sumCalciumNitrateGramsPerGallon(partsAnalysis, parts)
  const combinedUreaNitrogenPpm = sumUreaNitrogenPpm(partsAnalysis, parts)
  const calciumNitrateEcDelta = calciumNitrateLiteralDoseEcPpmDelta(partsAnalysis, parts)

  // Sulfur is never itself a salt-sizing input (see `saltDerivedSulfurPpm`),
  // so folding in whatever Sulfur the resolved recipe's own Magnesium
  // Sulfate / Potassium Sulfate / Ammonium Sulfate allocation brings along
  // can't change any other target or salt amount below. Safe to do once,
  // right here, before every recipe layout is built from `targets`.
  //
  // IMPORTANT: only fill in salt-derived Sulfur when the Guaranteed Analysis
  // itself is silent on Sulfur (0 / not declared). When a label *does*
  // declare a %S, that declared value already reflects the real, total
  // elemental Sulfur the product delivers — including whatever comes from
  // its own sulfate salts. Adding the solver's independently-computed
  // salt-derived estimate on top in that case double-counts the same
  // Sulfur and overshoots the target (e.g. a 2% S label — ~63 ppm — was
  // showing ~160 ppm because ~97 ppm of solver-side MgSO4/K2SO4-derived
  // Sulfur was being summed on top of the label's own 63 ppm).
  const sulfurFromSulfateSalts =
    targetsBeforeSaltSulfur.sulfur > 0
      ? 0
      : saltDerivedSulfurPpm(
          targetsBeforeSaltSulfur,
          combinedIncludedSalts,
          combinedCalciumChlorideGramsPerGallon,
          combinedCalciumNitrateGramsPerGallon,
          combinedUreaNitrogenPpm
        )
  const targets: ElementalTargets = {
    ...targetsBeforeSaltSulfur,
    sulfur: targetsBeforeSaltSulfur.sulfur + sulfurFromSulfateSalts,
  }

  const estimatedEc = estimateEcFromElementalTargets(
    targets,
    combinedIncludedSalts,
    combinedCalciumChlorideGramsPerGallon,
    combinedCalciumNitrateGramsPerGallon,
    calciumNitrateEcDelta,
    combinedUreaNitrogenPpm
  )

  const threeTankRecipe = calculateSeparateCalciumRecipe(
    targets,
    stockVolumeLiters,
    dilutionRatio,
    combinedIncludedSalts,
    combinedCalciumChlorideGramsPerGallon,
    combinedCalciumNitrateGramsPerGallon,
    combinedUreaNitrogenPpm
  )

  const multiPartRecipe =
    stockTankOption === "doser"
      ? calculateDoserMultiPartRecipe(partsAnalysis, parts, stockVolumeLiters, dilutionRatio)
      : calculateMultiPartStockTankRecipe(partsAnalysis, parts, stockVolumeLiters, dilutionRatio)

  const directRecipe = calculateDirectMixRecipe(
    targets,
    stockVolumeLiters,
    combinedIncludedSalts,
    combinedCalciumChlorideGramsPerGallon,
    combinedCalciumNitrateGramsPerGallon,
    combinedUreaNitrogenPpm
  )

  return {
    targets,
    estimatedMicros: Array.from(estimated),
    anchor,
    unanchoredMicros,
    microEstimateSource,
    estimatedEc,
    calciumNitrateEcPpmDelta: calciumNitrateEcDelta,
    saltDerivedSulfurPpm: sulfurFromSulfateSalts,
    threeTankRecipe,
    multiPartRecipe,
    directRecipe,
    stockVolumeLiters,
    dilutionRatio,
  }
}
