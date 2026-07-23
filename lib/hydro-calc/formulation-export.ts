/**
 * Builds the rich, per-tank breakdown that the standalone Feeding Scheduler
 * import parser expects when a saved formulation is loaded there.
 *
 * The calculator itself renders this same breakdown as "Stock Tank Recipe"
 * cards (see `components/hydro-calc/recipe-screen.tsx`) — this module
 * derives the equivalent plain-data shape from the same recipe results so
 * both the on-screen cards and the exported formulation always agree.
 *
 * Target shape (per tank):
 *   { id, label, inputs: [{ salt, formula, amount_g }], mixInstructions }
 *
 * Plus formulation-level `usageRates` (mL of each stock tank per gallon of
 * reservoir water) and `defaultStockTankSize` (in gallons).
 */

import {
  LITERS_PER_GALLON,
  RAW_SALTS,
  getOrderedSaltEntries,
  stockTankMlPerGallon,
  type DirectAddCalciumCarbonate,
  type DirectMixRecipe,
  type MultiPartTankRecipe,
  type SaltAmounts,
  type ThreeTankRecipe,
} from "./recipe-types"

export interface FormulationTankInput {
  salt: string
  formula: string
  amount_g: number
}

export interface FormulationTank {
  id: string
  label: string
  inputs: FormulationTankInput[]
  mixInstructions: string
}

/** Matches the shape the Feeding Scheduler's "Dry Inputs" import parser expects. */
export interface FormulationDirectAddCalciumCarbonate {
  gramsPerGallon: number
}

export interface FormulationTanksData {
  usageRates: Record<string, number>
  defaultStockTankSize: number
  tanks: FormulationTank[]
  /**
   * Present only when the recipe actually uses Calcium Carbonate (see
   * `calculateStockTankRecipe` — it's never in any tank's `salts`, so this is
   * the only place its amount is exported). Omitted entirely otherwise so
   * the Feeding Scheduler's importer treats it as absent rather than "0 g".
   */
  directAddCalciumCarbonate?: FormulationDirectAddCalciumCarbonate
}

/** Which recipe-calculation result to read the tank breakdown from */
export type FormulationTankMode = "separate-nitrogen" | "per-part" | "direct"

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100) / 100
}

function buildInputs(salts: SaltAmounts, ecScaleFactor: number): FormulationTankInput[] {
  return getOrderedSaltEntries(salts).map(([key, amount]) => ({
    salt: RAW_SALTS[key].name,
    formula: RAW_SALTS[key].formula,
    amount_g: round2(amount * ecScaleFactor),
  }))
}

function buildDirectAddCalciumCarbonateExport(
  directAdd: DirectAddCalciumCarbonate | undefined,
  ecScaleFactor: number
): FormulationDirectAddCalciumCarbonate | undefined {
  if (!directAdd || !(directAdd.gramsPerGallon > 0)) return undefined
  const gramsPerGallon = round2(directAdd.gramsPerGallon * ecScaleFactor)
  if (!(gramsPerGallon > 0)) return undefined
  return { gramsPerGallon }
}

