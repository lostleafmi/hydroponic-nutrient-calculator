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
  type SeparateNitrogenRecipe,
  type SeparateNitrogenTank,
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

/**
 * What a Separate Nitrogen tank is called in the exported formulation.
 *
 * A tank that belongs to one part is named after that part — the same way the
 * per-part export names its tanks — so an imported formulation still reads as
 * the grower's own feed chart. The Calcium tank is named that way too when it's
 * one of the line's own bottles holding the pooled Calcium, and named for its
 * contents when it holds nothing but Calcium, since then it stands for no single
 * bottle. Only when the parts were pooled and re-solved as one (see
 * `SEPARATE_NITROGEN_PER_PART_SOLVE_MIN_PARTS`) is there no part to name any
 * tank after.
 *
 * Whichever tank ended up with the micronutrients says so, since that's never a
 * tank of its own — the package always rides along with macros (see
 * `placeMicronutrients`).
 */
function separateNitrogenTankLabel(tank: SeparateNitrogenTank): string {
  const micros = tank.hasMicronutrients ? " + Micros" : ""
  if (tank.role === "calcium") {
    return tank.partName ? `${tank.partName} + Calcium${micros}` : `Nitrogen + Calcium${micros}`
  }
  if (tank.partName) return `${tank.partName}${micros}`
  return tank.hasMicronutrients ? "Macros + Micros" : "Macros"
}

function separateNitrogenMixInstructions(
  tank: SeparateNitrogenTank,
  sizeNum: number,
  unitLabel: string
): string {
  // A Calcium tank with a part to its name holds that bottle's other salts too,
  // so it needs the same salt-by-salt order as any other tank. So does one that
  // took on the micronutrients.
  if (tank.role === "calcium" && !tank.partName && !tank.hasMicronutrients) {
    return `Fill the stock tank about halfway with RO water, add the calcium source and stir until it's fully dissolved, then top up to ${sizeNum} ${unitLabel} and label it "${tank.name}".`
  }
  return `Fill the stock tank about halfway with RO water, then add the salts in the order listed above${
    tank.hasMicronutrients ? ", dissolving the Iron DTPA first among the micronutrients" : ""
  }. Wait for each one to fully dissolve before adding the next. Top up to ${sizeNum} ${unitLabel} and label it "${tank.name}".`
}

export function buildFormulationTanksData({
  mode,
  separateNitrogenRecipe,
  multiPartRecipe,
  directRecipe,
  ecScaleFactor,
  stockTankSize,
  stockTankUnit,
  dilutionRatio,
  isDoser,
}: {
  mode: FormulationTankMode
  separateNitrogenRecipe: SeparateNitrogenRecipe
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
    const usageRates: Record<string, number> = {}
    const directAddCalciumCarbonate = buildDirectAddCalciumCarbonateExport(
      separateNitrogenRecipe.directAddCalciumCarbonate,
      ecScaleFactor
    )

    // However many tanks the layout came back with — one merged non-Calcium
    // tank when the parts were pooled, one per part when they weren't (see
    // `calculateSeparateNitrogenMultiPartRecipe`, which never returns more
    // tanks than the line has parts).
    const tanks: FormulationTank[] = separateNitrogenRecipe.tanks
      .map((tank) => {
        const id = `tank${tank.index}`
        const inputs = buildInputs(tank.salts, ecScaleFactor)
        if (inputs.length === 0) return null

        usageRates[id] = mlPerGallon
        return {
          id,
          label: separateNitrogenTankLabel(tank),
          inputs,
          mixInstructions: separateNitrogenMixInstructions(tank, sizeNum, unitLabel),
        }
      })
      .filter((tank): tank is FormulationTank => tank !== null)

    return { usageRates, defaultStockTankSize, tanks, directAddCalciumCarbonate }
  }

  // mode === "per-part" — one stock tank per nutrient part ("per-part" + doser modes)
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
