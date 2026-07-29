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
  buildDirectAddCalciumCarbonate,
  CALCIUM_INCOMPATIBLE_SALTS,
  calciumChlorideElementalCalciumPpm,
  combineDirectAddCalciumCarbonate,
  ELEMENT_LABELS,
  elementalPpmFromSaltAmounts,
  emptyElementalTargets,
  emptySaltAmounts,
  getConcentrateGramsPerLiter,
  getDoseGramsPerGallon,
  getEnabledSaltKeys,
  gramsFromFeedRatePerGallon,
  isCalciumNitrateSoleDoseSource,
  isWithinMatchTolerance,
  matchTolerancePpm,
  parsePositive,
  percentToPpm,
  RAW_SALTS,
  SALT_DISPLAY_ORDER,
  saltAmountsCarryNitrogen,
  saltAmountsCarryTaperableNitrogen,
  saltFitsOneTank,
  TAPERABLE_NITROGEN_SALTS,
  TANK_1_SALTS,
  TANK_2_SALTS,
  TANK_3_SALTS,
  TANK_A_SALTS,
  TANK_B_SALTS,
  ureaNitrogenPpmForPart,
  DEFAULT_MICRO_PROFILE_IRON_PPM,
  MICRO_ANCHOR_KEYS,
  MICRO_KEYS,
  MICRO_TO_FE_RATIO,
  type DirectAddCalciumCarbonate,
  type DirectMixRecipe,
  type ElementalTargets,
  type EstimatedTargets,
  type IncludedSaltsSelection,
  type MicroKey,
  type MultiPartTankRecipe,
  type PartStockTank,
  type SaltAmounts,
  type SaltAutoAddNote,
  type SaltGapWarning,
  type SaltKey,
  type SeparateNitrogenRecipe,
  type SeparateNitrogenTank,
  type SeparateNitrogenTankRole,
  type TankRecipe,
  type TargetDeviation,
} from "@/lib/hydro-calc/recipe-types"

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
    if (concentrateGramsPerLiter > 0) {
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

    // Calcium Chloride's optional per-gallon amount (see the Guaranteed
    // Analysis screen) is a raw salt addition entered SEPARATELY from the
    // %-based guaranteed-analysis fields above — it isn't folded into
    // `analysis.calcium`, so its elemental Calcium never showed up here (or
    // anywhere the Calcium target is used: the stock-tank solver above, the
    // EC estimate, and the "What your plants will get" ppm breakdown all
    // silently dropped it). Add it on top, straight from the dose, using
    // the same conversion the solver uses to size Calcium Chloride's own
    // stock-tank grams (`calciumChlorideElementalCalciumPpm` /
    // `gramsFromFeedRatePerGallon` — see `calculateStockTankRecipe`), so the
    // displayed target and the actual recipe agree on how much Calcium
    // Chloride contributes.
    if (analysis.includedSalts?.calciumChloride) {
      totals.calcium += calciumChlorideElementalCalciumPpm(parsePositive(analysis.calciumChlorideGramsPerGallon))
    }

    // Urea's "% Urea Nitrogen" label value (see the Guaranteed Analysis
    // screen) is entered SEPARATELY from the main %N field above — folded
    // in here the same way Calcium Chloride's dose is folded into the
    // Calcium target, so it reaches the Nitrogen target, the stock-tank
    // solver, the EC estimate, and the "What your plants will get" ppm
    // breakdown consistently. See `ureaNitrogenPpmForPart`.
    totals.nitrogen += ureaNitrogenPpmForPart(feedingPart, analysis)
  }

  return totals
}

/**
 * How much more (or less) Calcium/Nitrogen ppm a literally-dosed Calcium
 * Nitrate part's *real* declared label composition delivers compared to
 * what `RAW_SALTS.calciumNitrate`'s generic composition (19% Ca, 15.5% N —
 * the commercial 15.5-0-0 + 19% Ca greenhouse grade, not necessarily what
 * any given product a grower buys actually is) would imply for the same dose.
 *
 * This matters only for the EC estimate (`estimateEcFromElementalTargets`).
 * For every ordinary, ppm-target-solved salt, grams are back-derived FROM a
 * ppm target using `RAW_SALTS`' generic fraction, so recomputing ion
 * content from those grams via the same fraction round-trips back to
 * exactly that target — no error. But a literally-dosed Calcium Nitrate
 * part's grams (see `isCalciumNitrateSoleDoseSource` and the
 * Calcium-solving block in `calculateStockTankRecipe`) come straight from
 * a real, physically-measured feed rate instead — so reconstructing ITS ion
 * content for EC purposes has to use the real label %N/%Ca (already known,
 * and already what the elemental targets above are built from), or the
 * estimate silently drops however much the real product's %N/%Ca run ahead
 * of (or behind) the generic assumption. Cases where they diverge: lab-grade
 * pure tetrahydrate (16.9% Ca, 11.8% N) runs leaner than the commercial
 * grade RAW_SALTS models, and higher-N grades like 17-0-0 run richer.
 */
export function calciumNitrateLiteralDoseEcPpmDelta(
  partsAnalysis: PartAnalysis[],
  parts: NutrientPart[]
): { calciumPpmDelta: number; nitrogenPpmDelta: number } {
  const analysisById = new Map(partsAnalysis.map((part) => [part.id, part]))
  let calciumPpmDelta = 0
  let nitrogenPpmDelta = 0

  for (const feedingPart of parts) {
    const analysis = analysisById.get(feedingPart.id)
    if (!analysis) continue
    if (!analysis.includedSalts?.calciumChloride) continue
    if (parsePositive(analysis.calciumChlorideGramsPerGallon) === 0) continue
    if (!isCalciumNitrateSoleDoseSource(analysis.includedSalts)) continue

    const concentrateGramsPerLiter = getConcentrateGramsPerLiter(feedingPart)
    if (concentrateGramsPerLiter === 0) continue

    const realCalciumPpm = percentToPpm(parsePositive(analysis.calcium), concentrateGramsPerLiter)
    const realNitrogenPpm = percentToPpm(parsePositive(analysis.nitrogen), concentrateGramsPerLiter)
    const genericCalciumPpm = percentToPpm(RAW_SALTS.calciumNitrate.ca * 100, concentrateGramsPerLiter)
    const genericNitrogenPpm = percentToPpm(RAW_SALTS.calciumNitrate.n * 100, concentrateGramsPerLiter)

    calciumPpmDelta += realCalciumPpm - genericCalciumPpm
    nitrogenPpmDelta += realNitrogenPpm - genericNitrogenPpm
  }

  return { calciumPpmDelta, nitrogenPpmDelta }
}

/** Guaranteed-analysis oxide → elemental conversion factors */
const P2O5_TO_P = 30.974 / 70.974 // ≈ 0.436
const K2O_TO_K = 78.169 / 94.196 // ≈ 0.830

export interface MicroEstimateOptions {
  /**
   * Whether this call may fall back to the standard balanced profile when the
   * targets carry no anchorable micro. The per-part tank layouts pass false
   * for every part except the one that owns the micro package (see
   * `pickDefaultMicroProfilePartId`), so a two-part feed doesn't end up with
   * two full micro doses stacked on top of each other. Defaults to true for
   * the combined layouts, which run this once over every part's totals.
   */
  allowDefaultProfile?: boolean
}

/**
 * Fill in any missing micronutrient targets (ppm = 0) using standard
 * hydroponic Fe-anchored ratios. If Fe is missing, the first non-zero micro
 * in `MICRO_ANCHOR_KEYS` order is used to back-derive an implied Fe ppm and
 * the rest are estimated from that.
 *
 * A label with no anchorable micro still gets a complete, balanced package:
 * anything it does declare is kept as-is (a Molybdenum-only label keeps its
 * real Mo) and the rest are filled from `DEFAULT_MICRO_PROFILE_IRON_PPM`, an
 * absolute standard-profile Iron target — never back-derived from Mo's 1/1200
 * ratio, see `MICRO_ANCHOR_KEYS`.
 */
export function applyMicroEstimates(
  targets: ElementalTargets,
  { allowDefaultProfile = true }: MicroEstimateOptions = {}
): EstimatedTargets {
  const estimated = new Set<MicroKey>()
  const result: ElementalTargets = { ...targets }

  const anchor = MICRO_ANCHOR_KEYS.find((key) => targets[key] > 0) ?? null
  const unanchoredMicros = anchor === null ? MICRO_KEYS.filter((key) => targets[key] > 0) : []

  // An all-zero target set is an empty or undosed feed rather than a product
  // whose label forgot its micros — there's nothing to build a recipe around,
  // so don't invent a micro package for it.
  const hasAnyElement = Object.values(targets).some((value) => value > 0)
  const useDefaultProfile = anchor === null && allowDefaultProfile && hasAnyElement

  if (anchor === null && !useDefaultProfile) {
    return { targets: result, estimated, anchor: null, unanchoredMicros, estimateSource: "none" }
  }

  // With a usable anchor, scale the package off that declared value. Without
  // one, use the standard profile's absolute Iron target — scaling off an
  // ultra-trace declared micro instead is precisely the 1200× amplification
  // `MICRO_ANCHOR_KEYS` exists to prevent.
  const impliedIron =
    anchor === null ? DEFAULT_MICRO_PROFILE_IRON_PPM : result[anchor] / MICRO_TO_FE_RATIO[anchor]

  for (const key of MICRO_KEYS) {
    if (targets[key] > 0) continue
    result[key] = impliedIron * MICRO_TO_FE_RATIO[key]
    estimated.add(key)
  }

  return {
    targets: result,
    estimated,
    anchor,
    unanchoredMicros,
    estimateSource: useDefaultProfile ? "default-profile" : "anchor",
  }
}

/**
 * Which part should carry the invented micro package in the per-part tank
 * layouts ("per-part" stock tanks, doser), which size each part's tank from its own
 * targets — see `calculateMultiPartStockTankRecipe`. Exactly one part may fall
 * back to the standard balanced profile, or the feed would get one full micro
 * dose per bottle.
 *
 * Returns null when some part declares an anchorable micro: that part's own
 * ratio estimate already builds a package off real label data, so no other
 * part should invent one on top of it.
 *
 * Otherwise the package goes to the part with the best claim to it — one that
 * declares a micro at all (typically Molybdenum), then one whose label lists
 * chelated micronutrients, then simply the first dosed part.
 */
