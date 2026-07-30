/**
 * The last step between a solved recipe and the numbers on the Recipe screen:
 * the Target EC scale, applied once, to everything derived from the grams.
 *
 * The solver sizes every salt for the label's own elemental targets. A grower
 * who then asks for a different EC isn't asking for a different *recipe* —
 * they're asking for the same one at a different strength, which (at a fixed
 * dilution ratio and dose rate) is exactly "multiply every gram by k". That
 * scale used to be a formatting concern, applied inline wherever a gram amount
 * was printed:
 *
 *     amount={formatGrams(grams * ecScaleFactor)}
 *
 * which silently left behind everything else the grams determine. The
 * "What your plants will get" panel kept reading the *unscaled* `delivered`
 * ppm, and the mL/gal usage rate never depended on the grams at all — so a
 * grower who nudged Target EC from 2.84 to 3.00 was handed stock tanks ~5.7%
 * richer than the ppm printed above them, at the same dose rate. Every element
 * drifted by the same 5.7%, which is what made it look like a unit-conversion
 * bug rather than a scaling one.
 *
 * So the scale is applied here instead, to whole recipes, before anything reads
 * them. Downstream — tank cards, ppm panel, solubility report, shopping list,
 * exported formulation — sees one set of salt amounts and the ppm those exact
 * amounts deliver, and can't reintroduce the gap by forgetting a multiplier it
 * no longer knows about.
 *
 * `deliveredPpmFromStockTankDose` at the bottom is the inverse: it recomputes
 * the reservoir ppm from the two numbers the grower actually acts on (a stock
 * tank's g per gallon of stock solution, and its mL/gal dose). Nothing in the
 * app needs it — `scripts/verify-delivered-ppm.ts` uses it to check the
 * round-trip independently of the forward path.
 */

import {
  LITERS_PER_GALLON,
  ML_PER_GALLON,
  emptyElementalTargets,
  emptySaltAmounts,
  saltElementFractions,
  RAW_SALTS,
  type DirectAddCalciumCarbonate,
  type DirectMixRecipe,
  type ElementalTargets,
  type MultiPartTankRecipe,
  type SaltAmounts,
  type SaltKey,
  type SeparateNitrogenRecipe,
  type TargetDeviation,
} from "./recipe-types"

/**
 * A scale of exactly 1 (or a nonsensical one) must leave a recipe untouched
 * rather than merely arithmetically unchanged, so the no-EC-override path
 * returns the very objects the solver produced and stays referentially stable
 * for React's memoization.
 */
function isIdentityScale(scale: number): boolean {
  return !Number.isFinite(scale) || scale <= 0 || scale === 1
}

export function scaleSaltAmounts(salts: SaltAmounts, scale: number): SaltAmounts {
  if (isIdentityScale(scale)) return salts
  const scaled = emptySaltAmounts()
  for (const key of Object.keys(scaled) as SaltKey[]) scaled[key] = salts[key] * scale
  return scaled
}

/**
 * Scaling the grams scales the ppm they deliver by the same factor — ppm is
 * linear in grams (see `elementalPpmFromSaltAmounts`), so this is exact rather
 * than an approximation of re-deriving them.
 */
export function scaleElementalTargets(targets: ElementalTargets, scale: number): ElementalTargets {
  if (isIdentityScale(scale)) return targets
  const scaled = emptyElementalTargets()
  for (const key of Object.keys(scaled) as Array<keyof ElementalTargets>) {
    scaled[key] = targets[key] * scale
  }
  return scaled
}

export function scaleDirectAddCalciumCarbonate(
  directAdd: DirectAddCalciumCarbonate | undefined,
  scale: number
): DirectAddCalciumCarbonate | undefined {
  if (!directAdd || isIdentityScale(scale)) return directAdd
  return {
    grams: directAdd.grams * scale,
    gramsPerGallon: directAdd.gramsPerGallon * scale,
    gramsPerLiter: directAdd.gramsPerLiter * scale,
  }
}

/**
 * Both sides of every deviation move with the scale, so the gap keeps
 * describing what it always described: a label ratio the checked salts can't
 * build. Running the whole recipe 6% strong doesn't put six new elements "off
 * label" — it puts the label itself 6% up as well, which is what the grower
 * asked for.
 */
function scaleDeviations(deviations: TargetDeviation[], scale: number): TargetDeviation[] {
  if (isIdentityScale(scale)) return deviations
  return deviations.map((deviation) => ({
    ...deviation,
    targetPpm: deviation.targetPpm * scale,
    deliveredPpm: deviation.deliveredPpm * scale,
  }))
}

