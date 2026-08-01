/**
 * Dry bulk batching: the already-solved Direct Mix salt list, re-expressed as
 * bags of dry pre-blend that are safe to store together, each weighed out to a
 * fixed 10 or 25 lb.
 *
 * Nothing here re-solves anything. The solver's Direct Mix amounts are grams
 * sized for one reservoir at the grower's own feed strength (see
 * `calculateDirectMixRecipe`); this module keeps their ratios exactly and only
 *
 *   1. partitions them into bags no salt may share, and
 *   2. multiplies each bag's salts by the one scale that brings that bag, on
 *      its own, to 10 or 25 lb.
 *
 * The scale is per bag rather than per batch, so two bags both come out at
 * 10 lb even when the recipe puts four times as much weight in one as in the
 * other. Every bag is then a round number the grower can weigh to and label,
 * at the cost of the bags no longer emptying together — which is what the note
 * `buildDryBulkBatch` adds for a multi-bag split says out loud.
 *
 * Use rates are read off the *unscaled* solved grams, so they're a property of
 * the recipe rather than of the bag size: a bag holding 12% of the reservoir's
 * dry weight is dosed at 12% of the reservoir's total grams per gallon whether
 * it was bagged at 10 lb or 25. The one input that does move them is Target EC,
 * which scales every solved gram before this module sees it — and because it
 * scales all of them by the same factor, it moves the use rates without
 * touching the ratios, and so without touching the bags.
 *
 * A dry pre-blend is a concentrate the moment it meets water, so the bag split
 * is stricter than the stock-tank split in `recipe-types.ts`: Calcium is kept
 * away from Magnesium Nitrate as well as from the phosphates and sulfates that
 * `CALCIUM_INCOMPATIBLE_SALTS` already covers. See
 * `DRY_CALCIUM_FORBIDDEN_SALTS`.
 */

import type { PartAnalysis } from "@/components/hydro-calc/guaranteed-analysis-screen"
import {
  CALCIUM_INCOMPATIBLE_SALTS,
  getEnabledSaltKeys,
  LITERS_PER_GALLON,
  RAW_SALTS,
  SALT_CHECKBOX_OPTIONS,
  SALT_DISPLAY_ORDER,
  saltElementFractions,
  TANK_3_SALTS,
  type ElementalTargets,
  type SaltAmounts,
  type SaltKey,
} from "./recipe-types"

export const GRAMS_PER_POUND = 453.59237

/** The two bag sizes offered, in pounds of dry product per individual bag. */
export const DRY_BATCH_SIZES_LB = [10, 25] as const
export type DryBatchSizeLb = (typeof DRY_BATCH_SIZES_LB)[number]

/**
 * A guaranteed analysis has to name at least this many parts before the bags
 * are cut one-per-part rather than simply Calcium-vs-everything-else. Below it
 * the per-part split buys nothing a grower can act on: a two-part line's Part A
 * is the Calcium bottle almost by definition, so "one bag per part" and "one
 * Calcium bag plus one base bag" describe the same two bags.
 */
export const DRY_BATCH_PER_PART_MIN_PARTS = 3

/** The micronutrient salts, which are pooled into one bag — see `pickMicroHost`. */
const MICRO_SALT_KEYS = new Set<SaltKey>(TANK_3_SALTS)

/** Every salt carrying `element` at all, read off the one composition table. */
function saltsCarrying(element: keyof ElementalTargets): SaltKey[] {
  return (Object.keys(RAW_SALTS) as SaltKey[]).filter((key) =>
    saltElementFractions(key).some(([carried]) => carried === element)
  )
}

/**
 * The Calcium sources — derived from `RAW_SALTS` rather than listed, so a
 * Calcium salt added to the composition table is bagged as one without anybody
 * having to remember this file exists.
 */
export const DRY_CALCIUM_SOURCE_SALTS: SaltKey[] = saltsCarrying("calcium")

