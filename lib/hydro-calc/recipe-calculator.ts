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
  calciumChlorideElementalCalciumPpm,
  combineDirectAddCalciumCarbonate,
  emptyElementalTargets,
  emptySaltAmounts,
  getConcentrateGramsPerLiter,
  getDoseGramsPerGallon,
  getEnabledSaltKeys,
  gramsFromFeedRatePerGallon,
  isCalciumNitrateSoleDoseSource,
  parsePositive,
  percentToPpm,
  RAW_SALTS,
  SALT_DISPLAY_ORDER,
  TANK_1_SALTS,
  TANK_2_SALTS,
  TANK_3_SALTS,
  TANK_A_SALTS,
  TANK_B_SALTS,
  ureaNitrogenPpmForPart,
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
  type SaltGapWarning,
  type SaltKey,
  type TankRecipe,
  type ThreeTankRecipe,
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
 * what `RAW_SALTS.calciumNitrate`'s generic composition (16.9% Ca, 11.8%
 * N — the tetrahydrate's pure chemical formula, not necessarily what any
 * given commercial product actually is) would imply for the same dose.
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
 * of (or behind) the generic assumption. A common case where they run
 * ahead: many commercial "15.5-0-0 +19% Ca" Calcium Nitrate products are
 * richer than the pure tetrahydrate formula RAW_SALTS models.
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
  // RAW_SALTS.calciumNitrate's *assumed* pure-salt fractions (16.9% Ca,
  // 11.8% N), which is exactly what you want when replicating an unknown
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
  // KNO₃ → more Ca(NO₃)₂ → NH₄NO₃ → (NH₄)₂SO₄
  const remainingNitrogenPpm = Math.max(0, nitrogenTargetAfterMap - nitrogenFromCalciumNitrate)
  if (remainingNitrogenPpm > 0) {
    if (isEnabled("potassiumNitrate")) {
      assignToTankA(
        "potassiumNitrate",
        saltGramsForTargetPpm(remainingNitrogenPpm, RAW_SALTS.potassiumNitrate.n, stockVolumeLiters, dilutionRatio)
      )
    } else if (nitrateEnabled && !calciumNitrateSizedFromFeedRate) {
      // No dedicated nitrate-only salt is enabled, but Calcium Nitrate is —
      // re-size it off the full (MAP-adjusted) Nitrogen target instead of
      // its Calcium-only share. This grams value is always ≥ the
      // Calcium-based amount above (it's solving for a requirement that's
      // at least as large on the same salt), so the Calcium target stays
      // fully met — with, when Carbonate and/or Chloride are also enabled,
      // some unavoidable Calcium overshoot on top of their own fixed shares
      // as the trade-off for hitting Nitrogen. This is exactly the
      // "generic Calcium Nitrate + a little Calcium Chloride" case: Nitrate
      // ends up sized for Nitrogen (its primary job here), Chloride keeps
      // its small top-up share untouched. Carbonate's and Chloride's own
      // allocations are untouched either way.
      //
      // Skipped when `calciumNitrateSizedFromFeedRate` is true: that means
      // the caller gave us Calcium Nitrate's own literal feed-chart dose
      // (see the Calcium-solving block above), so overriding it here would
      // silently replace a real, physically-measured amount with a
      // %-derived guess — exactly the bug this whole feed-rate path exists
      // to avoid. Any true Nitrogen shortfall against the label's %N is
      // left for `ammoniumNitrate/ammoniumSulfate` below (or reported as a
      // gap) rather than papered over by inflating Calcium Nitrate.
      calciumNitrateGrams = saltGramsForTargetPpm(
        nitrogenTargetAfterMap,
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
    } else if (!calciumNitrateSizedFromFeedRate) {
      warnings.push({ element: "nitrogen", label: "Nitrogen" })
    }
    // else: Calcium Nitrate was sized from its own explicit feed-chart dose
    // above and no other Nitrogen salt is enabled to close the rest of the
    // gap. Same as Calcium Chloride's fixed dose undershooting its share of
    // the Calcium target (see the Calcium-solving block) — a real,
    // physically-measured dose falling short of a %-derived target is
    // expected, not a "salt is unchecked" gap, so it isn't warned on here.
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
  // doc comment) — it's surfaced separately below as a reservoir addition.
  const directAddCalciumCarbonate = buildDirectAddCalciumCarbonate(
    calciumCarbonateGrams,
    stockVolumeLiters,
    dilutionRatio
  )

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

  return { tankA, tankB, warnings, isApproximate: warnings.length > 0, directAddCalciumCarbonate }
}

/**
 * Build a stock tank recipe with Nitrogen + Calcium isolated for end-of-flower
 * tapering.
 *
 *   Tank 1 — Calcium Nitrate only (Ca²⁺ + N). Taper this to drop N at end of flower.
 *   Tank 2 — Everything else: remaining macro salts (KNO₃, MKP/MAP, MgSO₄, K₂SO₄)
 *            AND the micronutrients (Fe-DTPA, Mn/Zn/Cu-EDTA chelates, boric
 *            acid, sodium molybdate) — always merged together for a clean
 *            2-tank system.
 *
 * Calcium Carbonate, if enabled, never lands in Tank 1 (or anywhere else) —
 * see `calculateStockTankRecipe` — and comes back as `directAddCalciumCarbonate`
 * instead.
 *
 * `hasMicronutrients` tells callers whether the recipe has any micros at all
 * — use this to decide whether to render a "Micronutrients" sub-section
 * inside Tank 2.
 */
export function calculateSeparateCalciumRecipe(
  targets: ElementalTargets,
  stockVolumeLiters: number,
  dilutionRatio: number,
  includedSalts?: IncludedSaltsSelection,
  calciumChlorideGramsPerGallon: number = 0,
  calciumNitrateGramsPerGallon: number = 0,
  ureaNitrogenPpm: number = 0
): ThreeTankRecipe {
  const {
    tankA,
    tankB,
    warnings = [],
    isApproximate = false,
    directAddCalciumCarbonate,
  } = calculateStockTankRecipe(
    targets,
    stockVolumeLiters,
    dilutionRatio,
    includedSalts,
    calciumChlorideGramsPerGallon,
    calciumNitrateGramsPerGallon,
    ureaNitrogenPpm
  )

  const tank1 = emptySaltAmounts()
  const tank2 = emptySaltAmounts()

  const TANK_A_KEYS_IN_TANK_2 = new Set<SaltKey>([
    "potassiumNitrate",
    "ammoniumNitrate",
    "magnesiumNitrate",
    "urea",
  ])

  for (const key of TANK_1_SALTS) {
    tank1[key] = tankA[key]
  }
  for (const key of TANK_2_SALTS) {
    tank2[key] = TANK_A_KEYS_IN_TANK_2.has(key) ? tankA[key] : tankB[key]
  }
  // Micronutrients always fold into Tank 2 alongside the rest of the
  // non-nitrogen components — there is no separate micros tank in this layout.
  for (const key of TANK_3_SALTS) {
    tank2[key] = key === "ironDTPA" ? tankA[key] : tankB[key]
  }

  const hasMicronutrients = TANK_3_SALTS.some((key) => tank2[key] > 0)

  return {
    tank1,
    tank2,
    hasMicronutrients,
    warnings,
    isApproximate,
    directAddCalciumCarbonate,
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
  let directAddCalciumCarbonate: DirectAddCalciumCarbonate | undefined
  let tankIndex = 0

  for (const feedingPart of parts) {
    if (parsePositive(feedingPart.dose) === 0) continue
    const analysis = analysisById.get(feedingPart.id)
    if (!analysis) continue

    const rawTargets = calculateElementalTargets([analysis], [feedingPart])
    const hasAnyElement = Object.values(rawTargets).some((value) => value > 0)
    if (!hasAnyElement) continue

    const { targets } = applyMicroEstimates(rawTargets)
    const {
      tankA,
      tankB,
      warnings = [],
      directAddCalciumCarbonate: partDirectAdd,
    } = calculateStockTankRecipe(
      targets,
      stockVolumeLiters,
      dilutionRatio,
      analysis.includedSalts,
      parsePositive(analysis.calciumChlorideGramsPerGallon),
      calciumNitrateGramsPerGallonForPart(analysis, feedingPart),
      ureaNitrogenPpmForPart(feedingPart, analysis)
    )
    for (const warning of warnings) warningsByElement.set(warning.element, warning)
    directAddCalciumCarbonate = combineDirectAddCalciumCarbonate(directAddCalciumCarbonate, partDirectAdd)

    // Calcium Carbonate never lands in a part's tank (folded into
    // `directAddCalciumCarbonate` above instead), so a part whose only
    // Calcium source is Carbonate legitimately has nothing left to weigh
    // into a physical tank here — skip creating one for it.
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
  return { tanks, warnings, isApproximate: warnings.length > 0, directAddCalciumCarbonate }
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
  let directAddCalciumCarbonate: DirectAddCalciumCarbonate | undefined
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
    const {
      tankA,
      tankB,
      warnings = [],
      directAddCalciumCarbonate: partDirectAdd,
    } = calculateStockTankRecipe(
      targets,
      stockVolumeLiters,
      dilutionRatio,
      analysis.includedSalts,
      parsePositive(analysis.calciumChlorideGramsPerGallon),
      calciumNitrateGramsPerGallonForPart(analysis, feedingPart),
      ureaNitrogenPpmForPart(feedingPart, analysis)
    )
    for (const warning of warnings) warningsByElement.set(warning.element, warning)
    directAddCalciumCarbonate = combineDirectAddCalciumCarbonate(directAddCalciumCarbonate, partDirectAdd)
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
  return { tanks, warnings, isApproximate: warnings.length > 0, directAddCalciumCarbonate }
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
 * Deliberately additive on top of any Guaranteed-Analysis-declared Sulfur
 * (folded into `targets.sulfur` already by `calculateElementalTargets`),
 * not a replacement — a real product's declared %S and the solver's own
 * choice of raw salt to hit a DIFFERENT target (Mg/K/N) are independent
 * sources of real, physically dissolved Sulfur. Only ever adds — never
 * invents Sulfur when no sulfate salt actually gets allocated (all three
 * terms below are naturally 0 in that case).
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
