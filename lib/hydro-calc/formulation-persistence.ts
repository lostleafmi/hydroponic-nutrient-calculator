import type { PartAnalysis } from "@/components/hydro-calc/guaranteed-analysis-screen"
import type { NutrientPart } from "@/components/hydro-calc/feeding-rates-screen"
import {
  DEFAULT_INCLUDED_SALTS,
  migrateLegacyDoseUnit,
  parsePositive,
  SALT_CHECKBOX_OPTIONS,
  type DoseUnit,
  type IncludedSaltsSelection,
} from "@/lib/hydro-calc/recipe-types"

/**
 * Both halves of the saved-formulation round-trip: what "Save to Dashboard"
 * writes for each part, and how a formulation fetched back by
 * `?loadFormulation=<id>` is turned into wizard state again.
 *
 * They live together because the only thing that makes the round-trip correct
 * is the two sides agreeing on where a part's "Salts & Inputs Included"
 * selection is recorded. The one rule this module exists to enforce: a salt
 * belongs to exactly the part the grower checked it on, and a load must never
 * hand a part a salt from somewhere else. A formulation's salts pooled across
 * every part is a different quantity entirely (`unionIncludedSalts`) — useful
 * for a shopping list, never a substitute for a part's own selection.
 *
 * Client-safe, like `recipe-types.ts`: no solver logic here.
 */

/**
 * Version stamped onto every save. 2 is the first to record each part's salts
 * at the top level (`partSalts`) as well as inside `partsAnalysis`; a save
 * without this field predates that and may carry nothing per-part at all.
 * Loaders should key off the fields they actually find rather than this
 * number — it's here so a save can be identified after the fact.
 */
export const FORMULATION_SCHEMA_VERSION = 2

/**
 * One part's own inputs, recorded flat at the top level of the save rather
 * than only nested inside its `partsAnalysis` entry.
 *
 * The duplication is deliberate. `partsAnalysis` is the calculator's internal
 * part shape and has changed several times; anything that stores or forwards
 * a formulation by rebuilding known fields will silently drop the ones it
 * doesn't know, and a dropped `includedSalts` is invisible until a grower
 * reloads and finds salts they never checked. This list carries only the
 * part-level inputs that can't be recomputed from anything else, so a loader
 * has a second, independently-named place to find them.
 */
export interface SavedPartSalts {
  /** Matches the `id` of the part's `partsAnalysis` / `parts` entries. */
  partId: string
  /** Recorded so a part can still be matched if its `id` was regenerated. */
  partName: string
  includedSalts: IncludedSaltsSelection
  calciumChlorideGramsPerGallon?: string
  ureaNitrogenPercent?: string
}

/** The guaranteed-analysis percentage fields a part declares on its label. */
const MACRO_ANALYSIS_FIELDS = [
  "nitrogen",
  "phosphate",
  "potash",
  "calcium",
  "magnesium",
  "sulfur",
] as const

const MICRO_ANALYSIS_FIELDS = [
  "iron",
  "manganese",
  "zinc",
  "boron",
  "copper",
  "molybdenum",
] as const

type AnalysisField = (typeof MACRO_ANALYSIS_FIELDS)[number] | (typeof MICRO_ANALYSIS_FIELDS)[number]

const ANALYSIS_FIELDS: readonly AnalysisField[] = [...MACRO_ANALYSIS_FIELDS, ...MICRO_ANALYSIS_FIELDS]

interface SaltAnalysisRequirement {
  /** Every one of these must be declared on the part. */
  all?: readonly AnalysisField[]
  /** At least one of these must be declared on the part. */
  any?: readonly AnalysisField[]
}

/**
 * What a part's own label has to declare for a salt to plausibly be in THAT
 * part. Used only to narrow a salt selection that isn't per-part in the first
 * place (see `narrowSaltsToPartAnalysis`) — it can remove a salt from a part,
 * never add one, so it can't invent an ingredient the grower didn't list.
 *
 * The requirement is the element the salt is bought to supply, not every
 * element it contains. Potassium Sulfate asks for Potassium but not Sulfur,
 * and Magnesium Sulfate for Magnesium but not Sulfur, because plenty of
 * labels declare the cation and leave Sulfur off entirely — demanding it
 * would throw away salts that really are in the bottle. Nitrogen is required
 * alongside the cation for the nitrate salts since a bottle with no declared
 * Nitrogen cannot be sourcing its Calcium or Magnesium from one.
 */