/** The phosphate carriers. Derived the same way, for the same reason. */
export const DRY_PHOSPHORUS_SOURCE_SALTS: SaltKey[] = saltsCarrying("phosphorus")

/** The Magnesium carriers — Magnesium Sulfate, Magnesium Nitrate, and any future one. */
export const DRY_MAGNESIUM_SOURCE_SALTS: SaltKey[] = saltsCarrying("magnesium")

/**
 * What may never share a dry bag with a Calcium source.
 *
 * Strictly wider than `CALCIUM_INCOMPATIBLE_SALTS`, which answers the
 * stock-tank question ("would these precipitate at stock strength?") and so
 * covers only the phosphates and sulfates. A dry blend has to answer a harsher
 * one: whatever the grower is told, some of them will tip a scoop of it into a
 * jug rather than into a full reservoir, and a bag that pairs Calcium with
 * Magnesium Nitrate has no safe way to be dissolved at all. Magnesium is
 * therefore excluded from the Calcium bag whichever anion it arrives with —
 * which is also what keeps this list matching the safety note the batch
 * instructions print.
 *
 * Ammonium Nitrate is deliberately NOT here, matching how the rest of the
 * calculator treats it: it sits in `TANK_A_SALTS` beside concentrated Calcium
 * and Separate Nitrogen pours it straight into the Calcium tank. It still ends
 * up in the base bag rather than the Calcium bag, because the Calcium bag is
 * built from the Calcium sources alone — being *allowed* beside Calcium isn't a
 * reason to move a Nitrogen salt away from the macros it's weighed with.
 */
export const DRY_CALCIUM_FORBIDDEN_SALTS: SaltKey[] = Array.from(
  new Set<SaltKey>([
    ...CALCIUM_INCOMPATIBLE_SALTS,
    ...DRY_PHOSPHORUS_SOURCE_SALTS,
    ...DRY_MAGNESIUM_SOURCE_SALTS,
  ])
)

const DRY_CALCIUM_SOURCE_SET = new Set<SaltKey>(DRY_CALCIUM_SOURCE_SALTS)
const DRY_CALCIUM_FORBIDDEN_SET = new Set<SaltKey>(DRY_CALCIUM_FORBIDDEN_SALTS)

/**
 * Calcium Carbonate never joins a bag: it's the one salt the solver already
 * holds out of every tank because it won't dissolve (see
 * `DirectAddCalciumCarbonate`), so pre-blending it would put an insoluble
 * powder into a weight the grower is told is nutrient. It reaches the reservoir
 * the same way it does in every other layout — stirred in directly — and stays
 * outside the batch weight.
 */
const BAG_EXCLUDED_SALTS = new Set<SaltKey>(["calciumCarbonate"])

/**
 * A new salt in `RAW_SALTS` that carries Phosphorus or Magnesium has to widen
 * `DRY_CALCIUM_FORBIDDEN_SALTS`, or the next batch would quietly bag it with
 * the Calcium. Both lists are derived from the composition table above, so this
 * can only fail if that derivation is replaced with a hand-written list — which
 * is exactly when it needs to fail.
 */
function assertDryBagRulesCoverEveryIncompatibility(): void {
  const uncovered = [...DRY_PHOSPHORUS_SOURCE_SALTS, ...DRY_MAGNESIUM_SOURCE_SALTS].filter(
    (key) => !DRY_CALCIUM_FORBIDDEN_SET.has(key)
  )
  if (uncovered.length > 0) {
    throw new Error(
      "Dry bag splitting would allow Calcium beside a Phosphorus or Magnesium source — add " +
        `these to DRY_CALCIUM_FORBIDDEN_SALTS: ${uncovered.join(", ")}`
    )
  }

  const bothSides = DRY_CALCIUM_SOURCE_SALTS.filter((key) => DRY_CALCIUM_FORBIDDEN_SET.has(key))
  if (bothSides.length > 0) {
    throw new Error(
      "A salt is classified as both a Calcium source and forbidden beside Calcium, so it can " +
        `never be bagged: ${bothSides.join(", ")}`
    )
  }
}

