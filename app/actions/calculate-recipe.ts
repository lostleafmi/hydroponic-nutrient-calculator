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
  calculateDirectMixRecipe,
  calculateDoserMultiPartRecipe,
  calculateElementalTargets,
  calculateMultiPartStockTankRecipe,
  calculateSeparateCalciumRecipe,
  estimateEcFromElementalTargets,
} from "@/lib/hydro-calc/recipe-calculator"
import {
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
  const { targets, estimated, anchor } = applyMicroEstimates(rawTargets)

  // The Separate-Nitrogen and Direct-Mix layouts intentionally recombine
  // nutrients across parts by chemistry rather than by bottle, so they draw
  // from the union of every part's salt selection. Per-part tank layouts
  // (A+B / doser "one tank per part") instead read each part's own
  // selection directly inside calculate*MultiPart*Recipe below.
  const combinedIncludedSalts = unionIncludedSalts(partsAnalysis)

  const estimatedEc = estimateEcFromElementalTargets(targets, combinedIncludedSalts)

  const threeTankRecipe = calculateSeparateCalciumRecipe(
    targets,
    stockVolumeLiters,
    dilutionRatio,
    combinedIncludedSalts,
    keepMicrosSeparate
  )

  const multiPartRecipe =
    stockTankOption === "doser"
      ? calculateDoserMultiPartRecipe(partsAnalysis, parts, stockVolumeLiters, dilutionRatio)
      : calculateMultiPartStockTankRecipe(partsAnalysis, parts, stockVolumeLiters, dilutionRatio)

  const directRecipe = calculateDirectMixRecipe(targets, stockVolumeLiters, combinedIncludedSalts)

  return {
    targets,
    estimatedMicros: Array.from(estimated),
    anchor,
    estimatedEc,
    threeTankRecipe,
    multiPartRecipe,
    directRecipe,
    stockVolumeLiters,
    dilutionRatio,
  }
}