const SALT_ANALYSIS_REQUIREMENTS: Record<keyof IncludedSaltsSelection, SaltAnalysisRequirement> = {
  calciumNitrate: { all: ["calcium", "nitrogen"] },
  calciumCarbonate: { all: ["calcium"] },
  calciumChloride: { all: ["calcium"] },
  calciumAcetate: { all: ["calcium"] },
  calciumGluconate: { all: ["calcium"] },
  potassiumNitrate: { all: ["potash", "nitrogen"] },
  urea: { all: ["nitrogen"] },
  potassiumSulfate: { all: ["potash"] },
  monoPotassiumPhosphate: { all: ["phosphate"] },
  monoAmmoniumPhosphate: { all: ["phosphate"] },
  magnesiumSulfate: { all: ["magnesium"] },
  magnesiumNitrate: { all: ["magnesium", "nitrogen"] },
  ammoniumNitrateOrSulfate: { all: ["nitrogen"] },
  chelatedMicronutrients: { any: MICRO_ANALYSIS_FIELDS },
}

const SALT_IDS: Array<keyof IncludedSaltsSelection> = SALT_CHECKBOX_OPTIONS.map((option) => option.id)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** True when the grower checked at least one salt — an empty selection carries no information. */
function hasAnySalt(selection: IncludedSaltsSelection): boolean {
  return SALT_IDS.some((id) => selection[id])
}

/**
 * Guaranteed-analysis values are strings because they're bound straight to
 * text inputs. A round-trip through JSON (or through a consumer that parses
 * them) can hand a number back, which would make the input uncontrolled.
 */
function asAnalysisString(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return ""
}