export function scaleSeparateNitrogenRecipe(
  recipe: SeparateNitrogenRecipe,
  scale: number
): SeparateNitrogenRecipe {
  if (isIdentityScale(scale)) return recipe
  return {
    ...recipe,
    tanks: recipe.tanks.map((tank) => ({ ...tank, salts: scaleSaltAmounts(tank.salts, scale) })),
    directAddCalciumCarbonate: scaleDirectAddCalciumCarbonate(
      recipe.directAddCalciumCarbonate,
      scale
    ),
    delivered: scaleElementalTargets(recipe.delivered, scale),
    deviations: scaleDeviations(recipe.deviations, scale),
  }
}

export function scaleMultiPartTankRecipe(
  recipe: MultiPartTankRecipe,
  scale: number
): MultiPartTankRecipe {
  if (isIdentityScale(scale)) return recipe
  return {
    ...recipe,
    tanks: recipe.tanks.map((tank) => ({ ...tank, salts: scaleSaltAmounts(tank.salts, scale) })),
    directAddCalciumCarbonate: scaleDirectAddCalciumCarbonate(
      recipe.directAddCalciumCarbonate,
      scale
    ),
    delivered: scaleElementalTargets(recipe.delivered, scale),
    deviations: scaleDeviations(recipe.deviations, scale),
  }
}

export function scaleDirectMixRecipe(recipe: DirectMixRecipe, scale: number): DirectMixRecipe {
  if (isIdentityScale(scale)) return recipe
  return {
    ...recipe,
    salts: scaleSaltAmounts(recipe.salts, scale),
    directAddCalciumCarbonate: scaleDirectAddCalciumCarbonate(
      recipe.directAddCalciumCarbonate,
      scale
    ),
    delivered: scaleElementalTargets(recipe.delivered, scale),
    deviations: scaleDeviations(recipe.deviations, scale),
  }
}

/**
 * How strong a stock tank is, in the unit a grower can weigh: grams of each
 * salt per US gallon of the finished *stock solution*, rather than per tank.
 *
 * This is the number a tank card implies — `grams` of each salt topped up to a
 * tank of `stockVolumeLiters` — restated so it no longer depends on the tank
 * size, which is what makes it comparable against a mL/gal dose rate.
 */
export function stockSaltGramsPerGallonOfStock(
  salts: SaltAmounts,
  stockVolumeLiters: number
): SaltAmounts {
  const perGallon = emptySaltAmounts()
  if (!(stockVolumeLiters > 0)) return perGallon
  for (const key of Object.keys(perGallon) as SaltKey[]) {
    perGallon[key] = (salts[key] * LITERS_PER_GALLON) / stockVolumeLiters
  }
  return perGallon
}

/**
 * Elemental ppm the grower's reservoir ends up at, derived from nothing but
 * the two numbers on screen: how much of each salt a gallon of the stock
 * solution holds, and how many mL of that stock go into a gallon of reservoir
 * water.
 *
 *   stock drawn per gallon of feed   = mlPerGallon / ML_PER_GALLON   [gal of stock]
 *   grams of salt per gallon of feed = gramsPerGallonOfStock × that
 *   ppm (mg/L)                       = grams per gallon of feed
 *                                      ÷ LITERS_PER_GALLON × 1000 mg/g
 *                                      × the salt's weight fraction of the element
 *
 * Deliberately routed through mL and gallons rather than collapsing to the
 * algebraically equivalent `grams × 1000 / (stockVolumeLiters × dilutionRatio)`
 * that `elementalPpmFromSaltAmounts` uses. The two share only the composition
 * table (`saltElementFractions`), so agreeing means the gallon↔litre↔mL hops
 * on the display path are each applied exactly once.
 */
export function deliveredPpmFromStockTankDose(
  saltGramsPerGallonOfStock: SaltAmounts,
  mlPerGallon: number
): ElementalTargets {
  const delivered = emptyElementalTargets()
  if (!(mlPerGallon > 0)) return delivered

  const gallonsOfStockPerGallonOfFeed = mlPerGallon / ML_PER_GALLON
  for (const saltKey of Object.keys(RAW_SALTS) as SaltKey[]) {
    const gramsPerGallonOfStock = saltGramsPerGallonOfStock[saltKey]
    if (!(gramsPerGallonOfStock > 0)) continue
    const gramsPerGallonOfFeed = gramsPerGallonOfStock * gallonsOfStockPerGallonOfFeed
    for (const [element, elementFraction] of saltElementFractions(saltKey)) {
      delivered[element] += ((gramsPerGallonOfFeed * elementFraction) / LITERS_PER_GALLON) * 1000
    }
  }

  return delivered
}