assertDryBagRulesCoverEveryIncompatibility()

export type DryBagRole = "base" | "calcium"

export interface DryBagSalt {
  key: SaltKey
  name: string
  formula: string
  /** Grams of this salt in the finished bag, at the chosen bag size. */
  grams: number
  isMicro: boolean
}

export interface DryBag {
  /** "A", "B", "C" … in the order the bags are meant to be weighed out. */
  letter: string
  /** What the bag holds, e.g. "Base (no calcium)" — the UI prints "Bag A — …". */
  title: string
  role: DryBagRole
  /** The guaranteed-analysis part this bag stands in for, when bags are cut per part. */
  partName: string | null
  salts: DryBagSalt[]
  /** `sizeLb` × `GRAMS_PER_POUND` — every bag is weighed out to the same total. */
  totalGrams: number
  totalPounds: number
  /** Grams of this finished blend per US gallon of irrigation water. */
  gramsPerGallonOfWater: number
  /** Grams of this finished blend per liter of irrigation water. */
  gramsPerLiterOfWater: number
}

export interface DryBulkBatch {
  sizeLb: DryBatchSizeLb
  /** What each individual bag is weighed out to: `sizeLb` × `GRAMS_PER_POUND`. */
  bagTargetGrams: number
  /** Dry product across every bag — `bagTargetGrams` × the number of bags. */
  totalGrams: number
  bags: DryBag[]
  /**
   * `"per-part"` when each bag stands in for one part of the original
   * guaranteed analysis, `"calcium-vs-rest"` for the default two-bag split.
   */
  splitBasis: "per-part" | "calcium-vs-rest"
  /** Anything about this particular split the instructions have to mention. */
  notes: string[]
}

interface BagDraft {
  role: DryBagRole
  partName: string | null
  keys: SaltKey[]
}

/** Non-zero salts eligible for a bag, in the order they're displayed elsewhere. */
function bagEligibleKeys(salts: SaltAmounts): SaltKey[] {
  return SALT_DISPLAY_ORDER.filter((key) => salts[key] > 0 && !BAG_EXCLUDED_SALTS.has(key))
}

function totalOf(salts: SaltAmounts, keys: SaltKey[]): number {
  return keys.reduce((total, key) => total + salts[key], 0)
}

/**
 * Whether the bags can be cut one per original part.
 *
 * Needs three things: enough parts to be worth it, and every part having
 * actually declared which salts it contains — an unchecked part falls back to
 * "any salt is fair game" (see `getEnabledSaltKeys`), which would let it claim
 * the entire recipe and collapse the split back to one bag wearing a part's
 * name.
 */
function canSplitPerPart(partsAnalysis: PartAnalysis[]): boolean {
  if (partsAnalysis.length < DRY_BATCH_PER_PART_MIN_PARTS) return false
  return partsAnalysis.every((part) =>
    SALT_CHECKBOX_OPTIONS.some((option) => part.includedSalts?.[option.id])
  )
}

/**
 * Which part each macro salt is bagged under: the first part whose own salt
 * selection claims it. A salt two parts both declared can only go in one bag,
 * and the earlier part wins — the Direct Mix amounts are a single pooled solve
 * (see `calculateDirectMixRecipe`), so there is no per-part share of it to
 * honour, only a bag to file it in.
 */
function claimKeysByPart(
  keys: SaltKey[],
  partsAnalysis: PartAnalysis[]
): { byPart: Map<string, SaltKey[]>; unclaimed: SaltKey[] } {
  const enabledByPart = partsAnalysis.map(
    (part) => [part, getEnabledSaltKeys(part.includedSalts)] as const
  )
  const byPart = new Map<string, SaltKey[]>()
  const unclaimed: SaltKey[] = []

  for (const key of keys) {
    const owner = enabledByPart.find(([, enabled]) => enabled.has(key))
    if (!owner) {
      unclaimed.push(key)
      continue
    }
    const partId = owner[0].id
    byPart.set(partId, [...(byPart.get(partId) ?? []), key])
  }

  return { byPart, unclaimed }
}