function asOptionalAnalysisString(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

/**
 * Read a salt selection out of saved data, tolerating the shapes earlier
 * versions wrote. Returns null when there's nothing usable, so callers can
 * fall through to their next source rather than acting on an empty selection.
 *
 * A selection with every box false counts as nothing usable: the Guaranteed
 * Analysis screen won't let a grower past a part with no salts checked, so a
 * save can't legitimately contain one, and treating it as real would leave a
 * part stuck on that validation with no way to know what it should have been.
 */
export function readIncludedSalts(raw: unknown): IncludedSaltsSelection | null {
  if (!isRecord(raw)) return null

  const selection: IncludedSaltsSelection = { ...DEFAULT_INCLUDED_SALTS }
  let sawKnownKey = false

  for (const id of SALT_IDS) {
    if (!(id in raw)) continue
    sawKnownKey = true
    selection[id] = raw[id] === true
  }

  // Pre-refactor saves had a single `ironChelate` box where the six
  // micronutrients are now one option; carry it forward as the full package.
  // `other`/`otherText` were dropped outright and are ignored above.
  if (raw.ironChelate === true) {
    sawKnownKey = true
    selection.chelatedMicronutrients = true
  }

  if (!sawKnownKey) return null
  return hasAnySalt(selection) ? selection : null
}

/** Does this part's own guaranteed analysis declare `field`? */
function declaresAnalysisField(part: PartAnalysis, field: AnalysisField): boolean {
  return parsePositive(part[field]) > 0
}

/**
 * Cut a salt selection that didn't come from this part down to the salts its
 * own label could actually be sourcing (`SALT_ANALYSIS_REQUIREMENTS`).
 *
 * This is the fallback for saves that never recorded per-part salts, where
 * the only selection available describes the whole formulation. Handing that
 * to every part is what used to make a reloaded 4-part line show the same
 * broad salt list on all four bottles — a Calcium-only Part A claiming the
 * Monopotassium Phosphate that was really Part B's. Narrowing can't recover
 * which part a salt came from, but it does keep each part to salts consistent
 * with the analysis the grower saved for that part.
 */
export function narrowSaltsToPartAnalysis(
  selection: IncludedSaltsSelection,
  part: PartAnalysis
): IncludedSaltsSelection {
  const narrowed: IncludedSaltsSelection = { ...DEFAULT_INCLUDED_SALTS }

  for (const id of SALT_IDS) {
    if (!selection[id]) continue

    const requirement = SALT_ANALYSIS_REQUIREMENTS[id]
    const meetsAll = (requirement.all ?? []).every((field) => declaresAnalysisField(part, field))
    const meetsAny =
      requirement.any === undefined || requirement.any.some((field) => declaresAnalysisField(part, field))
    if (!meetsAll || !meetsAny) continue

    // Urea's Nitrogen contribution can't be inferred from the rest of the
    // label, so the Guaranteed Analysis screen makes "% Urea Nitrogen"
    // mandatory whenever it's checked. A selection that isn't this part's own
    // has no such percentage to go with it, so checking Urea here would only
    // block the grower on a validation error about a box they didn't tick.
    if (id === "urea" && parsePositive(part.ureaNitrogenPercent) <= 0) continue

    narrowed[id] = true
  }

  return narrowed
}

/** Per-part inputs for the save payload — see `SavedPartSalts`. */
export function buildSavedPartSalts(partsAnalysis: PartAnalysis[]): SavedPartSalts[] {
  return partsAnalysis.map((part) => ({
    partId: part.id,
    partName: part.name,
    includedSalts: { ...DEFAULT_INCLUDED_SALTS, ...part.includedSalts },
    calciumChlorideGramsPerGallon: part.calciumChlorideGramsPerGallon,
    ureaNitrogenPercent: part.ureaNitrogenPercent,
  }))
}

function readSavedPartSalts(raw: unknown): SavedPartSalts[] {
  if (!Array.isArray(raw)) return []

  const entries: SavedPartSalts[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const includedSalts = readIncludedSalts(item.includedSalts)
    if (!includedSalts) continue
    entries.push({
      partId: typeof item.partId === "string" ? item.partId : "",
      partName: typeof item.partName === "string" ? item.partName : "",
      includedSalts,
      calciumChlorideGramsPerGallon: asOptionalAnalysisString(item.calciumChlorideGramsPerGallon),
      ureaNitrogenPercent: asOptionalAnalysisString(item.ureaNitrogenPercent),
    })
  }
  return entries
}

/**
 * Find the saved entry for a part. `partId` is authoritative; name and
 * position are only consulted when no id matches, for saves whose ids were
 * regenerated on the way through. Position alone is never enough to identify
 * a part when the counts differ.
 */
function matchSavedPartSalts(
  saved: SavedPartSalts[],
  part: PartAnalysis,
  index: number,
  partCount: number
): SavedPartSalts | undefined {
  const byId = saved.find((entry) => entry.partId !== "" && entry.partId === part.id)
  if (byId) return byId

  const named = saved.filter((entry) => entry.partName !== "" && entry.partName === part.name)
  if (named.length === 1) return named[0]

  if (saved.length === partCount) return saved[index]
  return undefined
}

/**
 * A saved formulation as this app wrote it, whether the fetch handed back the
 * formulation itself or a stored row wrapping it.
 */
export function unwrapSavedFormulation(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {}
  // `partsAnalysis` and `tanks` are the two things only the formulation body
  // has, so either one means we're already looking at it.
  if ("partsAnalysis" in raw || "tanks" in raw) return raw
  for (const key of ["data", "formulation"]) {
    const nested = raw[key]
    if (isRecord(nested)) return unwrapSavedFormulation(nested)
  }
  return raw
}

/**
 * Rebuild the Guaranteed Analysis screen's parts from a saved formulation,
 * resolving each part's salts from the most specific source that save has:
 *
 *   1. the part's own `includedSalts` inside `partsAnalysis`,
 *   2. its entry in the top-level `partSalts` list,
 *   3. failing both, the formulation-wide selection narrowed to what this
 *      part's own analysis declares (`narrowSaltsToPartAnalysis`).
 *
 * Nothing here copies one part's salts onto another, and a part left with no
 * salts is left that way — the screen already asks the grower to pick, which
 * is a far better outcome than a checkbox list they have to audit against a
 * bottle to discover it's wrong.
 *
 * Returns null when the save has no parts to rebuild, so the caller can leave
 * the calculator's own initial state alone.
 */
export function hydrateSavedPartsAnalysis(saved: Record<string, unknown>): PartAnalysis[] | null {
  const rawParts = saved.partsAnalysis
  if (!Array.isArray(rawParts) || rawParts.length === 0) return null

  const rawPartRecords = rawParts.filter(isRecord)
  if (rawPartRecords.length === 0) return null

  const savedPartSalts = readSavedPartSalts(saved.partSalts)
  // Pre-per-part saves recorded one selection for the whole formulation. It's
  // still the best evidence available for those, but only after narrowing.
  const formulationWideSalts = readIncludedSalts(saved.includedSalts)

  const parts: PartAnalysis[] = rawPartRecords.map((rawPart, index) => {
    const part: PartAnalysis = {
      id: typeof rawPart.id === "string" && rawPart.id !== "" ? rawPart.id : `saved-part-${index}`,
      name: typeof rawPart.name === "string" && rawPart.name !== "" ? rawPart.name : `Part ${index + 1}`,
      nitrogen: "",
      phosphate: "",
      potash: "",
      calcium: "",
      magnesium: "",
      sulfur: "",
      iron: "",
      manganese: "",
      zinc: "",
      boron: "",
      copper: "",
      molybdenum: "",
      includedSalts: { ...DEFAULT_INCLUDED_SALTS },
      calciumChlorideGramsPerGallon: asOptionalAnalysisString(rawPart.calciumChlorideGramsPerGallon),
      ureaNitrogenPercent: asOptionalAnalysisString(rawPart.ureaNitrogenPercent),
    }
    for (const field of ANALYSIS_FIELDS) {
      part[field] = asAnalysisString(rawPart[field])
    }
    return part
  })

  return parts.map((part, index) => {
    const own = readIncludedSalts(rawPartRecords[index].includedSalts)
    if (own) return { ...part, includedSalts: own }

    const matched = matchSavedPartSalts(savedPartSalts, part, index, parts.length)
    if (matched) {
      return {
        ...part,
        includedSalts: matched.includedSalts,
        calciumChlorideGramsPerGallon:
          part.calciumChlorideGramsPerGallon ?? matched.calciumChlorideGramsPerGallon,
        ureaNitrogenPercent: part.ureaNitrogenPercent ?? matched.ureaNitrogenPercent,
      }
    }

    if (formulationWideSalts) {
      return { ...part, includedSalts: narrowSaltsToPartAnalysis(formulationWideSalts, part) }
    }

    return part
  })
}

const SAVED_DOSE_UNITS: readonly DoseUnit[] = [
  "ml_per_gallon",
  "g_per_gallon",
  "ml_per_10L",
  "g_per_10L",
  // Written only by saves from the first liters mode, when the feed chart was
  // read per litre rather than per 10 L — see `migrateLegacyDoseUnit`, which is
  // what stops one of these coming back a tenth as strong.
  "ml_per_liter",
  "g_per_liter",
]

/**
 * A dose's unit as saved. Metric rates only exist in saves written after the
 * volume preference was added, so anything unrecognized — including a save
 * that predates the field entirely — falls back to dry grams per gallon, the
 * basis the calculator started with.
 */
function asDoseUnit(raw: unknown): DoseUnit {
  return SAVED_DOSE_UNITS.find((unit) => unit === raw) ?? "g_per_gallon"
}

/**
 * Rebuild the Feeding Rates screen's parts, coercing doses back to input
 * strings and re-quoting any legacy per-litre rate onto the per-10 L basis the
 * chart input reads today (see `migrateLegacyDoseUnit`).
 */
export function hydrateSavedFeedingParts(saved: Record<string, unknown>): NutrientPart[] | null {
  const rawParts = saved.parts
  if (!Array.isArray(rawParts) || rawParts.length === 0) return null

  const parts = rawParts.filter(isRecord).map((rawPart, index) => ({
    id: typeof rawPart.id === "string" && rawPart.id !== "" ? rawPart.id : `saved-part-${index}`,
    name: typeof rawPart.name === "string" && rawPart.name !== "" ? rawPart.name : `Part ${index + 1}`,
    ...migrateLegacyDoseUnit(asAnalysisString(rawPart.dose), asDoseUnit(rawPart.unit)),
  }))

  return parts.length > 0 ? parts : null
}
