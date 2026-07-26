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
  unionIncludedSalts,
  type DirectMixRecipe,
  type ElementalTargets,
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
  keepMicrosSeparate: boolean
}

export interface CalculateRecipeResult {
  targets: ElementalTargets
  /** Set is not serializable across the Server Action boundary — sent as an array */
  estimatedMicros: MicroKey[]
  anchor: MicroKey | null
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
   * How much of `targets.sulfur` above comes from Magnesium Sulfate /
   * Potassium Sulfate / Ammonium Sulfate actually being allocated in the
   * resolved recipe, on top of whatever the Guaranteed Analysis itself
   * declared (see `saltDerivedSulfurPpm`). Zero when no sulfate salt ends
   * up used. Exposed so the UI can show this piece of the Sulfur
   * calculation path.
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
  const { partsAnalysis, parts, stockTankOption, keepMicrosSeparate } = input
  const stockVolumeLiters = sanitizePositiveNumber(input.stockVolumeLiters, 5)
  const dilutionRatio = sanitizePositiveNumber(input.dilutionRatio, 100)

  const rawTargets = calculateElementalTargets(partsAnalysis, parts)
  const { targets: targetsBeforeSaltSulfur, estimated, anchor } = applyMicroEstimates(rawTargets)

  // The Separate-Nitrogen and Direct-Mix layouts intentionally recombine
  // nutrients across parts by chemistry rather than by bottle, so they draw
  // from the union of every part's salt selection. Per-part tank layouts
  // (A+B / doser "one tank per part") instead read each part's own
  // selection directly inside calculate*MultiPart*Recipe below.
  const combinedIncludedSalts = unionIncludedSalts(partsAnalysis)
  const combinedCalciumChlorideGramsPerGallon = sumCalciumChlorideGramsPerGallon(partsAnalysis)
  const combinedCalciumNitrateGramsPerGallon = sumCalciumNitrateGramsPerGallon(partsAnalysis, parts)
  const calciumNitrateEcDelta = calciumNitrateLiteralDoseEcPpmDelta(partsAnalysis, parts)

  // Sulfur is never itself a salt-sizing input (see `saltDerivedSulfurPpm`),
  // so folding in whatever Sulfur the resolved recipe's own Magnesium
  // Sulfate / Potassium Sulfate / Ammonium Sulfate allocation brings along
  // — on top of whatever the Guaranteed Analysis already declared — can't
  // change any other target or salt amount below. Safe to do once, right
  // here, before every recipe layout is built from `targets`.
  const sulfurFromSulfateSalts = saltDerivedSulfurPpm(
    targetsBeforeSaltSulfur,
    combinedIncludedSalts,
    combinedCalciumChlorideGramsPerGallon,
    combinedCalciumNitrateGramsPerGallon
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
    calciumNitrateEcDelta
  )

  const threeTankRecipe = calculateSeparateCalciumRecipe(
    targets,
    stockVolumeLiters,
    dilutionRatio,
    combinedIncludedSalts,
    keepMicrosSeparate,
    combinedCalciumChlorideGramsPerGallon,
    combinedCalciumNitrateGramsPerGallon
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
    combinedCalciumNitrateGramsPerGallon
  )

  return {
    targets,
    estimatedMicros: Array.from(estimated),
    anchor,
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