/**
 * The base bag the micronutrient package rides in: whichever holds the most
 * macro weight.
 *
 * Micros are pooled into one bag rather than followed back to the part that
 * declared them, the same trade `calculateDoserMultiPartRecipe` makes when it
 * gathers them into a single suction line. A 25 lb batch can put a
 * micronutrient at well under a gram, and splitting that across three bags
 * hands the grower three weights no scale resolves — and three separate
 * premixes to get even. Pooling costs nothing: micros are dosed with the bag
 * they're in, and every bag goes into the same reservoir.
 */
function pickMicroHost(drafts: BagDraft[], salts: SaltAmounts): BagDraft | null {
  let best: BagDraft | null = null
  let bestGrams = -1
  for (const draft of drafts) {
    if (draft.role !== "base") continue
    const grams = totalOf(salts, draft.keys)
    if (grams > bestGrams) {
      best = draft
      bestGrams = grams
    }
  }
  return best
}

/**
 * Cut the solved Direct Mix salt list into bags that are safe to store and
 * scoop together, without touching a single amount.
 *
 * Rules, in the order they bind:
 *
 *  1. Every Calcium source goes into a bag of its own, holding nothing else.
 *     That is what keeps Calcium away from the phosphates, the sulfates and the
 *     Magnesium in one stroke — a bag containing only Calcium salts cannot
 *     violate `DRY_CALCIUM_FORBIDDEN_SALTS` however the rest of the recipe is
 *     arranged.
 *  2. The remaining macros are cut one bag per original part when the analysis
 *     named three or more and each said what was in it (`canSplitPerPart`),
 *     otherwise they form a single base bag. A part whose salts are all Calcium
 *     contributes no base bag of its own — its Calcium is already in the
 *     Calcium bag, which is what "split the part rather than allow a forbidden
 *     combination" means here.
 *  3. The micronutrient package is pooled into whichever base bag is heaviest
 *     (`pickMicroHost`), so it stays weighable and needs premixing only once.
 */
