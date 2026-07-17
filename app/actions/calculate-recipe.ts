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
import type {
  DirectMixRecipe,
  ElementalTargets,
  IncludedSaltsSelection,
  MicroKey,
  MultiPartTankRecipe,
  StockTankOption,
  ThreeTankRecipe,
} from "@/lib/hydro-calc/recipe-types"

export interface CalculateRecipeInput {
  partsAnalysis: PartAnalysis[]
  parts: NutrientPart[]
  stockTankOption: StockTankOption
  includedSalts: IncludedSaltsSelection
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
  const { partsAnalysis, parts, stockTankOption, includedSalts, keepMicrosSeparate } = input
  const stockVolumeLiters = sanitizePositiveNumber(input.stockVolumeLiters, 5)
  const dilutionRatio = sanitizePositiveNumber(input.dilutionRatio, 100)

  const rawTargets = calculateElementalTargets(partsAnalysis, parts)
  const { targets, estimated, anchor } = applyMicroEstimates(rawTargets)
  const estimatedEc = estimateEcFromElementalTargets(targets, includedSalts)

  const threeTankRecipe = calculateSeparateCalciumRecipe(
    targets,
    stockVolumeLiters,
    dilutionRatio,
    includedSalts,
    keepMicrosSeparate
  )

  const multiPartRecipe =
    stockTankOption === "doser"
      ? calculateDoserMultiPartRecipe(partsAnalysis, parts, stockVolumeLiters, dilutionRatio, includedSalts)
      : calculateMultiPartStockTankRecipe(partsAnalysis, parts, stockVolumeLiters, dilutionRatio, includedSalts)

  const directRecipe = calculateDirectMixRecipe(targets, stockVolumeLiters, includedSalts)

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