export function buildFormulationTanksData({
  mode,
  threeTankRecipe,
  multiPartRecipe,
  directRecipe,
  ecScaleFactor,
  stockTankSize,
  stockTankUnit,
  dilutionRatio,
  isDoser,
}: {
  mode: FormulationTankMode
  threeTankRecipe: ThreeTankRecipe
  multiPartRecipe: MultiPartTankRecipe
  directRecipe: DirectMixRecipe
  ecScaleFactor: number
  stockTankSize: string
  stockTankUnit: "gallons" | "liters"
  dilutionRatio: number
  isDoser: boolean
}): FormulationTanksData {
  const sizeNum = parseFloat(stockTankSize) || 5
  const unitLabel = stockTankUnit === "gallons" ? "gallons" : "liters"
  const defaultStockTankSize = round2(
    stockTankUnit === "liters" ? sizeNum / LITERS_PER_GALLON : sizeNum
  )
  const mlPerGallon = round2(stockTankMlPerGallon(dilutionRatio))

  if (mode === "direct") {
    const inputs = buildInputs(directRecipe.salts, ecScaleFactor)
    const tanks: FormulationTank[] =
      inputs.length === 0
        ? []
        : [
            {
              id: "tank1",
              label: "Direct Mix",
              inputs,
              mixInstructions:
                "Dissolve each salt directly in the reservoir one at a time (a paddle mixer and drill are recommended), waiting for each one to fully dissolve before adding the next. Running a recirculating pump while mixing helps everything blend evenly.",
            },
          ]
    const directAddCalciumCarbonate = buildDirectAddCalciumCarbonateExport(
      directRecipe.directAddCalciumCarbonate,
      ecScaleFactor
    )
    // Direct-mix amounts are already sized for the whole reservoir — there's
    // no concentrated stock tank being diluted, so no per-gallon usage rate applies.
    return { usageRates: {}, defaultStockTankSize, tanks, directAddCalciumCarbonate }
  }

  if (mode === "separate-nitrogen") {
    const tanks: FormulationTank[] = []
    const usageRates: Record<string, number> = {}
    const directAddCalciumCarbonate = buildDirectAddCalciumCarbonateExport(
      threeTankRecipe.directAddCalciumCarbonate,
      ecScaleFactor
    )

    const tank1Inputs = buildInputs(threeTankRecipe.tank1, ecScaleFactor)
    if (tank1Inputs.length > 0) {
      tanks.push({
        id: "tank1",
        label: "Nitrogen + Calcium",
        inputs: tank1Inputs,
        mixInstructions: `Fill the stock tank about halfway with RO water, add the calcium nitrate and stir until it's fully dissolved, then top up to ${sizeNum} ${unitLabel} and label it "Tank 1".`,
      })
      usageRates.tank1 = mlPerGallon
    }

    // Tank 2 already contains the merged micro amounts whenever they weren't
    // split into their own Tank 3 (see `calculateSeparateNitrogenRecipe`),
    // so `hasMicronutrients && !hasMicroTank` mirrors the on-screen badge.
    const tank2IncludesMicros = threeTankRecipe.hasMicronutrients && !threeTankRecipe.hasMicroTank
    const tank2Inputs = buildInputs(threeTankRecipe.tank2, ecScaleFactor)
    if (tank2Inputs.length > 0) {
      tanks.push({
        id: "tank2",
        label: tank2IncludesMicros ? "Macros + Micros" : "Macros",
        inputs: tank2Inputs,
        mixInstructions: `Fill the stock tank about halfway with RO water, then add the salts in the order listed above${
          tank2IncludesMicros ? ", dissolving the Iron DTPA first among the micronutrients" : ""
        }. Wait for each one to fully dissolve before adding the next. Top up to ${sizeNum} ${unitLabel} and label it "Tank 2".`,
      })
      usageRates.tank2 = mlPerGallon
    }

    if (threeTankRecipe.hasMicroTank) {
      const tank3Inputs = buildInputs(threeTankRecipe.tank3, ecScaleFactor)
      if (tank3Inputs.length > 0) {
        tanks.push({
          id: "tank3",
          label: "Micros",
          inputs: tank3Inputs,
          mixInstructions: `Use room temperature RO water (~70°F) if possible, this will help with mixing. Fill the tank halfway and dissolve the Iron DTPA first, then add the rest of the micros. Boric Acid is slow to dissolve so give it a minute if it's being stubborn. Top up to ${sizeNum} ${unitLabel} and label it "Tank 3".`,
        })
        usageRates.tank3 = mlPerGallon
      }
    }

    return { usageRates, defaultStockTankSize, tanks, directAddCalciumCarbonate }
  }

  // mode === "per-part" — one stock tank per nutrient part (doser + A+B modes)
  const usageRates: Record<string, number> = {}
  const directAddCalciumCarbonate = buildDirectAddCalciumCarbonateExport(
    multiPartRecipe.directAddCalciumCarbonate,
    ecScaleFactor
  )
  const tanks: FormulationTank[] = multiPartRecipe.tanks
    .map((tank) => {
      const id = `tank${tank.index}`
      const inputs = buildInputs(tank.salts, ecScaleFactor)
      if (inputs.length === 0) return null

      usageRates[id] = mlPerGallon
      const label = tank.isMicroTank ? "Micronutrients" : tank.partName
      const mixInstructions = tank.isMicroTank
        ? `Use room-temperature RO water (~70°F) if possible — it helps with dissolving. Fill the tank halfway, dissolve the Iron DTPA first, then add the remaining micros one at a time. Boric Acid can be slow; give it a minute if needed. Top up to ${sizeNum} ${unitLabel} and label it "${tank.name} — Micros"${
            isDoser ? `, then drop suction line ${tank.index} in.` : "."
          }`
        : `Fill the stock tank about halfway with RO water, then add the salts in the order listed above. Wait for each one to fully dissolve before adding the next. Top up to ${sizeNum} ${unitLabel} and label it "${tank.name}"${
            isDoser ? ` — then drop the ${tank.name} suction line in.` : "."
          }`

      return { id, label, inputs, mixInstructions }
    })
    .filter((tank): tank is FormulationTank => tank !== null)

  return { usageRates, defaultStockTankSize, tanks, directAddCalciumCarbonate }
}