function draftBags(salts: SaltAmounts, partsAnalysis: PartAnalysis[]): {
  drafts: BagDraft[]
  splitBasis: DryBulkBatch["splitBasis"]
  notes: string[]
} {
  const eligible = bagEligibleKeys(salts)
  const calciumKeys = eligible.filter((key) => DRY_CALCIUM_SOURCE_SET.has(key))
  const otherKeys = eligible.filter((key) => !DRY_CALCIUM_SOURCE_SET.has(key))
  const microKeys = otherKeys.filter((key) => MICRO_SALT_KEYS.has(key))
  const macroKeys = otherKeys.filter((key) => !MICRO_SALT_KEYS.has(key))

  const notes: string[] = []
  const perPart = canSplitPerPart(partsAnalysis)
  const baseDrafts: BagDraft[] = []

  if (perPart) {
    const { byPart, unclaimed } = claimKeysByPart(macroKeys, partsAnalysis)
    for (const part of partsAnalysis) {
      const keys = byPart.get(part.id)
      if (!keys || keys.length === 0) continue
      baseDrafts.push({ role: "base", partName: part.name || "Unnamed part", keys })
    }
    if (unclaimed.length > 0) {
      const host = pickMicroHost(baseDrafts, salts)
      if (host) {
        host.keys = [...host.keys, ...unclaimed]
        notes.push(
          `${unclaimed.map((key) => RAW_SALTS[key].name).join(", ")} ` +
            `${unclaimed.length === 1 ? "isn't" : "aren't"} declared on any part — the solver ` +
            `reached for ${unclaimed.length === 1 ? "it" : "them"} to match your label, so ` +
            `${unclaimed.length === 1 ? "it rides" : "they ride"} in Bag ` +
            `${String.fromCharCode(65 + baseDrafts.indexOf(host))}.`
        )
      } else {
        baseDrafts.push({ role: "base", partName: null, keys: unclaimed })
      }
    }
  } else if (macroKeys.length > 0) {
    baseDrafts.push({ role: "base", partName: null, keys: macroKeys })
  }

  if (microKeys.length > 0) {
    const host = pickMicroHost(baseDrafts, salts)
    if (host) {
      host.keys = [...host.keys, ...microKeys]
    } else {
      // Nothing but Calcium and micros in the recipe, so there's no base bag to
      // host them. The chelates would be safe beside concentrated Calcium (see
      // `CALCIUM_INCOMPATIBLE_SALTS`), but the Calcium bag is kept to Calcium
      // alone so its label stays true — so the micros get a bag of their own.
      baseDrafts.push({ role: "base", partName: null, keys: microKeys })
    }
  }

  // A per-part split that came back with a single base bag isn't one: that bag
  // holds every part's macros, so wearing one part's name would misdescribe it.
  if (baseDrafts.length === 1) baseDrafts[0].partName = null

  const drafts = [...baseDrafts]
  if (calciumKeys.length > 0) {
    drafts.push({
      role: "calcium",
      partName: null,
      keys: calciumKeys,
    })
  }

  if (calciumKeys.length === 0) {
    notes.push(
      "This recipe has no calcium salt in it, so there's no calcium bag to keep separate — " +
        "everything below is safe in one blend."
    )
  }

  return {
    drafts,
    splitBasis: perPart && baseDrafts.some((draft) => draft.partName) ? "per-part" : "calcium-vs-rest",
    notes,
  }
}

function bagTitle(draft: BagDraft, hasSeveralBaseBags: boolean): string {
  if (draft.role === "calcium") {
    return hasSeveralBaseBags ? "Calcium only (all parts)" : "Calcium only"
  }
  if (draft.partName) return `${draft.partName} (no calcium)`
  return "Base (no calcium)"
}

export interface BuildDryBulkBatchInput {
  /** The Direct Mix salt amounts as displayed — already at the grower's Target EC. */
  salts: SaltAmounts
  /** The reservoir those grams were solved for, which sets the use rate. */
  reservoirLiters: number
  sizeLb: DryBatchSizeLb
  /** Used only to decide whether bags are cut per part; never changes an amount. */
  partsAnalysis: PartAnalysis[]
  /** Grams of Calcium Carbonate the recipe adds straight to the reservoir, if any. */
  directAddCalciumCarbonateGrams?: number
}

/**
 * The whole batch: bags, scaled weights, and the use rate that goes with them.
 * Returns null when there's nothing to bag.
 */