function pickDefaultMicroProfilePartId(
  partsAnalysis: PartAnalysis[],
  parts: NutrientPart[]
): string | null {
  const analysisById = new Map(partsAnalysis.map((part) => [part.id, part]))
  const candidates: Array<{ part: NutrientPart; analysis: PartAnalysis; targets: ElementalTargets }> = []

  for (const feedingPart of parts) {
    if (parsePositive(feedingPart.dose) === 0) continue
    const analysis = analysisById.get(feedingPart.id)
    if (!analysis) continue

    const targets = calculateElementalTargets([analysis], [feedingPart])
    if (!Object.values(targets).some((value) => value > 0)) continue
    if (MICRO_ANCHOR_KEYS.some((key) => targets[key] > 0)) return null

    candidates.push({ part: feedingPart, analysis, targets })
  }

  const declaresAMicro = candidates.find(({ targets }) => MICRO_KEYS.some((key) => targets[key] > 0))
  const listsChelatedMicros = candidates.find(
    ({ analysis }) => analysis.includedSalts?.chelatedMicronutrients
  )

  return (declaresAMicro ?? listsChelatedMicros ?? candidates[0])?.part.id ?? null
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
 * Macronutrients the amount-refinement pass below balances against each
 * other. Micronutrients are deliberately excluded: each one is supplied by
 * exactly one salt, and that salt supplies nothing else, so the sequential
 * pass already hits every micro target exactly and there is no trade-off to
 * make.
 */
const REFINED_ELEMENTS = [
  "nitrogen",
  "phosphorus",
  "potassium",
  "calcium",
  "magnesium",
  "sulfur",
] as const satisfies readonly (keyof ElementalTargets)[]

type RefinedElement = (typeof REFINED_ELEMENTS)[number]

/** Which `RAW_SALTS` composition fraction supplies each refined element */
const REFINED_ELEMENT_FRACTION_FIELD: Record<RefinedElement, string> = {
  nitrogen: "n",
  phosphorus: "p",
  potassium: "k",
  calcium: "ca",
  magnesium: "mg",
  sulfur: "s",
}

function saltFractionOf(saltKey: SaltKey, element: RefinedElement): number {
  const composition: Record<string, unknown> = RAW_SALTS[saltKey]
  const fraction = composition[REFINED_ELEMENT_FRACTION_FIELD[element]]
  return typeof fraction === "number" && fraction > 0 ? fraction : 0
}

/**
 * Strength of the pull back toward the sequential pass's own allocation,
 * relative to each variable's own fitting weight. Deliberately tiny: it only
 * breaks ties. When the enabled salts can hit every target exactly there are
 * often many gram combinations that do (MKP + MAP + KNO₃ is the standard
 * example — see `mkpShareOfPhosphorus`), and least squares alone has no
 * opinion about which one to return. Anchoring keeps whichever the
 * well-established sequential heuristics chose, so this pass changes nothing
 * for recipes that already matched and only redistributes amounts where they
 * genuinely didn't.
 */
const REFINEMENT_ANCHOR_STRENGTH = 1e-6

const REFINEMENT_MAX_PASSES = 400

/** Stop once a full pass moves every element by less than this many ppm */
const REFINEMENT_CONVERGENCE_PPM = 1e-9

/**
 * One adjustable quantity in the refinement below. Every current variable is a
 * single salt (`gramsPerUnit` 1, so the variable *is* that salt's grams). The
 * component list exists so salts whose ratio to each other is fixed by the
 * product being replicated can scale together as one variable, letting the fit
 * resize that product as a whole without breaking up its formula — see
 * `buildRefinementVariables` for why no pair currently needs it.
 */
interface RefinementVariable {
  components: Array<{ saltKey: SaltKey; gramsPerUnit: number }>
}

/**
 * Rebalance the salt amounts the sequential pass produced so the recipe
 * actually delivers the elemental targets as closely as the enabled salts
 * allow.
 *
 * The sequential pass solves one element at a time in a fixed priority order,
 * which works whenever each element has a dedicated source but breaks down as
 * soon as one salt carries two targeted elements. Every macro salt does:
 * KNO₃ sized for Nitrogen drags Potassium along, MKP sized for Phosphorus
 * drags Potassium along, MgSO₄ sized for Magnesium drags Sulfur along. Once
 * an earlier element's salt has already over-supplied a later one, the
 * sequential pass has no way to walk it back — it only ever tops deficits up.
 * That's how a grower who checked Potassium Sulfate for both its Potassium
 * and its Sulfur got a recipe containing none of it: KNO₃ and MKP had already
 * pushed Potassium past its target, leaving no "remaining Potassium" to
 * assign, and Sulfur was never a sizing input at all.
 *
 * This pass replaces that one-shot ordering with a bounded least-squares fit
 * over every enabled salt at once. Each element's squared ppm error is weighted
 * by 1/tolerance² off the shared per-element bands in `matchTolerancePpm`, so
 * error is minimized in units of how much each element actually cares rather
 * than in raw ppm, and amounts are constrained to be non-negative. Crucially,
 * *every* enabled salt is a variable here — even ones the sequential pass left
 * at zero — which is what lets a checked salt be used whenever it reduces total
 * error, instead of only when an earlier step happened to leave a gap of
 * exactly the right shape behind.
 *
 * Two properties keep this safe as a refinement rather than a rewrite:
 *
 *  - When the sequential pass already hits every target, its solution has zero
 *    residual, which is the global optimum of a non-negative least-squares
 *    problem — so nothing moves. Only recipes that were already wrong change.
 *  - Amounts the grower physically declared (a literal feed-chart dose, a
 *    label's own % Urea Nitrogen) are not variables at all; they're held fixed
 *    and their contribution is simply part of what the free salts fit around.
 *
 * Mutates `amounts` in place. `targets.sulfur` of 0 means "the label didn't
 * declare any Sulfur", not "this recipe must contain no Sulfur" — sulfate is
 * unavoidable whenever MgSO₄ supplies the Magnesium, and Sulfur is often
 * simply omitted from labels — so Sulfur is left out of the fit entirely in
 * that case rather than fitted against a target of zero (the caller fills it
 * in afterward from whatever sulfate the recipe ends up with, see
 * `saltDerivedSulfurPpm`).
 */
function refineSaltAmountsToTargets(
  amounts: SaltAmounts,
  variables: RefinementVariable[],
  targets: ElementalTargets,
  stockVolumeLiters: number,
  dilutionRatio: number
): void {
  if (variables.length === 0) return
  const ppmPerGram = 1000 / (stockVolumeLiters * dilutionRatio)
  if (!Number.isFinite(ppmPerGram) || ppmPerGram <= 0) return

  const fittedElements = REFINED_ELEMENTS.filter(
    (element) => element !== "sulfur" || targets.sulfur > 0
  )

  const weights = new Map<RefinedElement, number>()
  for (const element of fittedElements) {
    const tolerance = matchTolerancePpm(element, targets[element])
    weights.set(element, 1 / (tolerance * tolerance))
  }

  // ppm each variable adds per unit, and the residual it acts on.
  const coefficients = variables.map((variable) => {
    const perElement = new Map<RefinedElement, number>()
    for (const element of fittedElements) {
      let ppm = 0
      for (const { saltKey, gramsPerUnit } of variable.components) {
        ppm += gramsPerUnit * saltFractionOf(saltKey, element) * ppmPerGram
      }
      if (ppm > 0) perElement.set(element, ppm)
    }
    return perElement
  })

  const values = variables.map((variable) => {
    const [reference] = variable.components
    return reference.gramsPerUnit > 0 ? amounts[reference.saltKey] / reference.gramsPerUnit : 0
  })
  const initialValues = [...values]

  // Delivered ppm from *every* salt, including the fixed ones the variables
  // have to fit around.
  const delivered = new Map<RefinedElement, number>()
  for (const element of fittedElements) {
    let ppm = 0
    for (const saltKey of Object.keys(RAW_SALTS) as SaltKey[]) {
      ppm += amounts[saltKey] * saltFractionOf(saltKey, element) * ppmPerGram
    }
    delivered.set(element, ppm)
  }

  // Projected coordinate descent. The objective is convex and each variable's
  // exact minimizer given the others is a closed form, so this converges
  // without a step size to tune.
  for (let pass = 0; pass < REFINEMENT_MAX_PASSES; pass += 1) {
    let largestMovePpm = 0

    for (let index = 0; index < variables.length; index += 1) {
      const perElement = coefficients[index]
      if (perElement.size === 0) continue

      let gradient = 0
      let curvature = 0
      for (const [element, ppmPerUnit] of perElement) {
        const weight = weights.get(element) ?? 0
        const residual = (delivered.get(element) ?? 0) - targets[element]
        gradient += weight * residual * ppmPerUnit
        curvature += weight * ppmPerUnit * ppmPerUnit
      }
      if (curvature <= 0) continue

      const anchor = REFINEMENT_ANCHOR_STRENGTH * curvature
      const step =
        (gradient + anchor * (values[index] - initialValues[index])) / (curvature + anchor)
      const next = Math.max(0, values[index] - step)
      const move = next - values[index]
      if (move === 0) continue

      values[index] = next
      for (const [element, ppmPerUnit] of perElement) {
        delivered.set(element, (delivered.get(element) ?? 0) + ppmPerUnit * move)
        largestMovePpm = Math.max(largestMovePpm, Math.abs(ppmPerUnit * move))
      }
    }

    if (largestMovePpm < REFINEMENT_CONVERGENCE_PPM) break
  }

  variables.forEach((variable, index) => {
    for (const { saltKey, gramsPerUnit } of variable.components) {
      amounts[saltKey] = values[index] * gramsPerUnit
    }
  })
}

/**
 * Build A/B stock tank recipes using a standard hydroponic salt sequence:
 * Tank A — Ca(NO₃)₂, CaCl₂, KNO₃/NH₄NO₃ (remaining N), Mg(NO₃)₂, Urea, Fe-DTPA  (see TANK_A_SALTS)
 * Tank B — MKP/MAP (Phosphorus), MgSO₄, K₂SO₄/(NH₄)₂SO₄ (remaining K), chelated micronutrients (Mn/Zn/Cu-EDTA, boric acid, sodium molybdate)  (see TANK_B_SALTS)
 *
 * Calcium and phosphate are assigned to opposite tanks by construction so they
 * never coexist in a concentrated stock solution where they would precipitate.
 *
 * Calcium Carbonate (CaCO₃) is deliberately never put into either tank, even
 * when it's the (or a) enabled Calcium source: it's essentially insoluble at
 * stock-tank concentrations (its solubility is ~15 mg/L in plain water, and
 * concentrating it 50-200x the way a stock tank concentrates everything else
 * just leaves undissolved grit at the bottom of the tank and an unreliable,
 * unmeasurable dose). It's still counted toward meeting the Calcium target
 * below — the Calcium math is unchanged — but the resulting amount comes
 * back separately as `directAddCalciumCarbonate`, sized as a straight
 * reservoir/batch-tank addition instead, where the full volume of water
 * gives it a chance to (mostly) dissolve or at least stay evenly suspended.
 *
 * `includedSalts` restricts which salts the solver is allowed to reach for
 * (see `getEnabledSaltKeys`). When a target's only source salt is disabled,
 * that target is left unmet and reported in `warnings` — the caller should
 * surface a "closest possible recipe" notice. The chelated micronutrients
 * (Fe-DTPA, Mn/Zn/Cu-EDTA, boric acid, sodium molybdate) are always
 * available regardless of the selection — sulfate micronutrient salts
 * (MnSO₄, ZnSO₄, CuSO₄) are not modeled and never emitted.
 */
export function calculateStockTankRecipe(
  targets: ElementalTargets,
  stockVolumeLiters: number,
  dilutionRatio: number,
  includedSalts?: IncludedSaltsSelection,
  /**
   * Optional user-specified Calcium Chloride dose in grams per US gallon of
   * working (reservoir) feed (see `gramsFromFeedRatePerGallon`). When
   * provided and > 0, it takes priority over the ppm-target-derived share
   * below — see the Calcium-solving block for details. Zero/omitted falls
   * back to that share-based amount so Calcium Chloride still gets a real,
   * non-zero allocation.
   */
  calciumChlorideGramsPerGallon: number = 0,
  /**
   * Optional literal Calcium Nitrate feed-chart dose in grams per US gallon
   * of working (reservoir) feed, for the SAME part as
   * `calciumChlorideGramsPerGallon` above. Only meaningful — and only ever
   * passed by callers — when Calcium Nitrate is that part's sole macro salt
   * (see `isCalciumNitrateSoleDoseSource`); see the Calcium-solving block
   * for why it takes priority over the usual ppm-target-derived amount in
   * that case. Zero/omitted falls back to the existing ppm-target-derived
   * sizing.
   */
  calciumNitrateGramsPerGallon: number = 0,
  /**
   * Elemental Nitrogen ppm already known to come specifically from Urea
   * (see `ureaNitrogenPpmForPart` / `sumUreaNitrogenPpm`) — already folded
   * into `targets.nitrogen` by `calculateElementalTargets`. Sizing Urea
   * off this known amount directly (rather than leaving it to the generic
   * "remaining Nitrogen" logic below, which would just as happily reach
   * for KNO₃/NH₄NO₃ instead) keeps the resolved recipe faithful to what
   * the user actually declared for Urea specifically — the same way MAP's
   * own Nitrogen contribution is subtracted out before that logic runs.
   */
  ureaNitrogenPpm: number = 0
): TankRecipe {
  const tankA = emptySaltAmounts()
  const tankB = emptySaltAmounts()
  const warnings: SaltGapWarning[] = []
  const autoAddedSalts: SaltAutoAddNote[] = []

  if (stockVolumeLiters <= 0 || dilutionRatio <= 0) {
    return {
      tankA,
      tankB,
      warnings,
      isApproximate: false,
      autoAddedSalts,
      delivered: emptyElementalTargets(),
      deviations: [],
    }
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
  // When Calcium Carbonate is *also* explicitly enabled alongside Calcium
  // Nitrate (e.g. "Crop Salt"-style lines that blend both Calcium sources),
  // the two must split the Calcium target rather than one silently zeroing
  // the other out.
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
  // Fix: give each explicitly-enabled *primary* Calcium source (Nitrate
  // and/or Carbonate) a fixed, guaranteed equal share of the Calcium target
  // up front — independent of the Nitrogen target — so Carbonate always
  // receives a real, non-zero allocation whenever the user checks it.
  // Calcium Nitrate's share may still be bumped upward afterward to help
  // close a Nitrogen gap (the same Calcium-overshoot trade-off already
  // accepted below when Nitrate is the only enabled Calcium source);
  // Carbonate's share is never reduced by that, since it is the whole point
  // of the user's explicit selection.
  //
  // Calcium Chloride gets different treatment: real nutrient lines that use
  // it almost never split their calcium budget evenly with it — the common
  // pattern is "buy a plain, single-source Calcium product (typically
  // generic Calcium Nitrate, e.g. 15.5-0-0 / 19% Ca) and stir in a small
  // top-up amount of Calcium Chloride" rather than dosing the two as equal
  // partners. So whenever Chloride is enabled *alongside* a primary source,
  // it only claims a small fixed slice of the Calcium target
  // (`CALCIUM_CHLORIDE_MINOR_SHARE`), leaving the rest for Nitrate/
  // Carbonate to split as above — this lets a generic "Calcium Nitrate + a
  // little Calcium Chloride" product be modeled as a single Part A, without
  // inventing a fake combined Ca/N percentage on Step 1. When Chloride is
  // the *only* enabled Calcium source, it instead claims the full target,
  // same as Nitrate- or Carbonate-alone above.
  //
  // Calcium Chloride is a soluble stock-tank salt (unlike Carbonate, which
  // is direct-add only — see `buildDirectAddCalciumCarbonate` below), so it
  // is sized the same way as Calcium Nitrate and lands in Tank A.
  //
  // When the caller supplies an explicit `calciumChlorideGramsPerGallon`
  // dose (the user's own product amount, entered on the Guaranteed Analysis
  // screen), that dose is used verbatim instead of the fixed-share estimate
  // below — it's a real, physically-measured amount rather than one derived
  // from the Calcium ppm target, so the primary source(s) simply pick up
  // whatever Calcium ppm is left over after Chloride's fixed contribution
  // is accounted for. This is what lets a part be "Chloride only" (nothing
  // left over to assign) or "Nitrate + a specified amount of Chloride"
  // (Nitrate absorbs the remainder) using the same code path.
  //
  // That "remainder" handling is what feeds Calcium's own ppm target into
  // Calcium Nitrate — which, further down, may then get resized again to
  // close a Nitrogen gap (see the Nitrogen block below). Both of those
  // steps solve backward from an elemental ppm target using
  // RAW_SALTS.calciumNitrate's *assumed* commercial-grade fractions (19% Ca,
  // 15.5% N), which is exactly what you want when replicating an unknown
  // blend from its label %s — but it reintroduces real error whenever the
  // caller *also* supplies `calciumNitrateGramsPerGallon`: a literal,
  // physically-measured feed-chart dose for this same part, valid only when
  // Calcium Nitrate is that part's sole macro salt (see
  // `isCalciumNitrateSoleDoseSource`). In that specific case — a plain
  // Calcium Nitrate bottle with a measured Calcium Chloride top-up, e.g.
  // "2.5 g/gal Calcium Nitrate + 0.25 g/gal Calcium Chloride" mirroring a
  // manufacturer's own "1 lb + 0.1 lb per gallon of stock" directions —
  // both doses are already known exactly, so both are scaled straight from
  // their feed rates via `gramsFromFeedRatePerGallon` (same conversion,
  // same stock volume/dilution ratio) instead of being re-derived from
  // %-based targets built on an assumed salt purity that may not match the
  // real product.
  const CALCIUM_CHLORIDE_MINOR_SHARE = 0.1

  let calciumNitrateGrams = 0
  let calciumCarbonateGrams = 0
  let calciumChlorideGrams = 0
  let calciumNitrateSizedFromFeedRate = false
  const nitrateEnabled = isEnabled("calciumNitrate")
  const carbonateEnabled = isEnabled("calciumCarbonate")
  const chlorideEnabled = isEnabled("calciumChloride")
  const hasPrimaryCalciumSource = nitrateEnabled || carbonateEnabled

  if (targets.calcium > 0) {
    if (!nitrateEnabled && !carbonateEnabled && !chlorideEnabled) {
      warnings.push({ element: "calcium", label: "Calcium" })
    } else {
      const explicitChlorideGrams = chlorideEnabled
        ? gramsFromFeedRatePerGallon(calciumChlorideGramsPerGallon, stockVolumeLiters, dilutionRatio)
        : 0

      if (explicitChlorideGrams > 0) {
        calciumChlorideGrams = explicitChlorideGrams
        let calciumPpmAlreadySized = ppmFromSaltInStock(
          calciumChlorideGrams,
          RAW_SALTS.calciumChloride.ca,
          stockVolumeLiters,
          dilutionRatio
        )

        const explicitNitrateGrams = nitrateEnabled
          ? gramsFromFeedRatePerGallon(calciumNitrateGramsPerGallon, stockVolumeLiters, dilutionRatio)
          : 0
        if (explicitNitrateGrams > 0) {
          calciumNitrateGrams = explicitNitrateGrams
          calciumNitrateSizedFromFeedRate = true
          calciumPpmAlreadySized += ppmFromSaltInStock(
            calciumNitrateGrams,
            RAW_SALTS.calciumNitrate.ca,
            stockVolumeLiters,
            dilutionRatio
          )
        }

        // Any Calcium the fixed dose(s) above don't cover falls to whichever
        // primary source(s) are still unsized, split evenly — same "equal
        // share" policy used below for two primary sources with no Chloride
        // at all. If Chloride is the only enabled source (or every primary
        // source ended up sized from its own feed rate) and the fixed
        // dose(s) undershoot the target, that's expected (real measured
        // amounts, not solved backward from the target) rather than a
        // warning-worthy gap.
        const remainingCalciumPpm = Math.max(0, targets.calcium - calciumPpmAlreadySized)
        const unsizedPrimarySourceCount =
          (nitrateEnabled && !calciumNitrateSizedFromFeedRate ? 1 : 0) + (carbonateEnabled ? 1 : 0)
        const primaryShareEachPpm = unsizedPrimarySourceCount > 0 ? remainingCalciumPpm / unsizedPrimarySourceCount : 0

        if (nitrateEnabled && !calciumNitrateSizedFromFeedRate) {
          calciumNitrateGrams = saltGramsForTargetPpm(
            primaryShareEachPpm,
            RAW_SALTS.calciumNitrate.ca,
            stockVolumeLiters,
            dilutionRatio
          )
        }
        if (carbonateEnabled) {
          calciumCarbonateGrams = saltGramsForTargetPpm(
            primaryShareEachPpm,
            RAW_SALTS.calciumCarbonate.ca,
            stockVolumeLiters,
            dilutionRatio
          )
        }
      } else {
        const chlorideShare = !chlorideEnabled
          ? 0
          : hasPrimaryCalciumSource
            ? CALCIUM_CHLORIDE_MINOR_SHARE
            : 1
        const primarySourceCount = (nitrateEnabled ? 1 : 0) + (carbonateEnabled ? 1 : 0)
        const primaryShareEach = primarySourceCount > 0 ? (1 - chlorideShare) / primarySourceCount : 0

        if (nitrateEnabled) {
          calciumNitrateGrams = saltGramsForTargetPpm(
            targets.calcium * primaryShareEach,
            RAW_SALTS.calciumNitrate.ca,
            stockVolumeLiters,
            dilutionRatio
          )
        }
        if (carbonateEnabled) {
          calciumCarbonateGrams = saltGramsForTargetPpm(
            targets.calcium * primaryShareEach,
            RAW_SALTS.calciumCarbonate.ca,
            stockVolumeLiters,
            dilutionRatio
          )
        }
        if (chlorideEnabled) {
          // Nitrogen-free calcium source — the remaining-N logic below still
          // needs another enabled salt to close any Nitrogen gap when
          // Chloride is the only Calcium source.
          calciumChlorideGrams = saltGramsForTargetPpm(
            targets.calcium * chlorideShare,
            RAW_SALTS.calciumChloride.ca,
            stockVolumeLiters,
            dilutionRatio
          )
        }
      }
    }
  }

  const nitrogenFromCalciumNitrate = ppmFromSaltInStock(
    calciumNitrateGrams,
    RAW_SALTS.calciumNitrate.n,
    stockVolumeLiters,
    dilutionRatio
  )

  // Phosphorus — MKP is preferred by default; MAP (NH₄H₂PO₄) is the
  // fallback P source when MKP isn't part of the product being replicated.
  //
  // When *both* are enabled, picking one exclusively is a trap: MKP always
  // brings Potassium along as a fixed side effect of hitting the
  // Phosphorus target, and — unlike a Potassium deficit, which the
  // remaining-Potassium step below can always top up with K₂SO₄ — nothing
  // downstream can ever *remove* Potassium once it's been added. So if
  // KNO₃ is being relied on to close a large remaining Nitrogen gap (the
  // common case when Ca(NO₃)₂ alone doesn't cover it), the Potassium that
  // KNO₃ drags along on top of MKP's own Potassium can badly overshoot the
  // target — and since EC scales with total dissolved ions, that overshoot
  // shows up directly as an inflated EC estimate.
  //
  // MAP supplies the same Phosphorus with zero Potassium (contributing
  // ammoniacal Nitrogen instead), so blending MKP and MAP — rather than
  // treating them as exclusive alternatives — lets the solver dial the
  // *combined* Potassium contribution (MKP's own + whatever KNO₃ ends up
  // sized for once MAP's Nitrogen is subtracted out) down to exactly match
  // the Potassium target whenever that target sits between "all MAP" and
  // "all MKP". Solved as a single linear equation in `mkpShare` (see
  // below); only engages when both salts are enabled and KNO₃ is the one
  // absorbing the remaining Nitrogen — otherwise this collapses back to the
  // original MKP-preferred / MAP-fallback behavior.
  let mkpShareOfPhosphorus = 1
  if (
    targets.phosphorus > 0 &&
    isEnabled("monoPotassiumPhosphate") &&
    isEnabled("monoAmmoniumPhosphate") &&
    isEnabled("potassiumNitrate")
  ) {
    const kPerPFromMkp = RAW_SALTS.monoPotassiumPhosphate.k / RAW_SALTS.monoPotassiumPhosphate.p
    const nPerPFromMap = RAW_SALTS.monoAmmoniumPhosphate.n / RAW_SALTS.monoAmmoniumPhosphate.p
    const kPerNFromKno3 = RAW_SALTS.potassiumNitrate.k / RAW_SALTS.potassiumNitrate.n

    // Total Potassium delivered as a function of `mkpShare` (fraction of
    // the Phosphorus target sourced from MKP, 0–1): MKP's own Potassium
    // scales up with `mkpShare`, while KNO₃'s Potassium scales up as
    // `mkpShare` rises too (since less Phosphorus-derived Nitrogen from MAP
    // means more Nitrogen — and therefore more Potassium — has to come from
    // KNO₃). Both terms move the same direction, so this is monotonic and a
    // single linear solve finds the exact match when one exists.
    const totalKAtShare = (mkpShare: number) => {
      const nFromMap = (1 - mkpShare) * targets.phosphorus * nPerPFromMap
      const remainingNitrogenForKno3 = Math.max(0, targets.nitrogen - nitrogenFromCalciumNitrate - nFromMap)
      return mkpShare * targets.phosphorus * kPerPFromMkp + remainingNitrogenForKno3 * kPerNFromKno3
    }

    const kAtAllMap = totalKAtShare(0)
    const kAtAllMkp = totalKAtShare(1)

    if (kAtAllMkp === kAtAllMap) {
      // Degenerate (e.g. no Nitrogen left for KNO₃ either way) — Potassium
      // doesn't depend on the split, so keep the legacy MKP-first default.
      mkpShareOfPhosphorus = 1
    } else {
      const rawShare = (targets.potassium - kAtAllMap) / (kAtAllMkp - kAtAllMap)
      mkpShareOfPhosphorus = Math.min(1, Math.max(0, rawShare))
    }
  } else if (targets.phosphorus > 0 && !isEnabled("monoPotassiumPhosphate") && isEnabled("monoAmmoniumPhosphate")) {
    mkpShareOfPhosphorus = 0
  }

  let monoAmmoniumPhosphateGrams = 0
  if (targets.phosphorus > 0) {
    if (isEnabled("monoPotassiumPhosphate") || isEnabled("monoAmmoniumPhosphate")) {
      const mkpPhosphorusPpm = targets.phosphorus * mkpShareOfPhosphorus
      const mapPhosphorusPpm = targets.phosphorus * (1 - mkpShareOfPhosphorus)

      if (mkpPhosphorusPpm > 0) {
        assignToTankB(
          "monoPotassiumPhosphate",
          saltGramsForTargetPpm(mkpPhosphorusPpm, RAW_SALTS.monoPotassiumPhosphate.p, stockVolumeLiters, dilutionRatio)
        )
      }
      if (mapPhosphorusPpm > 0) {
        monoAmmoniumPhosphateGrams = saltGramsForTargetPpm(
          mapPhosphorusPpm,
          RAW_SALTS.monoAmmoniumPhosphate.p,
          stockVolumeLiters,
          dilutionRatio
        )
        assignToTankB("monoAmmoniumPhosphate", monoAmmoniumPhosphateGrams)
      }
    } else {
      warnings.push({ element: "phosphorus", label: "Phosphorus" })
    }
  }

  // Urea's Nitrogen contribution is a known, real declared amount (the
  // user's own "% Urea Nitrogen" label value — see the doc comment on
  // `ureaNitrogenPpm` above), so it's sized off that directly rather than
  // left to the generic "remaining Nitrogen" priority order below — the
  // same treatment MAP's Nitrogen gets just below.
  let ureaGrams = 0
  if (ureaNitrogenPpm > 0 && isEnabled("urea")) {
    ureaGrams = saltGramsForTargetPpm(ureaNitrogenPpm, RAW_SALTS.urea.n, stockVolumeLiters, dilutionRatio)
  }
  const nitrogenFromUrea = ppmFromSaltInStock(ureaGrams, RAW_SALTS.urea.n, stockVolumeLiters, dilutionRatio)

  // Magnesium — MgSO₄ is the default Mg source; Mg(NO₃)₂ is an alternate Mg
  // source that also brings along nitrate-Nitrogen. Sized here (before the
  // remaining-Nitrogen resolution below) so Magnesium Nitrate's own Nitrogen
  // contribution can be subtracted out first, the same way Urea's and MAP's
  // are just above. When both Mg sources are enabled, split the Magnesium
  // target evenly between them — the same "equal share" policy used for
  // Calcium when more than one primary source is enabled (see the
  // Calcium-solving block above).
  const magnesiumSulfateEnabled = isEnabled("magnesiumSulfate")
  const magnesiumNitrateEnabled = isEnabled("magnesiumNitrate")
  let magnesiumNitrateGrams = 0
  if (targets.magnesium > 0) {
    if (!magnesiumSulfateEnabled && !magnesiumNitrateEnabled) {
      warnings.push({ element: "magnesium", label: "Magnesium" })
    } else {
      const magnesiumSourceCount = (magnesiumSulfateEnabled ? 1 : 0) + (magnesiumNitrateEnabled ? 1 : 0)
      const magnesiumPpmEach = targets.magnesium / magnesiumSourceCount
      if (magnesiumSulfateEnabled) {
        assignToTankB(
          "magnesiumSulfate",
          saltGramsForTargetPpm(magnesiumPpmEach, RAW_SALTS.magnesiumSulfate.mg, stockVolumeLiters, dilutionRatio)
        )
      }
      if (magnesiumNitrateEnabled) {
        magnesiumNitrateGrams = saltGramsForTargetPpm(
          magnesiumPpmEach,
          RAW_SALTS.magnesiumNitrate.mg,
          stockVolumeLiters,
          dilutionRatio
        )
      }
    }
  }
  const nitrogenFromMagnesiumNitrate = ppmFromSaltInStock(
    magnesiumNitrateGrams,
    RAW_SALTS.magnesiumNitrate.n,
    stockVolumeLiters,
    dilutionRatio
  )

  // MAP's Nitrogen contribution (if any) is folded into the Nitrogen target
  // before the remaining-Nitrogen math below runs — otherwise it would chase
  // the *full* Nitrogen target with another salt on top of what MAP already
  // provides, overshooting Nitrogen.
  const nitrogenFromMap = ppmFromSaltInStock(
    monoAmmoniumPhosphateGrams,
    RAW_SALTS.monoAmmoniumPhosphate.n,
    stockVolumeLiters,
    dilutionRatio
  )
  const nitrogenTargetAfterMap = Math.max(
    0,
    targets.nitrogen - nitrogenFromMap - nitrogenFromUrea - nitrogenFromMagnesiumNitrate
  )

  // Priority for the remaining N (after MAP's fixed contribution, if any):
  // KNO₃ → NH₄NO₃ → more Ca(NO₃)₂ alone → (NH₄)₂SO₄
  //
  // There is deliberately no "replicate a calcium ammonium nitrate double
  // salt by pairing Ca(NO₃)₂ with NH₄NO₃" step here. `RAW_SALTS.calciumNitrate`
  // already models the commercial 15.5-0-0 + 19% Ca grade, which *is* that
  // double salt (5 Ca(NO₃)₂·NH₄NO₃·10H₂O) and already carries its small
  // ammoniacal-N share. An earlier version split the whole Nitrogen target
  // 5:1 between the two salts to build that compound out of pure tetrahydrate
  // plus NH₄NO₃ — chemistry that stopped being true the moment the catalog
  // entry became the double salt itself, and which then bolted a second
  // helping of NH₄NO₃ onto a salt that already contains it. Total Nitrogen
  // still landed on the label (the split was of one target, not on top of
  // it), but the ammoniacal share ran several times higher than the real
  // product's and Calcium came up short, because grams that should have
  // carried Ca²⁺ were handed to a salt carrying none.
  //
  // So Calcium Nitrate alone now covers that chemistry. Ammonium Nitrate
  // stays available as an ordinary supplemental Nitrogen source below: it
  // picks up whatever Nitrogen the Calcium-driven Calcium Nitrate amount
  // leaves short, which is exactly "more ammoniacal N than the double salt
  // already supplies" and nothing more. There is no ammoniacal-N field on
  // `PartAnalysis` to size a second contribution against anyway.
  const remainingNitrogenPpm = Math.max(0, nitrogenTargetAfterMap - nitrogenFromCalciumNitrate)
  if (remainingNitrogenPpm > 0) {
    if (isEnabled("potassiumNitrate")) {
      assignToTankA(
        "potassiumNitrate",
        saltGramsForTargetPpm(remainingNitrogenPpm, RAW_SALTS.potassiumNitrate.n, stockVolumeLiters, dilutionRatio)
      )
    } else if (isEnabled("ammoniumNitrate")) {
      // Checked ahead of re-sizing Calcium Nitrate below: the grower
      // explicitly told us this part carries Ammonium Nitrate, and letting
      // it absorb the shortfall hits Nitrogen *without* pushing Calcium
      // past its own target, which inflating Calcium Nitrate would.
      assignToTankA(
        "ammoniumNitrate",
        saltGramsForTargetPpm(remainingNitrogenPpm, RAW_SALTS.ammoniumNitrate.n, stockVolumeLiters, dilutionRatio)
      )
    } else if (nitrateEnabled && !calciumNitrateSizedFromFeedRate) {
      // No dedicated nitrate-only salt and no Ammonium Nitrate is enabled —
      // re-size Calcium Nitrate off the full (MAP-adjusted) Nitrogen target
      // instead of its Calcium-only
      // share. This grams value is always ≥ the Calcium-based amount
      // above (it's solving for a requirement that's at least as large
      // on the same salt), so the Calcium target stays fully met — with,
      // when Carbonate and/or Chloride are also enabled, some
      // unavoidable Calcium overshoot on top of their own fixed shares
      // as the trade-off for hitting Nitrogen. This is exactly the
      // "generic Calcium Nitrate + a little Calcium Chloride" case:
      // Nitrate ends up sized for Nitrogen (its primary job here),
      // Chloride keeps its small top-up share untouched. Carbonate's and
      // Chloride's own allocations are untouched either way.
      //
      // Skipped when `calciumNitrateSizedFromFeedRate` is true: that
      // means the caller gave us Calcium Nitrate's own literal
      // feed-chart dose (see the Calcium-solving block above), so
      // overriding it here would silently replace a real,
      // physically-measured amount with a %-derived guess — exactly the
      // bug this whole feed-rate path exists to avoid. Any true
      // Nitrogen shortfall against the label's %N is left for the
      // ammonium salts (or reported as a gap) rather than papered over by
      // inflating Calcium Nitrate.
      calciumNitrateGrams = saltGramsForTargetPpm(
        nitrogenTargetAfterMap,
        RAW_SALTS.calciumNitrate.n,
        stockVolumeLiters,
        dilutionRatio
      )
    } else if (isEnabled("ammoniumSulfate")) {
      assignToTankB(
        "ammoniumSulfate",
        saltGramsForTargetPpm(remainingNitrogenPpm, RAW_SALTS.ammoniumSulfate.n, stockVolumeLiters, dilutionRatio)
      )
    } else if (!calciumNitrateSizedFromFeedRate) {
      warnings.push({ element: "nitrogen", label: "Nitrogen" })
    }
    // else: Calcium Nitrate was sized from its own explicit feed-chart
    // dose above and no other Nitrogen salt is enabled to close the rest
    // of the gap. Same as Calcium Chloride's fixed dose undershooting
    // its share of the Calcium target (see the Calcium-solving block) —
    // a real, physically-measured dose falling short of a %-derived
    // target is expected, not a "salt is unchecked" gap, so it isn't
    // warned on here.
  }

  assignToTankA("calciumNitrate", calciumNitrateGrams)
  // Urea is a neutral, non-ionic molecule with no precipitation conflicts —
  // it's grouped into Tank A alongside the other Nitrogen sources (Calcium
  // Nitrate, Potassium Nitrate, Ammonium Nitrate) rather than for any
  // chemistry-driven reason. See the `TANK_A_SALTS` doc comment.
  assignToTankA("urea", ureaGrams)
  // Calcium Chloride is soluble at stock-tank strength, so — unlike Calcium
  // Carbonate — it's assigned straight into Tank A alongside Calcium Nitrate
  // rather than surfaced as a direct reservoir addition.
  assignToTankA("calciumChloride", calciumChlorideGrams)
  // Magnesium Nitrate lives in Tank A, not alongside Magnesium Sulfate in
  // Tank B — see the `TANK_A_SALTS` doc comment for why. Sized above,
  // alongside Urea and MAP, so its Nitrogen could be subtracted from the
  // remaining-Nitrogen target before this point.
  assignToTankA("magnesiumNitrate", magnesiumNitrateGrams)
  // Calcium Carbonate deliberately does NOT go into tankA (see the function
  // doc comment) — it's surfaced separately below as a reservoir addition,
  // after the refinement pass has had its say on the Calcium budget.

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

  // Potassium is treated differently from every other elemental target:
  // instead of warning the grower to "check more salts" when the currently
  // checked salts (KNO₃, MKP) don't fully cover it, we fall back to
  // Potassium Sulfate automatically. K₂SO₄ is a cheap, universally
  // available salt with no downside side-effect (no extra Nitrogen or
  // Phosphorus riding along, unlike KNO₃/MKP), so there's no real reason to
  // ever leave a Potassium target unmet and hand the grower a confusing
  // "your recipe is only approximate, go check more boxes" message instead
  // of just completing the recipe for them. Salts the user DID check are
  // still tried first — see `potassiumFromMkp`/`potassiumFromPotassiumNitrate`
  // above — this only fills whatever gap those leave behind.
  //
  // When Potassium Sulfate IS checked this is only a starting amount: the
  // refinement pass below is free to resize it (and, unlike this gap-filling
  // step, to reach for it when Potassium is already over-supplied but Sulfur
  // is short — the case that used to leave a checked K₂SO₄ out of the recipe
  // entirely). When it ISN'T checked it stays a pure Potassium fallback: the
  // amount is recomputed from the refined recipe further down and the
  // grower is told about it, so an unchecked salt is never quietly enlisted
  // to chase some other element.
  if (remainingPotassiumPpm > 0) {
    assignToTankB(
      "potassiumSulfate",
      saltGramsForTargetPpm(remainingPotassiumPpm, RAW_SALTS.potassiumSulfate.k, stockVolumeLiters, dilutionRatio)
    )
  }

  // Sulfur needs no dedicated sizing step of its own: it always arrives as a
  // byproduct of MgSO₄ / K₂SO₄ / (NH₄)₂SO₄, and the refinement pass below
  // balances how much of each of those the recipe uses against the Sulfur
  // target alongside every other element — rather than chasing Sulfur with an
  // extra salt here and overshooting Potassium or Nitrogen to get it.

  // Micronutrients — always available; chelated forms (EDTA) are used by
  // default rather than sulfate salts, since the "Chelated Micronutrients"
  // selection these are gated behind (see `SALT_CHECKBOX_OPTIONS`) is meant
  // to represent real chelate-based product lines. See `RAW_SALTS`.
  assignToTankB(
    "manganeseEDTA",
    saltGramsForTargetPpm(targets.manganese, RAW_SALTS.manganeseEDTA.mn, stockVolumeLiters, dilutionRatio)
  )

  assignToTankB(
    "zincEDTA",
    saltGramsForTargetPpm(targets.zinc, RAW_SALTS.zincEDTA.zn, stockVolumeLiters, dilutionRatio)
  )

  assignToTankB(
    "boricAcid",
    saltGramsForTargetPpm(targets.boron, RAW_SALTS.boricAcid.b, stockVolumeLiters, dilutionRatio)
  )

  assignToTankB(
    "copperEDTA",
    saltGramsForTargetPpm(targets.copper, RAW_SALTS.copperEDTA.cu, stockVolumeLiters, dilutionRatio)
  )

  assignToTankB(
    "sodiumMolybdate",
    saltGramsForTargetPpm(targets.molybdenum, RAW_SALTS.sodiumMolybdate.mo, stockVolumeLiters, dilutionRatio)
  )

  // Everything above sizes one element at a time. Rebalance the whole set so
  // the recipe actually delivers the targets as closely as the enabled salts
  // allow — see `refineSaltAmountsToTargets` for why the sequential pass alone
  // can't, and for which amounts are held fixed rather than fitted.
  //
  // Calcium Carbonate is refined alongside everything else even though it
  // never lands in a tank: its Calcium still dissolves into the reservoir, so
  // leaving it out would have the fit chase Calcium that the recipe is already
  // delivering. It's split back out into `directAddCalciumCarbonate` after.
  const resolved = emptySaltAmounts()
  for (const key of SALT_DISPLAY_ORDER) resolved[key] = tankA[key] + tankB[key]
  resolved.calciumCarbonate = calciumCarbonateGrams

  // A salt the grower didn't check is only ever reached for to complete
  // Potassium (see the fallback above), never fitted — so it's kept out of the
  // refinement and re-derived from the refined recipe below.
  const potassiumSulfateIsFallback = !isEnabled("potassiumSulfate")
  if (potassiumSulfateIsFallback) resolved.potassiumSulfate = 0

  refineSaltAmountsToTargets(
    resolved,
    buildRefinementVariables({ isEnabled, calciumNitrateSizedFromFeedRate }),
    targets,
    stockVolumeLiters,
    dilutionRatio
  )

  if (potassiumSulfateIsFallback) {
    const potassiumGapPpm = Math.max(
      0,
      targets.potassium - elementalPpmFromSaltAmounts(resolved, stockVolumeLiters, dilutionRatio).potassium
    )
    resolved.potassiumSulfate = saltGramsForTargetPpm(
      potassiumGapPpm,
      RAW_SALTS.potassiumSulfate.k,
      stockVolumeLiters,
      dilutionRatio
    )
    if (resolved.potassiumSulfate > 0) {
      autoAddedSalts.push({
        element: "potassium",
        elementLabel: "Potassium",
        saltKey: "potassiumSulfate",
        saltLabel: RAW_SALTS.potassiumSulfate.name,
      })
    }
  }

  for (const key of TANK_A_SALTS) tankA[key] = resolved[key]
  for (const key of TANK_B_SALTS) tankB[key] = resolved[key]
  // Calcium Carbonate belongs to neither tank (see the function doc comment).
  tankA.calciumCarbonate = 0
  const refinedDirectAddCalciumCarbonate = buildDirectAddCalciumCarbonate(
    resolved.calciumCarbonate,
    stockVolumeLiters,
    dilutionRatio
  )

  const delivered = elementalPpmFromSaltAmounts(resolved, stockVolumeLiters, dilutionRatio)
  // Sulfur is exempt: an undeclared Sulfur target (0) isn't a real target the
  // recipe failed to hit — see `refineSaltAmountsToTargets` /
  // `saltDerivedSulfurPpm`.
  const deviations: TargetDeviation[] = REFINED_ELEMENTS.filter((element) => {
    if (element === "sulfur" && targets.sulfur <= 0) return false
    return !isWithinMatchTolerance(element, delivered[element], targets[element])
  }).map((element) => ({
    element,
    label: ELEMENT_LABELS[element],
    targetPpm: targets[element],
    deliveredPpm: delivered[element],
  }))

  return {
    tankA,
    tankB,
    warnings,
    isApproximate: warnings.length > 0 || deviations.length > 0,
    directAddCalciumCarbonate: refinedDirectAddCalciumCarbonate,
    autoAddedSalts,
    delivered,
    deviations,
  }
}

/**
 * Which salt amounts the refinement is allowed to adjust.
 *
 * Every enabled macro salt is included — including ones the sequential pass
 * left at zero, which is what lets a checked salt be used whenever it improves
 * the match instead of only when an earlier sizing step happened to leave a
 * gap behind.
 *
 * Deliberately excluded:
 *
 *  - Urea, and any salt sized from a literal feed-chart dose. These are real
 *    measured amounts the grower declared, not quantities derived from a ppm
 *    target — refitting them would replace known facts with a guess (see
 *    `gramsFromFeedRatePerGallon`).
 *  - Calcium Chloride and Calcium Carbonate. Their amounts come from
 *    deliberate product-modeling policy rather than from solving a target —
 *    Chloride's small fixed top-up share, Carbonate's guaranteed equal share
 *    of the Calcium budget (see the Calcium-solving block). Both exist to
 *    model how real lines are built, so the fit works around them rather than
 *    reallocating Calcium away from them.
 *  - Micronutrient salts. Each is the sole source of its own element and
 *    supplies nothing else, so they're already exact.
 *
 * Every variable here is a single salt. Calcium Nitrate and Ammonium Nitrate
 * used to be tied together as one variable to hold a 5:1 double-salt ratio;
 * `RAW_SALTS.calciumNitrate` now models that double salt on its own, so the
 * two are independent again — Ammonium Nitrate is a supplemental Nitrogen
 * source the fit may size freely (see the Nitrogen-solving block).
 */
function buildRefinementVariables({
  isEnabled,
  calciumNitrateSizedFromFeedRate,
}: {
  isEnabled: (key: SaltKey) => boolean
  calciumNitrateSizedFromFeedRate: boolean
}): RefinementVariable[] {
  const variables: RefinementVariable[] = []
  const single = (saltKey: SaltKey) => variables.push({ components: [{ saltKey, gramsPerUnit: 1 }] })

  if (isEnabled("calciumNitrate") && !calciumNitrateSizedFromFeedRate) single("calciumNitrate")
  if (isEnabled("ammoniumNitrate")) single("ammoniumNitrate")

  for (const saltKey of [
    "potassiumNitrate",
    "monoPotassiumPhosphate",
    "monoAmmoniumPhosphate",
    "magnesiumSulfate",
    "magnesiumNitrate",
    "potassiumSulfate",
    "ammoniumSulfate",
  ] as const) {
    if (isEnabled(saltKey)) single(saltKey)
  }

  return variables
}

/**
 * The Tank-A-side salts (see `TANK_A_SALTS`) that still belong on the
 * Separate Nitrogen layout's non-Calcium side: they carry no Calcium, so
 * there's nothing to keep out of the phosphate/sulfate tank, and nothing to
 * keep beside the Calcium.
 *
 * Ammonium Nitrate is always one of them: it is a supplemental Nitrogen source
 * in its own right now that Calcium Nitrate models the whole double salt, so
 * there is no longer a case where part of it belongs with the Calcium.
 */
const TANK_A_KEYS_ON_NON_CALCIUM_SIDE = new Set<SaltKey>([
  "potassiumNitrate",
  "ammoniumNitrate",
  "magnesiumNitrate",
  "urea",
])

/**
 * Fold one solved A/B pair's Calcium salts into the shared Calcium tank,
 * adding to whatever it already holds.
 *
 * Accumulating rather than assigning is what lets the multi-part layout below
 * pour every part's Calcium into a single tank — which is the point of this
 * layout: one tank holding the ion that can't sit beside concentrated
 * phosphate or sulfate, and one tank to reach for when Calcium needs to move.
 */
function addCalciumSalts(target: SaltAmounts, recipe: TankRecipe): void {
  for (const key of TANK_1_SALTS) {
    target[key] += recipe.tankA[key]
  }
}

/**
 * Fold one solved A/B pair's non-Calcium MACRO salts into `target`, adding to
 * whatever it already holds.
 *
 * Which side of the A/B pair each salt is read from is pure precipitation
 * chemistry (see `TANK_1_SALTS` / `TANK_2_SALTS`). Whether `target` is one
 * merged tank or a single part's own tank is the caller's choice, and doesn't
 * move a gram either way — the grams were fixed by the solve that produced
 * `recipe`.
 *
 * Micronutrients are deliberately not included; they're collected separately by
 * `addMicronutrientSalts` so they can be steered to whichever tank is clear of
 * the Nitrogen a grower tapers (see `placeMicronutrients`).
 */
function addNonCalciumMacroSalts(target: SaltAmounts, recipe: TankRecipe): void {
  const { tankA, tankB } = recipe

  for (const key of TANK_2_SALTS) {
    target[key] += TANK_A_KEYS_ON_NON_CALCIUM_SIDE.has(key) ? tankA[key] : tankB[key]
  }
}

/** Fold one solved A/B pair's micronutrient salts into `target`. */
function addMicronutrientSalts(target: SaltAmounts, recipe: TankRecipe): void {
  for (const key of TANK_3_SALTS) {
    target[key] += key === "ironDTPA" ? recipe.tankA[key] : recipe.tankB[key]
  }
}

interface SeparateNitrogenTankDraft {
  role: SeparateNitrogenTankRole
  salts: SaltAmounts
  partName?: string
  partId?: string
}

/**
 * Turn drafted tanks into the numbered, grower-facing list, dropping any that
 * came out empty.
 *
 * Numbering follows the tanks that survive rather than the drafts that went in,
 * so a part holding nothing but Calcium Nitrate — its non-Calcium draft empty —
 * doesn't leave a blank card or a gap in the numbering behind. Callers pass the
 * Calcium draft first, which is what makes it Tank 1 whenever the recipe uses
 * any Calcium at all.
 */
function buildSeparateNitrogenTanks(drafts: SeparateNitrogenTankDraft[]): SeparateNitrogenTank[] {
  return drafts
    .filter((draft) => saltAmountsHasContent(draft.salts))
    .map((draft, position) => {
      const index = position + 1
      return {
        index,
        name: `Tank ${index}`,
        role: draft.role,
        partName: draft.partName,
        partId: draft.partId,
        salts: draft.salts,
        hasMicronutrients: TANK_3_SALTS.some((key) => draft.salts[key] > 0),
      }
    })
}

/**
 * Pour the micronutrient package into whichever drafted tank can hold it
 * without ending up on the wrong end of a Nitrogen taper. Mutates that draft's
 * salts; adds no tank of its own.
 *
 * A micros-only stock tank is never the answer. It's an extra tank to mix and
 * label for a handful of grams, and it isn't a product a grower has any
 * counterpart for — every commercial line ships its chelates inside a bottle
 * that carries macros too. So the package always rides along with something,
 * and the only question is what.
 *
 * The thing to avoid is a tank the grower will dial back to move Nitrogen: every
 * gram in it comes down by the same fraction, so tapering Nitrogen would quietly
 * cut Iron, Manganese, Zinc, Boron, Copper and Molybdenum at the point in flower
 * a plant can least afford it. In order of preference:
 *
 *  1. A macro tank carrying no Nitrogen at all — the MKP/MgSO₄/K₂SO₄ end of the
 *     recipe. Nothing about a taper reaches it, and micros beside Nitrogen-free
 *     macros is exactly where a grower expects to find them. Preference within
 *     that goes to the part that supplied the package, keeping the tank as close
 *     to the bottle it stands for as it can be.
 *  2. The Calcium tank, as long as no taperable Nitrogen sits in it. Its
 *     Ca(NO₃)₂ does carry Nitrogen, but that tank is the one held steady while
 *     the others come down — cutting it means giving up Calcium, which is the
 *     move this whole layout exists to let the grower avoid. Chemically it's a
 *     conventional Tank A: chelates beside concentrated Calcium Nitrate is how
 *     every two-part line is mixed.
 *  3. A macro tank whose only Nitrogen is untaperable — a MAP phosphate booster,
 *     say. Nobody cuts their P bottle to move Nitrogen (see
 *     `TAPERABLE_NITROGEN_SALTS`).
 *  4. Failing all that, the Calcium tank regardless, then any macro tank at all.
 *     Reaching here needs every tank in the recipe to hold taperable Nitrogen,
 *     and even then riding along beats a tank of their own.
 */
function placeMicronutrients(
  calciumDraft: SeparateNitrogenTankDraft,
  macroDrafts: SeparateNitrogenTankDraft[],
  micros: SaltAmounts,
  preferredHostPartId?: string
): void {
  if (!saltAmountsHasContent(micros)) return

  // An empty draft never becomes a tank (see `buildSeparateNitrogenTanks`), so
  // pouring the micros into one would conjure up the micros-only tank this
  // function exists to avoid. The Calcium draft comes back empty on an
  // all-Carbonate line, where the Calcium is a direct reservoir addition.
  const macroHosts = macroDrafts.filter((draft) => saltAmountsHasContent(draft.salts))
  const calciumHost = saltAmountsHasContent(calciumDraft.salts) ? calciumDraft : undefined

  const preferred = (drafts: SeparateNitrogenTankDraft[]) =>
    (preferredHostPartId === undefined
      ? undefined
      : drafts.find((draft) => draft.partId === preferredHostPartId)) ?? drafts[0]

  const host =
    preferred(macroHosts.filter((draft) => !saltAmountsCarryNitrogen(draft.salts))) ??
    (calciumHost && !saltAmountsCarryTaperableNitrogen(calciumHost.salts)
      ? calciumHost
      : undefined) ??
    preferred(macroHosts.filter((draft) => !saltAmountsCarryTaperableNitrogen(draft.salts))) ??
    calciumHost ??
    preferred(macroHosts) ??
    // Nothing but micros in the entire recipe — a label declaring micros and no
    // macros at all. They take the one tank there is to take.
    macroDrafts[0] ??
    calciumDraft

  addSaltAmounts(host.salts, micros)
}

/**
 * Build a two-tank stock recipe with Calcium isolated, so Nitrogen can be
 * moved at the end of flower without rebalancing anything else.
 *
 *   Tank 1 — the Calcium source (Ca²⁺, plus the Nitrogen that rides along
 *            inside Calcium Nitrate itself, since `RAW_SALTS.calciumNitrate`
 *            models the commercial double salt). Ammonium Nitrate is a
 *            supplemental Nitrogen source rather than half of that product, so
 *            it goes to Tank 2 with the other Calcium-free Nitrogen salts.
 *   Tank 2 — The remaining macro salts (KNO₃, MKP/MAP, MgSO₄, K₂SO₄) merged into
 *            one tank. This is the taper tank: its Nitrogen is what comes down
 *            at the end of flower.
 *
 * The micronutrients (Fe-DTPA, Mn/Zn/Cu-EDTA chelates, boric acid, sodium
 * molybdate) join whichever of those two is out of the taper's way rather than
 * taking a third tank: Tank 2 when the pooled macros turn out Nitrogen-free,
 * Tank 1 otherwise, which is the conventional Tank A arrangement anyway (see
 * `placeMicronutrients`).
 *
 * Calcium Carbonate, if enabled, never lands in Tank 1 (or anywhere else) —
 * see `calculateStockTankRecipe` — and comes back as `directAddCalciumCarbonate`
 * instead.
 *
 * `targets` here is ONE set of elemental targets, solved in a single pass —
 * so for a multi-part line it's the parts pooled together, drawing on the
 * union of their salt selections. Merging the non-Calcium macros into a single
 * Tank 2 costs nothing once that's happened: the parts have already lost their
 * separate identities by the time the tanks are filled. That's why this path
 * is only used for one- and two-part lines; from three parts up,
 * `calculateSeparateNitrogenMultiPartRecipe` solves each part on its own and
 * keeps one tank per part (see
 * `SEPARATE_NITROGEN_PER_PART_SOLVE_MIN_PARTS`).
 */
export function calculateSeparateCalciumRecipe(
  targets: ElementalTargets,
  stockVolumeLiters: number,
  dilutionRatio: number,
  includedSalts?: IncludedSaltsSelection,
  calciumChlorideGramsPerGallon: number = 0,
  calciumNitrateGramsPerGallon: number = 0,
  ureaNitrogenPpm: number = 0
): SeparateNitrogenRecipe {
  const recipe = calculateStockTankRecipe(
    targets,
    stockVolumeLiters,
    dilutionRatio,
    includedSalts,
    calciumChlorideGramsPerGallon,
    calciumNitrateGramsPerGallon,
    ureaNitrogenPpm
  )
  const {
    warnings = [],
    isApproximate = false,
    directAddCalciumCarbonate,
    autoAddedSalts = [],
    delivered,
    deviations,
  } = recipe

  const calciumDraft: SeparateNitrogenTankDraft = { role: "calcium", salts: emptySaltAmounts() }
  const macroDraft: SeparateNitrogenTankDraft = { role: "non-calcium", salts: emptySaltAmounts() }
  const micros = emptySaltAmounts()
  addCalciumSalts(calciumDraft.salts, recipe)
  addNonCalciumMacroSalts(macroDraft.salts, recipe)
  addMicronutrientSalts(micros, recipe)

  // One pooled solve means every salt already sits in exactly one place, so
  // there's no Nitrogen to gather here the way there is across per-part solves
  // (see `consolidateTaperableNitrogen`).
  placeMicronutrients(calciumDraft, [macroDraft], micros)

  return {
    tanks: buildSeparateNitrogenTanks([calciumDraft, macroDraft]),
    warnings,
    isApproximate,
    directAddCalciumCarbonate,
    autoAddedSalts,
    delivered,
    deviations,
  }
}

/**
 * A part's literal Calcium Nitrate feed-chart dose, for passing straight
 * through to `calculateStockTankRecipe`'s `calciumNitrateGramsPerGallon`
 * param — but ONLY when that's actually meaningful: the part must carry an
 * explicit, non-zero Calcium Chloride top-up dose (the pairing this
 * literal-dose treatment exists for — see the Calcium-solving block in
 * `calculateStockTankRecipe`), and Calcium Nitrate must be that part's sole
 * macro salt (see `isCalciumNitrateSoleDoseSource`) so the part's overall
 * dose can be safely attributed to Calcium Nitrate alone. Returns 0
 * (falling back to the existing ppm-target-derived sizing) otherwise.
 */
function calciumNitrateGramsPerGallonForPart(analysis: PartAnalysis, feedingPart: NutrientPart): number {
  if (!analysis.includedSalts?.calciumChloride) return 0
  if (parsePositive(analysis.calciumChlorideGramsPerGallon) === 0) return 0
  if (!isCalciumNitrateSoleDoseSource(analysis.includedSalts)) return 0
  return getDoseGramsPerGallon(feedingPart)
}

function combineSaltAmounts(a: SaltAmounts, b: SaltAmounts): SaltAmounts {
  const combined = emptySaltAmounts()
  for (const key of SALT_DISPLAY_ORDER) {
    combined[key] = a[key] + b[key]
  }
  return combined
}

function addSaltAmounts(target: SaltAmounts, addition: SaltAmounts): void {
  for (const key of SALT_DISPLAY_ORDER) {
    target[key] += addition[key]
  }
}

function addElementalPpm(total: ElementalTargets, addition: ElementalTargets): void {
  for (const key of Object.keys(total) as Array<keyof ElementalTargets>) {
    total[key] += addition[key]
  }
}

/**
 * Deviations for the per-part layouts. Each part's tank is solved against that
 * part's own label, so the grower-facing question is whether the parts *added
 * together* reproduce the combined targets — accumulate both sides across
 * parts and compare once, rather than reporting the same element several times
 * over with one part's slice of it each.
 */
function deviationsFromTotals(
  targets: ElementalTargets,
  delivered: ElementalTargets
): TargetDeviation[] {
  return REFINED_ELEMENTS.filter((element) => {
    if (element === "sulfur" && targets.sulfur <= 0) return false
    return !isWithinMatchTolerance(element, delivered[element], targets[element])
  }).map((element) => ({
    element,
    label: ELEMENT_LABELS[element],
    targetPpm: targets[element],
    deliveredPpm: delivered[element],
  }))
}

function saltAmountsHasContent(salts: SaltAmounts): boolean {
  return SALT_DISPLAY_ORDER.some((key) => salts[key] > 0)
}

/**
 * Everything a layout built from per-part solves reports the same way, no
 * matter how it arranges the resulting salts into physical tanks.
 */
interface PerPartSolveTotals {
  warnings: SaltGapWarning[]
  autoAddedSalts: SaltAutoAddNote[]
  directAddCalciumCarbonate?: DirectAddCalciumCarbonate
  /** Every solved part's own label-derived targets, summed */
  targets: ElementalTargets
  delivered: ElementalTargets
  deviations: TargetDeviation[]
}

/**
 * Solve each dosed part on its own — the shared core of every layout that
 * keeps a part's label, dose and checked salts to itself: the per-part tanks,
 * the doser variant of them, and the Separate Nitrogen layout from three
 * parts up.
 *
 * A part is solved strictly against its own guaranteed analysis and its own
 * `includedSalts`, which is what keeps these layouts faithful to the original
 * product: a part that only lists Calcium Nitrate on its label can never end
 * up with Potassium Nitrate or MKP in its tank, even if those salts are
 * checked on a different part.
 *
 * `onPartSolved` decides where that part's salts physically go; the totals
 * every layout reports identically — warnings, auto-added salts, direct-add
 * Calcium Carbonate, and the combined target/delivered ppm — are accumulated
 * here so the layouts can't drift apart on them. Note the accumulation
 * happens for every solved part, including one whose salts don't end up in a
 * tank at all (a part whose only Calcium source is Carbonate, which is always
 * a direct reservoir addition), since its nutrients still reach the
 * reservoir.
 */
function solveEachPartIndependently(
  partsAnalysis: PartAnalysis[],
  parts: NutrientPart[],
  stockVolumeLiters: number,
  dilutionRatio: number,
  onPartSolved: (feedingPart: NutrientPart, recipe: TankRecipe) => void
): PerPartSolveTotals {
  const analysisById = new Map(partsAnalysis.map((part) => [part.id, part]))
  const warningsByElement = new Map<string, SaltGapWarning>()
  const autoAddedByElement = new Map<string, SaltAutoAddNote>()
  const defaultMicroProfilePartId = pickDefaultMicroProfilePartId(partsAnalysis, parts)
  const combinedTargets = emptyElementalTargets()
  const delivered = emptyElementalTargets()
  let directAddCalciumCarbonate: DirectAddCalciumCarbonate | undefined

  for (const feedingPart of parts) {
    if (parsePositive(feedingPart.dose) === 0) continue
    const analysis = analysisById.get(feedingPart.id)
    if (!analysis) continue

    const rawTargets = calculateElementalTargets([analysis], [feedingPart])
    const hasAnyElement = Object.values(rawTargets).some((value) => value > 0)
    if (!hasAnyElement) continue

    const { targets } = applyMicroEstimates(rawTargets, {
      allowDefaultProfile: feedingPart.id === defaultMicroProfilePartId,
    })
    const recipe = calculateStockTankRecipe(
      targets,
      stockVolumeLiters,
      dilutionRatio,
      analysis.includedSalts,
      parsePositive(analysis.calciumChlorideGramsPerGallon),
      calciumNitrateGramsPerGallonForPart(analysis, feedingPart),
      ureaNitrogenPpmForPart(feedingPart, analysis)
    )

    for (const warning of recipe.warnings ?? []) warningsByElement.set(warning.element, warning)
    for (const note of recipe.autoAddedSalts ?? []) autoAddedByElement.set(note.element, note)
    directAddCalciumCarbonate = combineDirectAddCalciumCarbonate(
      directAddCalciumCarbonate,
      recipe.directAddCalciumCarbonate
    )
    addElementalPpm(combinedTargets, targets)
    addElementalPpm(delivered, recipe.delivered)

    onPartSolved(feedingPart, recipe)
  }

  return {
    warnings: Array.from(warningsByElement.values()),
    autoAddedSalts: Array.from(autoAddedByElement.values()),
    directAddCalciumCarbonate,
    targets: combinedTargets,
    delivered,
    deviations: deviationsFromTotals(combinedTargets, delivered),
  }
}

/**
 * One stock tank per nutrient part the user entered. Each part's guaranteed
 * analysis and feed rate drive the salts in that tank — mirroring how
 * commercial multi-part lines are bottled. See `solveEachPartIndependently`
 * for how each part is solved in isolation.
 */
export function calculateMultiPartStockTankRecipe(
  partsAnalysis: PartAnalysis[],
  parts: NutrientPart[],
  stockVolumeLiters: number,
  dilutionRatio: number
): MultiPartTankRecipe {
  const tanks: PartStockTank[] = []

  const totals = solveEachPartIndependently(
    partsAnalysis,
    parts,
    stockVolumeLiters,
    dilutionRatio,
    (feedingPart, recipe) => {
      // Calcium Carbonate never lands in a part's tank (it comes back as
      // `directAddCalciumCarbonate` instead), so a part whose only Calcium
      // source is Carbonate legitimately has nothing left to weigh into a
      // physical tank here — skip creating one for it.
      const salts = combineSaltAmounts(recipe.tankA, recipe.tankB)
      if (!saltAmountsHasContent(salts)) return

      const index = tanks.length + 1
      tanks.push({
        index,
        name: `Tank ${index}`,
        partName: feedingPart.name,
        partId: feedingPart.id,
        salts,
      })
    }
  )

  return {
    tanks,
    warnings: totals.warnings,
    isApproximate: totals.warnings.length > 0 || totals.deviations.length > 0,
    directAddCalciumCarbonate: totals.directAddCalciumCarbonate,
    autoAddedSalts: totals.autoAddedSalts,
    delivered: totals.delivered,
    deviations: totals.deviations,
  }
}

/**
 * One solved part, split three ways but not yet assigned a tank: its Calcium,
 * its other macro salts, and its share of the micronutrient package. Micros are
 * held apart from `macros` from the start because where they end up is decided
 * by the taper rule rather than by which bottle they came from (see
 * `placeMicronutrients`).
 */
interface PartCalciumSplit {
  feedingPart: NutrientPart
  calcium: SaltAmounts
  macros: SaltAmounts
  micros: SaltAmounts
}

function calciumGrams(salts: SaltAmounts): number {
  return TANK_1_SALTS.reduce((total, key) => total + salts[key], 0)
}

/** True when `salts` can sit beside concentrated Calcium — see `CALCIUM_INCOMPATIBLE_SALTS`. */
function isSafeBesideCalcium(salts: SaltAmounts): boolean {
  return !CALCIUM_INCOMPATIBLE_SALTS.some((key) => salts[key] > 0)
}

/**
 * Which part's tank becomes the Calcium tank — the bottle whose Calcium the
 * rest of the line's Calcium joins, rather than a fresh tank added beside them
 * all.
 *
 * Only a bottle whose own remaining MACRO salts are safe beside Calcium can
 * host (`isSafeBesideCalcium`); among those, the one contributing the most
 * Calcium wins, because that's the line's Calcium bottle — a Cal-Mag topping up
 * a base's Calcium should pour into the base, not the other way round.
 *
 * Micronutrients play no part in the choice. Where the package ends up is
 * decided afterwards on taper grounds rather than on which bottle declared it
 * (see `placeMicronutrients`), so a Calcium bottle carrying the line's micros
 * can still host — its macros go in beside the pooled Calcium either way, and
 * its micros may or may not follow.
 *
 * Returns `undefined` when nothing can host, which is either of two things.
 * Usually it's an all-Carbonate line with no Calcium in a tank at all, since
 * Carbonate is a direct reservoir addition (see `calculateStockTankRecipe`).
 * Otherwise it's the one line shape that genuinely can't be compressed: a
 * Calcium bottle that declares sulfate or phosphate as well, so its Calcium
 * can't share a tank with its own leftovers. The Calcium then keeps a tank of
 * its own and that bottle keeps its remainder — which does cost a tank, but no
 * arrangement saves it without either pouring sulfate onto Calcium or merging
 * two of the grower's bottles together.
 */
function pickCalciumHost(splits: PartCalciumSplit[]): PartCalciumSplit | undefined {
  const candidates = splits.filter(
    (split) => calciumGrams(split.calcium) > 0 && isSafeBesideCalcium(split.macros)
  )
  if (candidates.length === 0) return undefined

  return candidates.reduce((best, split) =>
    calciumGrams(split.calcium) > calciumGrams(best.calcium) ? split : best
  )
}

/**
 * Gather each taperable Nitrogen salt (see `TAPERABLE_NITROGEN_SALTS`) into a
 * single part's tank, so the grower has one amount to turn down instead of the
 * same salt spread over two tanks that have to be cut in step.
 *
 * Solving every part on its own is what leaves the same salt in several places:
 * a Ca(NO₃)₂/KNO₃ base and a P/K bottle that also lists KNO₃ each get their own
 * share, and hosting the Calcium then pulls one of those shares into the Calcium
 * tank — the tank this mode exists to hold steady. That split was never a
 * chemical requirement, only a side effect of where the grams were solved, and
 * it leaves a grower tapering Nitrogen chasing it across tanks.
 *
 * Two conditions keep the move safe:
 *
 *  - The destination already holds some of that salt. So no new pair of salts
 *    is ever created, and nothing can precipitate that wasn't already
 *    coexisting — and the tank stays buildable from its own part's label, since
 *    that part clearly declared the salt. It's also why Mg(NO₃)₂ can't drift
 *    into a phosphate bottle here: a tank that never had any won't take any.
 *  - The combined amount still dissolves in one tank at the recipe's own stock
 *    volume, at the same margin the solubility report holds every tank to (see
 *    `saltFitsOneTank`). When it doesn't, the split stands as-is — that's a real
 *    physical limit rather than a layout choice.
 *
 * The Calcium host is never the destination, for the same reason the split is
 * worth undoing at all: Nitrogen the grower means to taper doesn't belong in
 * the Calcium tank. When the host is the *only* part holding the salt there's
 * nothing to gather and it stays where the solve put it.
 *
 * Mutates each split's `macros` in place.
 */
function consolidateTaperableNitrogen(
  splits: PartCalciumSplit[],
  calciumHost: PartCalciumSplit | undefined,
  stockVolumeLiters: number
): void {
  for (const saltKey of TAPERABLE_NITROGEN_SALTS) {
    const holders = splits.filter((split) => split.macros[saltKey] > 0)
    if (holders.length < 2) continue

    const destination = holders
      .filter((split) => split !== calciumHost)
      .reduce<PartCalciumSplit | undefined>(
        (best, split) => (best && best.macros[saltKey] >= split.macros[saltKey] ? best : split),
        undefined
      )
    if (!destination) continue

    const total = holders.reduce((grams, split) => grams + split.macros[saltKey], 0)
    if (!saltFitsOneTank(saltKey, total, stockVolumeLiters)) continue

    for (const split of holders) split.macros[saltKey] = 0
    destination.macros[saltKey] = total
  }
}

/**
 * The part that supplied most of the micronutrient package, by weight — the
 * bottle the micros have the strongest claim to belong to, and so the first
 * choice of home when one is available (see `placeMicronutrients`).
 */
function microPackageOwnerPartId(splits: PartCalciumSplit[]): string | undefined {
  let owner: PartCalciumSplit | undefined
  let mostGrams = 0

  for (const split of splits) {
    const grams = TANK_3_SALTS.reduce((total, key) => total + split.micros[key], 0)
    if (grams > mostGrams) {
      mostGrams = grams
      owner = split
    }
  }

  return owner?.feedingPart.id
}

/**
 * The Separate Nitrogen layout for a multi-part line: every part's Calcium
 * pooled into the line's own Calcium bottle, and every other part left in a
 * tank of its own.
 *
 * Every part is solved on its own against its own label, dose and checked
 * salts (see `solveEachPartIndependently`), so the grams here are the same ones
 * the per-part tanks would call for. What this layout changes is only where
 * those grams are stored, and it changes as little as it can: the Calcium moves
 * out of the other bottles and nothing else moves at all.
 *
 * Crucially it moves Calcium *into an existing tank* rather than into a new
 * one. Giving the pooled Calcium a tank of its own and then still giving every
 * part a tank for its leftovers costs a three-part line a fourth tank — and
 * that fourth tank is the thinnest one, since the bottle the Calcium came out
 * of is mostly Calcium to begin with. The grower ends up weighing the same
 * salts into two tanks apiece for no gain, when what they asked for was their
 * three-part line back. Hosting the Calcium in the bottle it mostly came from
 * (see `pickCalciumHost`) keeps the tank count at or below the number of parts,
 * and empty leftovers drop out entirely (see `buildSeparateNitrogenTanks`). The
 * only line that still costs an extra tank is one whose Calcium bottle declares
 * sulfate or phosphate too, where no bottle can host — see `pickCalciumHost`
 * for why nothing better exists there.
 *
 * Two things then move on top of the Calcium, both in service of the tapering
 * this layout is chosen for, and neither adding a tank:
 *
 *  - Each taperable Nitrogen salt is gathered into one tank rather than left
 *    wherever the per-part solves happened to put it, so there's a single
 *    amount to turn down (see `consolidateTaperableNitrogen`). This is usually
 *    what empties the Calcium bottle's leftovers out entirely, since a base
 *    bottle's non-Calcium remainder is typically just its KNO₃.
 *  - The micronutrients go to whichever tank a Nitrogen taper won't reach —
 *    normally the line's Nitrogen-free macro bottle, and the Calcium tank when
 *    there isn't one (see `placeMicronutrients`).
 *
 * Pooling several parts' Calcium into one tank stays safe because the split is
 * chemical, not per-bottle: nothing phosphate- or sulfate-bearing is ever
 * folded in beside it (see `CALCIUM_INCOMPATIBLE_SALTS`), which is also why the
 * host's own leftover macros can go back in — nitrates, Urea and chelated
 * micronutrients are what sits beside Calcium Nitrate in any conventional
 * Tank A. And it's what makes the layout worth choosing: Calcium Nitrate's
 * Nitrogen is confined to that one tank, so the Nitrogen in every other tank
 * can be cut back at the end of flower without touching the Calcium supply.
 */
export function calculateSeparateNitrogenMultiPartRecipe(
  partsAnalysis: PartAnalysis[],
  parts: NutrientPart[],
  stockVolumeLiters: number,
  dilutionRatio: number
): SeparateNitrogenRecipe {
  const splits: PartCalciumSplit[] = []

  const totals = solveEachPartIndependently(
    partsAnalysis,
    parts,
    stockVolumeLiters,
    dilutionRatio,
    (feedingPart, recipe) => {
      const calcium = emptySaltAmounts()
      const macros = emptySaltAmounts()
      const micros = emptySaltAmounts()
      addCalciumSalts(calcium, recipe)
      addNonCalciumMacroSalts(macros, recipe)
      addMicronutrientSalts(micros, recipe)
      splits.push({ feedingPart, calcium, macros, micros })
    }
  )

  // Host first, then gather the Nitrogen: which bottle hosts the Calcium
  // doesn't depend on where the Nitrogen ends up (KNO₃ and friends are safe
  // beside Calcium either way), but the gathering has to know which bottle's
  // leftovers are headed for the Calcium tank so it can route the Nitrogen
  // somewhere else.
  const host = pickCalciumHost(splits)
  consolidateTaperableNitrogen(splits, host, stockVolumeLiters)

  const calciumTank = emptySaltAmounts()
  for (const split of splits) addSaltAmounts(calciumTank, split.calcium)
  if (host) addSaltAmounts(calciumTank, host.macros)

  const micros = emptySaltAmounts()
  for (const split of splits) addSaltAmounts(micros, split.micros)

  const calciumDraft: SeparateNitrogenTankDraft = {
    role: "calcium",
    salts: calciumTank,
    // Named after the host only when the host's own macros actually went in
    // beside the Calcium. A tank holding nothing but Calcium stands for every
    // part's Calcium rather than for one bottle, so naming it after one would
    // misread (see `SeparateNitrogenTank.partName`).
    ...(host && saltAmountsHasContent(host.macros)
      ? { partName: host.feedingPart.name, partId: host.feedingPart.id }
      : {}),
  }

  // Every part except the host keeps a draft for its own macros, in feed-chart
  // order. The host's are already in the Calcium tank.
  const macroDrafts: SeparateNitrogenTankDraft[] = splits
    .filter((split) => split !== host)
    .map((split) => ({
      role: "non-calcium",
      salts: split.macros,
      partName: split.feedingPart.name,
      partId: split.feedingPart.id,
    }))

  placeMicronutrients(calciumDraft, macroDrafts, micros, microPackageOwnerPartId(splits))

  // The Calcium draft comes first so it lands as Tank 1. An empty Calcium draft
  // — an all-Carbonate line — drops out in `buildSeparateNitrogenTanks`, as does
  // any part left with nothing once its Calcium and Nitrogen moved.
  return {
    tanks: buildSeparateNitrogenTanks([calciumDraft, ...macroDrafts]),
    warnings: totals.warnings,
    isApproximate: totals.warnings.length > 0 || totals.deviations.length > 0,
    directAddCalciumCarbonate: totals.directAddCalciumCarbonate,
    autoAddedSalts: totals.autoAddedSalts,
    delivered: totals.delivered,
    deviations: totals.deviations,
  }
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
  const tanks: PartStockTank[] = []
  const consolidatedMicros = emptySaltAmounts()
  const microKeys = new Set<SaltKey>(TANK_3_SALTS)

  const totals = solveEachPartIndependently(
    partsAnalysis,
    parts,
    stockVolumeLiters,
    dilutionRatio,
    (feedingPart, recipe) => {
      const allSalts = combineSaltAmounts(recipe.tankA, recipe.tankB)
      const macroSalts = emptySaltAmounts()
      for (const key of SALT_DISPLAY_ORDER) {
        if (microKeys.has(key)) {
          consolidatedMicros[key] += allSalts[key]
        } else {
          macroSalts[key] = allSalts[key]
        }
      }

      if (!saltAmountsHasContent(macroSalts)) return

      const index = tanks.length + 1
      tanks.push({
        index,
        name: `Tank ${index}`,
        partName: feedingPart.name,
        partId: feedingPart.id,
        salts: macroSalts,
      })
    }
  )

  if (saltAmountsHasContent(consolidatedMicros)) {
    const index = tanks.length + 1
    tanks.push({
      index,
      name: `Tank ${index}`,
      partName: "Micros",
      partId: "consolidated-micros",
      salts: consolidatedMicros,
      isMicroTank: true,
    })
  }

  return {
    tanks,
    warnings: totals.warnings,
    isApproximate: totals.warnings.length > 0 || totals.deviations.length > 0,
    directAddCalciumCarbonate: totals.directAddCalciumCarbonate,
    autoAddedSalts: totals.autoAddedSalts,
    delivered: totals.delivered,
    deviations: totals.deviations,
  }
}

/** Working-strength recipe for direct mixing into a reservoir of `reservoirLiters` litres */
export function calculateDirectMixRecipe(
  targets: ElementalTargets,
  reservoirLiters: number,
  includedSalts?: IncludedSaltsSelection,
  calciumChlorideGramsPerGallon: number = 0,
  calciumNitrateGramsPerGallon: number = 0,
  ureaNitrogenPpm: number = 0
): DirectMixRecipe {
  // A 1:1 stock tank of exactly reservoirLiters is equivalent to working-strength direct mix.
  const stockRecipe = calculateStockTankRecipe(
    targets,
    reservoirLiters,
    1,
    includedSalts,
    calciumChlorideGramsPerGallon,
    calciumNitrateGramsPerGallon,
    ureaNitrogenPpm
  )

  const combined = emptySaltAmounts()
  const keys = Object.keys(combined) as Array<keyof SaltAmounts>

  for (const key of keys) {
    combined[key] = stockRecipe.tankA[key] + stockRecipe.tankB[key]
  }

  return {
    salts: combined,
    warnings: stockRecipe.warnings ?? [],
    isApproximate: stockRecipe.isApproximate ?? false,
    directAddCalciumCarbonate: stockRecipe.directAddCalciumCarbonate,
    autoAddedSalts: stockRecipe.autoAddedSalts ?? [],
    delivered: stockRecipe.delivered,
    deviations: stockRecipe.deviations,
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
  Cl: 76.31,
} as const

/**
 * SO₄²⁻'s λ° above is an infinite-dilution value. In real nutrient solutions
 * sulfate pairs up with Ca²⁺/Mg²⁺/K⁺ (forming lower-mobility CaSO₄(aq),
 * MgSO₄(aq), KSO₄⁻ associates) far more readily than nitrate or
 * dihydrogen-phosphate do, so its *apparent* contribution to measured EC at
 * fertigation concentrations runs meaningfully below the naive λ°·molarity
 * figure. This mostly went unnoticed because most modeled recipes lean on
 * Ca(NO₃)₂ + KNO₃ + MKP, where MKP quietly supplies some of the Potassium
 * target "for free" and sulfate stays a minor, mostly-Epsom-salt contributor.
 *
 * Monoammonium Phosphate (MAP) doesn't carry any Potassium the way MKP
 * does, so whenever MAP is the enabled Phosphorus source the solver has to
 * make up that lost Potassium with more Potassium Sulfate — correctly
 * reflecting real formulation chemistry, but it does mean MAP-based recipes
 * carry more total sulfate than an equivalent MKP-based recipe hitting the
 * same N-P-K-Ca-Mg targets. Damping just the sulfate term (rather than
 * Ca²⁺/Mg²⁺, or MAP's own N/P factors — which are computed identically to
 * every other salt, see `ecFromSaltAmounts`) pulls the estimate down
 * specifically for sulfate-heavy formulations without moving the
 * nitrate/monovalent-dominated recipes the base 1.1×/+0.08 correction below
 * was originally calibrated against.
 *
 * Starting value only — nail it down further with a few more manufacturer
 * EC comparisons (ideally MAP-based ones) rather than tuning it blind.
 */
const SULFATE_ION_PAIRING_FACTOR = 0.75

const ION_ATOMIC_WEIGHT = {
  K: 39.098,
  Ca: 40.078,
  Mg: 24.305,
  N: 14.007,
  P: 30.974,
  S: 32.06,
  Cl: 35.453,
} as const

function ppmToMolPerLiter(ppm: number, atomicWeight: number): number {
  if (ppm <= 0 || atomicWeight <= 0) return 0
  return ppm / (atomicWeight * 1000)
}

function ecContribution(molarity: number, lambda: number): number {
  return molarity * lambda
}

/**
 * Like `ppmToMolPerLiter`, but preserves the sign instead of clamping
 * negative input to 0 — needed for `calciumNitrateLiteralDoseEcPpmDelta`'s
 * correction below, which can legitimately be negative (a real product
 * running *below* the generic assumed %N/%Ca).
 */
function signedPpmToMolPerLiter(ppm: number, atomicWeight: number): number {
  if (atomicWeight <= 0) return 0
  return ppm / (atomicWeight * 1000)
}

/** EC (mS/cm) from dissolved ions at working-solution strength */
function ecFromSaltAmounts(salts: SaltAmounts): number {
  // Carbonate's own conductivity contribution is omitted (like the
  // micronutrient sulfates) — Calcium Carbonate's near-zero solubility keeps
  // any real-world dose small enough that the omission is negligible.
  // Urea (`salts.urea`) is likewise never added to the ion sum below — it's
  // a neutral, non-ionic molecule that doesn't dissociate in solution, so it
  // contributes essentially nothing to real-world EC.
  const caPpm =
    salts.calciumNitrate * RAW_SALTS.calciumNitrate.ca * 1000 +
    salts.calciumCarbonate * RAW_SALTS.calciumCarbonate.ca * 1000 +
    salts.calciumChloride * RAW_SALTS.calciumChloride.ca * 1000
  const clFromCaCl2 = salts.calciumChloride * RAW_SALTS.calciumChloride.cl * 1000
  const nFromCaNo3 = salts.calciumNitrate * RAW_SALTS.calciumNitrate.n * 1000
  const kFromKno3 = salts.potassiumNitrate * RAW_SALTS.potassiumNitrate.k * 1000
  const nFromKno3 = salts.potassiumNitrate * RAW_SALTS.potassiumNitrate.n * 1000
  const nFromNh4no3 = salts.ammoniumNitrate * RAW_SALTS.ammoniumNitrate.n * 1000
  const nFromNh4so4 = salts.ammoniumSulfate * RAW_SALTS.ammoniumSulfate.n * 1000
  const sFromNh4so4 = salts.ammoniumSulfate * RAW_SALTS.ammoniumSulfate.s * 1000
  const kFromMkp = salts.monoPotassiumPhosphate * RAW_SALTS.monoPotassiumPhosphate.k * 1000
  const pFromMkp = salts.monoPotassiumPhosphate * RAW_SALTS.monoPotassiumPhosphate.p * 1000
  const nFromMap = salts.monoAmmoniumPhosphate * RAW_SALTS.monoAmmoniumPhosphate.n * 1000
  const pFromMap = salts.monoAmmoniumPhosphate * RAW_SALTS.monoAmmoniumPhosphate.p * 1000
  const nFromMgNo3 = salts.magnesiumNitrate * RAW_SALTS.magnesiumNitrate.n * 1000
  const mgPpm =
    salts.magnesiumSulfate * RAW_SALTS.magnesiumSulfate.mg * 1000 +
    salts.magnesiumNitrate * RAW_SALTS.magnesiumNitrate.mg * 1000
  const sFromMgSO4 = salts.magnesiumSulfate * RAW_SALTS.magnesiumSulfate.s * 1000
  const kFromK2SO4 = salts.potassiumSulfate * RAW_SALTS.potassiumSulfate.k * 1000
  const sFromK2SO4 = salts.potassiumSulfate * RAW_SALTS.potassiumSulfate.s * 1000

  const kPpm = kFromKno3 + kFromMkp + kFromK2SO4
  const nPpm = nFromCaNo3 + nFromKno3 + nFromNh4no3 + nFromNh4so4 + nFromMap + nFromMgNo3
  const pPpm = pFromMkp + pFromMap
  const sPpm = sFromMgSO4 + sFromK2SO4 + sFromNh4so4

  return (
    ecContribution(ppmToMolPerLiter(kPpm, ION_ATOMIC_WEIGHT.K), ION_CONDUCTIVITY.K) +
    ecContribution(ppmToMolPerLiter(caPpm, ION_ATOMIC_WEIGHT.Ca), ION_CONDUCTIVITY.Ca) +
    ecContribution(ppmToMolPerLiter(mgPpm, ION_ATOMIC_WEIGHT.Mg), ION_CONDUCTIVITY.Mg) +
    ecContribution(ppmToMolPerLiter(nPpm, ION_ATOMIC_WEIGHT.N), ION_CONDUCTIVITY.NO3) +
    ecContribution(ppmToMolPerLiter(pPpm, ION_ATOMIC_WEIGHT.P), ION_CONDUCTIVITY.H2PO4) +
    ecContribution(ppmToMolPerLiter(sPpm, ION_ATOMIC_WEIGHT.S), ION_CONDUCTIVITY.SO4) * SULFATE_ION_PAIRING_FACTOR +
    ecContribution(ppmToMolPerLiter(clFromCaCl2, ION_ATOMIC_WEIGHT.Cl), ION_CONDUCTIVITY.Cl)
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
 * Real elemental Sulfur ppm delivered by whichever sulfate-based salts —
 * Magnesium Sulfate, Potassium Sulfate, Ammonium Sulfate — the solver
 * actually allocates a non-zero amount of. Sulfur is unique among the
 * elemental targets: nothing in `calculateStockTankRecipe` ever sizes a
 * salt off `targets.sulfur` (see the comment there — MgSO₄ is sized purely
 * off the Magnesium target, K₂SO₄ off any Potassium shortfall, (NH₄)₂SO₄
 * off any Nitrogen shortfall). So whatever Sulfur those three salts happen
 * to bring along as a byproduct of satisfying OTHER targets was, until now,
 * only ever accounted for inside the EC estimate's ion sum
 * (`ecFromSaltAmounts`) — never folded back into the Sulfur *target* itself,
 * which is what "What your plants will get" displays. That meant a
 * Guaranteed Analysis with 0%/no declared Sulfur — common, since Sulfur
 * often isn't required on fertilizer labels — showed 0 ppm Sulfur even when
 * Magnesium Sulfate was very much dissolved in the reservoir.
 *
 * Intended as a FALLBACK for when the Guaranteed Analysis declares no Sulfur
 * at all (0% / field omitted, common since Sulfur often isn't a required
 * label field) — the caller (`calculateRecipeAction`) only folds this into
 * `targets.sulfur` when `calculateElementalTargets`'s own GA-derived Sulfur
 * is 0. When a label DOES declare a real %S, that declared value already
 * reflects the product's total elemental Sulfur — including whatever it
 * derives from its own sulfate salts — so this estimate must NOT be summed
 * on top of it; doing so double-counts the same Sulfur and overshoots the
 * target (e.g. a 2% S label, ~63 ppm, showing ~160 ppm because ~97 ppm of
 * solver-side MgSO4/K2SO4-derived Sulfur was being added on top). Only ever
 * adds — never invents Sulfur when no sulfate salt actually gets allocated
 * (all three terms below are naturally 0 in that case).
 *
 * Computed the same layout-independent way `estimateEcFromElementalTargets`
 * does (1 L stock at a 1:1 ratio — ppm at working strength doesn't depend on
 * stock volume/dilution ratio), so this is a property of the elemental
 * targets and salt selection alone, not of any particular tank layout.
 */
export function saltDerivedSulfurPpm(
  targets: ElementalTargets,
  includedSalts?: IncludedSaltsSelection,
  calciumChlorideGramsPerGallon: number = 0,
  calciumNitrateGramsPerGallon: number = 0,
  ureaNitrogenPpm: number = 0
): number {
  const stockRecipe = calculateStockTankRecipe(
    targets,
    1,
    1,
    includedSalts,
    calciumChlorideGramsPerGallon,
    calciumNitrateGramsPerGallon,
    ureaNitrogenPpm
  )
  // Magnesium Sulfate, Potassium Sulfate, and Ammonium Sulfate are always
  // assigned to Tank B (see `calculateStockTankRecipe`).
  return (
    ppmFromSaltInStock(stockRecipe.tankB.magnesiumSulfate, RAW_SALTS.magnesiumSulfate.s, 1, 1) +
    ppmFromSaltInStock(stockRecipe.tankB.potassiumSulfate, RAW_SALTS.potassiumSulfate.s, 1, 1) +
    ppmFromSaltInStock(stockRecipe.tankB.ammoniumSulfate, RAW_SALTS.ammoniumSulfate.s, 1, 1)
  )
}

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
  includedSalts?: IncludedSaltsSelection,
  calciumChlorideGramsPerGallon: number = 0,
  calciumNitrateGramsPerGallon: number = 0,
  /**
   * Optional real-vs-generic Ca/N ppm correction for a literally-dosed
   * Calcium Nitrate part (see `calciumNitrateLiteralDoseEcPpmDelta`).
   * Corrects the ion content reconstructed from `calciumNitrateGramsPerGallon`
   * below, which otherwise always assumes `RAW_SALTS.calciumNitrate`'s
   * generic composition regardless of the real product's declared label %.
   */
  calciumNitrateLiteralDoseEcDelta: { calciumPpmDelta: number; nitrogenPpmDelta: number } = {
    calciumPpmDelta: 0,
    nitrogenPpmDelta: 0,
  },
  ureaNitrogenPpm: number = 0
): number | null {
  const hasMacro =
    targets.nitrogen > 0 ||
    targets.phosphorus > 0 ||
    targets.potassium > 0 ||
    targets.calcium > 0 ||
    targets.magnesium > 0 ||
    targets.sulfur > 0

  if (!hasMacro) return null

  const stockRecipe = calculateStockTankRecipe(
    targets,
    1,
    1,
    includedSalts,
    calciumChlorideGramsPerGallon,
    calciumNitrateGramsPerGallon,
    ureaNitrogenPpm
  )
  const salts = emptySaltAmounts()
  for (const key of Object.keys(salts) as SaltKey[]) {
    salts[key] = stockRecipe.tankA[key] + stockRecipe.tankB[key]
  }
  // Calcium Carbonate is never in tankA/tankB (see calculateStockTankRecipe),
  // but its dissolved Calcium still ends up in the reservoir either way — add
  // it back in here so the EC estimate isn't missing that contribution.
  salts.calciumCarbonate = stockRecipe.directAddCalciumCarbonate?.grams ?? 0

  const baseEc = ecFromSaltAmounts(salts)
  if (!Number.isFinite(baseEc) || baseEc <= 0) return null

  // Apply the real-vs-generic Ca/N correction (see
  // `calciumNitrateLiteralDoseEcPpmDelta`) on top of the grams-reconstructed
  // ionic sum above, which — for a literally-dosed Calcium Nitrate part —
  // always assumed the generic composition no matter what the real product
  // actually declares.
  const deltaEc =
    ecContribution(
      signedPpmToMolPerLiter(calciumNitrateLiteralDoseEcDelta.calciumPpmDelta, ION_ATOMIC_WEIGHT.Ca),
      ION_CONDUCTIVITY.Ca
    ) +
    ecContribution(
      signedPpmToMolPerLiter(calciumNitrateLiteralDoseEcDelta.nitrogenPpmDelta, ION_ATOMIC_WEIGHT.N),
      ION_CONDUCTIVITY.NO3
    )
  const correctedBaseEc = Math.max(0, baseEc + deltaEc)

  const correctedEc = correctedBaseEc * EC_REAL_WORLD_FACTOR + EC_ADDITIVE_BUFFER_MS_CM
  return Number.isFinite(correctedEc) && correctedEc > 0 ? correctedEc : null
}