export function buildDryBulkBatch({
  salts,
  reservoirLiters,
  sizeLb,
  partsAnalysis,
  directAddCalciumCarbonateGrams = 0,
}: BuildDryBulkBatchInput): DryBulkBatch | null {
  const eligible = bagEligibleKeys(salts)
  const solvedTotalGrams = totalOf(salts, eligible)
  if (eligible.length === 0 || !(solvedTotalGrams > 0) || !(reservoirLiters > 0)) return null

  const bagTargetGrams = sizeLb * GRAMS_PER_POUND

  const { drafts, splitBasis, notes } = draftBags(salts, partsAnalysis)
  const baseBagCount = drafts.filter((draft) => draft.role === "base").length

  const bags: DryBag[] = drafts.map((draft, index) => {
    const solvedBagGrams = totalOf(salts, draft.keys)
    // One scale per bag, so this bag alone hits the chosen weight. Within the
    // bag it's still a single multiplier, which is what keeps the solver's
    // ratios — and so the use rate below — untouched.
    const bagScale = solvedBagGrams > 0 ? bagTargetGrams / solvedBagGrams : 0

    return {
      letter: String.fromCharCode(65 + index),
      title: bagTitle(draft, baseBagCount > 1),
      role: draft.role,
      partName: draft.partName,
      // Re-ordered rather than trusted: the drafts append micros and any
      // unclaimed salts, so only `SALT_DISPLAY_ORDER` guarantees a bag reads in
      // the same order as every other salt list in the app.
      salts: SALT_DISPLAY_ORDER.filter((key) => draft.keys.includes(key)).map((key) => ({
        key,
        name: RAW_SALTS[key].name,
        formula: RAW_SALTS[key].formula,
        grams: salts[key] * bagScale,
        isMicro: MICRO_SALT_KEYS.has(key),
      })),
      totalGrams: solvedBagGrams * bagScale,
      totalPounds: (solvedBagGrams * bagScale) / GRAMS_PER_POUND,
      // Off the solved grams, not the bag: this is how strong the recipe is,
      // which the bag size can't change. See the module comment.
      gramsPerGallonOfWater: (solvedBagGrams / reservoirLiters) * LITERS_PER_GALLON,
      gramsPerLiterOfWater: solvedBagGrams / reservoirLiters,
    }
  })

  if (bags.length > 1) {
    notes.push(
      `Each bag is weighed out to ${sizeLb} lb on its own, not ${sizeLb} lb shared between them, ` +
        "so the bags won't run out together — whichever one your recipe uses least of lasts the " +
        "longest. Mix a fresh bag of whichever empties first; the use rates don't change."
    )
  }

  if (directAddCalciumCarbonateGrams > 0) {
    notes.push(
      "Your recipe also calls for Calcium Carbonate. It stays out of these bags — it barely " +
        "dissolves, so it goes straight into the reservoir as the note above describes, and it " +
        `isn't counted in the ${sizeLb} lb.`
    )
  }

  return {
    sizeLb,
    bagTargetGrams,
    totalGrams: bags.reduce((total, bag) => total + bag.totalGrams, 0),
    bags,
    splitBasis,
    notes,
  }
}

/**
 * Every way a set of bags breaks the dry compatibility rules, named so a
 * failure says which bag and which salts. Empty for bags built by
 * `buildDryBulkBatch`, which can't produce a violation by construction — this
 * exists so `scripts/verify-delivered-ppm.ts` can check that claim against real
 * solved recipes rather than trusting it.
 */
export function findDryBagCompatibilityViolations(bags: DryBag[]): string[] {
  const violations: string[] = []

  for (const bag of bags) {
    const keys = bag.salts.filter((salt) => salt.grams > 0).map((salt) => salt.key)
    const calcium = keys.filter((key) => DRY_CALCIUM_SOURCE_SET.has(key))
    if (calcium.length === 0) continue

    const forbidden = keys.filter((key) => DRY_CALCIUM_FORBIDDEN_SET.has(key))
    if (forbidden.length === 0) continue

    violations.push(
      `Bag ${bag.letter} (${bag.title}) holds Calcium (${calcium
        .map((key) => RAW_SALTS[key].name)
        .join(", ")}) beside ${forbidden.map((key) => RAW_SALTS[key].name).join(", ")}`
    )
  }

  return violations
}

/** Enough decimals to weigh a bag ingredient — micros need the extra two. */
export function formatBagGrams(grams: number): string {
  if (!Number.isFinite(grams) || grams <= 0) return "—"
  if (grams < 1) return `${grams.toFixed(3)} g`
  if (grams < 100) return `${grams.toFixed(2)} g`
  return `${grams.toFixed(1)} g`
}

/** The use rate, at the precision a grower can actually measure a scoop to. */
export function formatUseRateGrams(grams: number): string {
  if (!Number.isFinite(grams) || grams <= 0) return "—"
  if (grams < 0.1) return `${grams.toFixed(3)} g`
  if (grams < 10) return `${grams.toFixed(2)} g`
  return `${grams.toFixed(1)} g`
}
