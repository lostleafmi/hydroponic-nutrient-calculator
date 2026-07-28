/**
 * Fidelity check: do the stock-tank salt amounts the solver hands the grower
 * actually deliver the elemental ppm the "What your plants will get" screen
 * displays?
 *
 * The displayed targets come from the guaranteed-analysis percentages
 * (`calculateElementalTargets`); the tank amounts come from the solver
 * (`calculateStockTankRecipe`). Nothing previously checked that the second
 * reproduces the first, so this script reconstructs the delivered ppm from the
 * resolved grams (`elementalPpmFromSaltAmounts`) and diffs the two for every
 * recipe layout.
 *
 * Run with: npm run verify:ppm
 */

import { calculateRecipeAction, type CalculateRecipeResult } from "@/app/actions/calculate-recipe"
import type { PartAnalysis } from "@/components/hydro-calc/guaranteed-analysis-screen"
import type { NutrientPart, StockTankOption } from "@/components/hydro-calc/feeding-rates-screen"
import {
  DEFAULT_INCLUDED_SALTS,
  elementalPpmFromSaltAmounts,
  emptySaltAmounts,
  isWithinMatchTolerance,
  RAW_SALTS,
  SALT_DISPLAY_ORDER,
  sumSaltAmounts,
  type ElementalTargets,
  type IncludedSaltsSelection,
  type SaltAmounts,
  type SaltKey,
} from "@/lib/hydro-calc/recipe-types"

const STOCK_VOLUME_LITERS = 5
const DILUTION_RATIO = 100

/** Macros the report holds to a tight tolerance; micros are listed separately. */
const MACRO_KEYS: Array<keyof ElementalTargets> = [
  "nitrogen",
  "phosphorus",
  "potassium",
  "calcium",
  "magnesium",
  "sulfur",
]

const MICRO_KEYS: Array<keyof ElementalTargets> = [
  "iron",
  "manganese",
  "zinc",
  "boron",
  "copper",
  "molybdenum",
]

const ELEMENT_SYMBOLS: Record<keyof ElementalTargets, string> = {
  nitrogen: "N",
  phosphorus: "P",
  potassium: "K",
  calcium: "Ca",
  magnesium: "Mg",
  sulfur: "S",
  iron: "Fe",
  manganese: "Mn",
  zinc: "Zn",
  boron: "B",
  copper: "Cu",
  molybdenum: "Mo",
}

function salts(...checked: Array<keyof IncludedSaltsSelection>): IncludedSaltsSelection {
  const selection = { ...DEFAULT_INCLUDED_SALTS }
  for (const key of checked) selection[key] = true
  return selection
}

interface Scenario {
  name: string
  partsAnalysis: PartAnalysis[]
  parts: NutrientPart[]
  stockTankOption: StockTankOption
  /**
   * Set for labels whose ratios ARE exactly buildable from the checked salts.
   * The refinement must find the zero-residual solution in those cases, so any
   * deviation at all is a bug in the fit rather than an unbuildable label.
   */
  expectExactMatch?: boolean
  /** Salts that must not appear at all — e.g. an unchecked salt the fit must not invent. */
  expectAbsent?: SaltKey[]
}

/**
 * The reported 3-part case: a Part A / Part B / Part C line where Potassium
 * Sulfate is checked on both B and C, yet came back at 0 g with extra KNO₃ and
 * MKP standing in for it.
 */
const REPORTED_THREE_PART: Scenario = {
  name: "Reported 3-part case (K₂SO₄ checked on Parts B and C)",
  partsAnalysis: [
    {
      id: "a",
      name: "Part A",
      nitrogen: "14",
      phosphate: "",
      potash: "8",
      calcium: "14",
      magnesium: "",
      sulfur: "",
      iron: "0.35",
      manganese: "0.1",
      zinc: "0.05",
      boron: "0.05",
      copper: "0.05",
      molybdenum: "0.003",
      includedSalts: salts("calciumNitrate", "potassiumNitrate", "chelatedMicronutrients"),
    },
    {
      id: "b",
      name: "Part B",
      nitrogen: "2",
      phosphate: "13",
      potash: "17",
      calcium: "",
      magnesium: "5",
      sulfur: "7",
      iron: "",
      manganese: "",
      zinc: "",
      boron: "",
      copper: "",
      molybdenum: "",
      includedSalts: salts(
        "magnesiumSulfate",
        "monoPotassiumPhosphate",
        "potassiumNitrate",
        "potassiumSulfate"
      ),
    },
    {
      id: "c",
      name: "Part C",
      nitrogen: "",
      phosphate: "35",
      potash: "29",
      calcium: "",
      magnesium: "1.5",
      sulfur: "4",
      iron: "",
      manganese: "",
      zinc: "",
      boron: "",
      copper: "",
      molybdenum: "",
      includedSalts: salts(
        "magnesiumSulfate",
        "monoPotassiumPhosphate",
        "potassiumNitrate",
        "potassiumSulfate"
      ),
    },
  ],
  parts: [
    { id: "a", name: "Part A", dose: "4.9", unit: "g_per_gallon" },
    { id: "b", name: "Part B", dose: "3.3", unit: "g_per_gallon" },
    { id: "c", name: "Part C", dose: "3.3", unit: "g_per_gallon" },
  ],
  stockTankOption: "separate",
}

/**
 * Regression guards around the reported case: the same inputs with Potassium
 * Sulfate left unchecked (the auto-add fallback must still work), and a
 * two-part Core+Bloom line where Calcium Nitrate is the only Nitrogen source.
 */
const K2SO4_UNCHECKED: Scenario = {
  name: "Same 3-part line with K₂SO₄ NOT checked (auto-add fallback)",
  partsAnalysis: REPORTED_THREE_PART.partsAnalysis.map((part) => ({
    ...part,
    includedSalts: { ...part.includedSalts, potassiumSulfate: false },
  })),
  parts: REPORTED_THREE_PART.parts,
  stockTankOption: "separate",
}

const CORE_BLOOM_TWO_PART: Scenario = {
  name: "Two-part Core + Bloom (Ca(NO₃)₂ is the only N source in Part A)",
  partsAnalysis: [
    {
      id: "a",
      name: "Core",
      nitrogen: "5",
      phosphate: "",
      potash: "4",
      calcium: "6",
      magnesium: "",
      sulfur: "",
      iron: "0.2",
      manganese: "",
      zinc: "",
      boron: "",
      copper: "",
      molybdenum: "",
      includedSalts: salts("calciumNitrate", "potassiumNitrate", "chelatedMicronutrients"),
    },
    {
      id: "b",
      name: "Bloom",
      nitrogen: "1",
      phosphate: "5",
      potash: "4",
      calcium: "",
      magnesium: "1.5",
      sulfur: "2",
      iron: "",
      manganese: "",
      zinc: "",
      boron: "",
      copper: "",
      molybdenum: "",
      includedSalts: salts("magnesiumSulfate", "monoPotassiumPhosphate", "potassiumNitrate"),
    },
  ],
  parts: [
    { id: "a", name: "Core", dose: "8", unit: "g_per_gallon" },
    { id: "b", name: "Bloom", dose: "8", unit: "g_per_gallon" },
  ],
  stockTankOption: "separate",
}

/**
 * The critical no-regression case: a label reverse-engineered from real salt
 * blends, so its ratios are exactly buildable from the salts checked.
 *
 *   Part A — 100% Ca(NO₃)₂            → 16.9% Ca, 11.8% N
 *   Part B — 40% MKP / 30% KNO₃ / 30% MgSO₄
 *            P  0.40 × 0.228 = 9.12%  → 20.90% P₂O₅
 *            K  0.40 × 0.287 + 0.30 × 0.387 = 23.09% → 27.82% K₂O
 *            N  0.30 × 0.139 = 4.17%
 *            Mg 0.30 × 0.099 = 2.97%
 *            S  0.30 × 0.130 = 3.90%
 *
 * Every target is reachable simultaneously, so the sequential pass already had
 * zero residual and the refinement must leave it alone. This is what proves the
 * fit only touches recipes that were already wrong.
 */
const EXACTLY_BUILDABLE_TWO_PART: Scenario = {
  name: "Exactly buildable 2-part line (refinement must be a no-op)",
  partsAnalysis: [
    {
      id: "a",
      name: "Part A",
      nitrogen: "11.8",
      phosphate: "",
      potash: "",
      calcium: "16.9",
      magnesium: "",
      sulfur: "",
      iron: "0.2",
      manganese: "",
      zinc: "",
      boron: "",
      copper: "",
      molybdenum: "",
      includedSalts: salts("calciumNitrate", "chelatedMicronutrients"),
    },
    {
      id: "b",
      name: "Part B",
      nitrogen: "4.17",
      phosphate: "20.90",
      potash: "27.82",
      calcium: "",
      magnesium: "2.97",
      sulfur: "3.90",
      iron: "",
      manganese: "",
      zinc: "",
      boron: "",
      copper: "",
      molybdenum: "",
      includedSalts: salts("monoPotassiumPhosphate", "potassiumNitrate", "magnesiumSulfate"),
    },
  ],
  parts: [
    { id: "a", name: "Part A", dose: "5", unit: "g_per_gallon" },
    { id: "b", name: "Part B", dose: "5", unit: "g_per_gallon" },
  ],
  stockTankOption: "separate",
  expectExactMatch: true,
  // Nothing is short, so the fit has no reason to reach for the sulfate salt —
  // and it isn't checked, so it must not appear even as a fallback.
  expectAbsent: ["potassiumSulfate", "ammoniumSulfate", "monoAmmoniumPhosphate"],
}

/**
 * Ammonium Nitrate checked ALONGSIDE Calcium Nitrate means "replicate a
 * calcium ammonium nitrate double salt", which locks the two into a fixed 5:1
 * mole ratio. The refinement treats the pair as a single variable, so it may
 * resize the product but must never break that ratio.
 */
const CALCIUM_AMMONIUM_DOUBLE_SALT: Scenario = {
  name: "Calcium ammonium nitrate double salt (5:1 ratio must survive refinement)",
  partsAnalysis: [
    {
      id: "a",
      name: "Part A",
      nitrogen: "15.5",
      phosphate: "",
      potash: "",
      calcium: "19",
      magnesium: "",
      sulfur: "",
      iron: "",
      manganese: "",
      zinc: "",
      boron: "",
      copper: "",
      molybdenum: "",
      includedSalts: salts("calciumNitrate", "ammoniumNitrateOrSulfate"),
    },
  ],
  parts: [{ id: "a", name: "Part A", dose: "5", unit: "g_per_gallon" }],
  stockTankOption: "separate",
}

/**
 * MKP and MAP both enabled alongside KNO₃ — the one case the sequential pass
 * already solved as a linear blend (see `mkpShareOfPhosphorus`). The refinement
 * shouldn't fight it.
 */
const MKP_MAP_BLEND: Scenario = {
  name: "MKP + MAP blend with KNO₃",
  partsAnalysis: [
    {
      id: "a",
      name: "Part A",
      nitrogen: "9",
      phosphate: "12",
      potash: "14",
      calcium: "5",
      magnesium: "2",
      sulfur: "2.6",
      iron: "0.15",
      manganese: "0.05",
      zinc: "0.02",
      boron: "0.02",
      copper: "0.01",
      molybdenum: "0.001",
      includedSalts: salts(
        "calciumNitrate",
        "potassiumNitrate",
        "monoPotassiumPhosphate",
        "monoAmmoniumPhosphate",
        "magnesiumSulfate",
        "potassiumSulfate",
        "chelatedMicronutrients"
      ),
    },
  ],
  parts: [{ id: "a", name: "Part A", dose: "6", unit: "g_per_gallon" }],
  stockTankOption: "separate",
}

/**
 * No Sulfur on the label — common, since Sulfur often isn't a required label
 * field. The Sulfur target is then filled in from whatever sulfate the recipe
 * ends up containing (`saltDerivedSulfurPpm`), which means the solver runs
 * twice: once with Sulfur excluded from the fit to discover that amount, then
 * again with it included. Those two passes have to agree, or the Sulfur figure
 * on screen would describe a recipe the tanks don't contain.
 */
const NO_DECLARED_SULFUR: Scenario = {
  name: "No declared Sulfur (salt-derived Sulfur must stay self-consistent)",
  partsAnalysis: [
    {
      id: "a",
      name: "Part A",
      nitrogen: "8",
      phosphate: "5",
      potash: "12",
      calcium: "4",
      magnesium: "2",
      sulfur: "",
      iron: "0.1",
      manganese: "0.05",
      zinc: "0.02",
      boron: "0.02",
      copper: "0.01",
      molybdenum: "",
      includedSalts: salts(
        "calciumNitrate",
        "potassiumNitrate",
        "monoPotassiumPhosphate",
        "magnesiumSulfate",
        "potassiumSulfate",
        "chelatedMicronutrients"
      ),
    },
  ],
  parts: [{ id: "a", name: "Part A", dose: "6", unit: "g_per_gallon" }],
  stockTankOption: "separate",
}

/**
 * Amounts the grower physically declared — a literal Calcium Chloride
 * feed-chart dose, and a label's own % Urea Nitrogen — must be held fixed
 * rather than refitted (see `buildRefinementVariables`).
 */
const DECLARED_DOSES_HELD_FIXED: Scenario = {
  name: "Literal CaCl₂ dose + declared % Urea Nitrogen (both held fixed)",
  partsAnalysis: [
    {
      id: "a",
      name: "Part A",
      nitrogen: "15.5",
      phosphate: "",
      potash: "",
      calcium: "19",
      magnesium: "",
      sulfur: "",
      iron: "",
      manganese: "",
      zinc: "",
      boron: "",
      copper: "",
      molybdenum: "",
      includedSalts: salts("calciumNitrate", "calciumChloride"),
      calciumChlorideGramsPerGallon: "0.25",
    },
    {
      id: "b",
      // Label reads "8% total N, of which 3% is Urea Nitrogen" — the two fields
      // are additive (see `calculateElementalTargets`), so the main %N field
      // carries only the non-urea 5%.
      name: "Part B",
      nitrogen: "5",
      phosphate: "6",
      potash: "10",
      calcium: "",
      magnesium: "2",
      sulfur: "2.6",
      iron: "0.15",
      manganese: "",
      zinc: "",
      boron: "",
      copper: "",
      molybdenum: "",
      includedSalts: salts(
        "urea",
        "monoPotassiumPhosphate",
        "potassiumNitrate",
        "magnesiumSulfate",
        "potassiumSulfate",
        "chelatedMicronutrients"
      ),
      ureaNitrogenPercent: "3",
    },
  ],
  parts: [
    { id: "a", name: "Part A", dose: "2.5", unit: "g_per_gallon" },
    { id: "b", name: "Part B", dose: "5", unit: "g_per_gallon" },
  ],
  stockTankOption: "separate",
}

/** A layout's resolved salts, flattened to one comparable set. */
interface ResolvedLayout {
  label: string
  salts: SaltAmounts
  /** Direct-mix amounts are already at working strength (see calculateDirectMixRecipe). */
  dilutionRatio: number
  /** What the layout itself reports it delivers — cross-checked against the salts. */
  reported: ElementalTargets
}

function resolvedLayouts(result: CalculateRecipeResult): ResolvedLayout[] {
  const carbonate = (grams: number | undefined): SaltAmounts => {
    const set = emptySaltAmounts()
    set.calciumCarbonate = grams ?? 0
    return set
  }

  return [
    {
      label: "Separate Nitrogen (Tank 1 + Tank 2)",
      salts: sumSaltAmounts(
        result.threeTankRecipe.tank1,
        result.threeTankRecipe.tank2,
        carbonate(result.threeTankRecipe.directAddCalciumCarbonate?.grams)
      ),
      dilutionRatio: result.dilutionRatio,
      reported: result.threeTankRecipe.delivered,
    },
    {
      label: "One tank per part",
      salts: sumSaltAmounts(
        ...result.multiPartRecipe.tanks.map((tank) => tank.salts),
        carbonate(result.multiPartRecipe.directAddCalciumCarbonate?.grams)
      ),
      dilutionRatio: result.dilutionRatio,
      reported: result.multiPartRecipe.delivered,
    },
    {
      label: "Direct mix",
      salts: sumSaltAmounts(
        result.directRecipe.salts,
        carbonate(result.directRecipe.directAddCalciumCarbonate?.grams)
      ),
      dilutionRatio: 1,
      reported: result.directRecipe.delivered,
    },
  ]
}

function fmt(value: number): string {
  if (value === 0) return "0"
  if (Math.abs(value) < 0.01) return value.toExponential(2)
  return value.toFixed(2)
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${fmt(value)}`
}

function padRight(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length)
}

function padLeft(text: string, width: number): string {
  return text.length >= width ? text : " ".repeat(width - text.length) + text
}

function reportSalts(setLabel: string, amounts: SaltAmounts): void {
  const used = SALT_DISPLAY_ORDER.filter((key) => amounts[key] > 0)
  console.log(`    ${setLabel}:`)
  if (used.length === 0) {
    console.log("      (none)")
    return
  }
  for (const key of used) {
    console.log(`      ${padRight(RAW_SALTS[key].name, 34)} ${padLeft(amounts[key].toFixed(3), 10)} g`)
  }
}

/**
 * Two independent checks per layout:
 *
 *  1. The ppm the layout reports (what the screen displays) is reproducible
 *     from its own salt grams. A failure here means the panel is describing a
 *     recipe other than the one in the tank cards — the original bug.
 *  2. Those delivered ppm are within tolerance of what the label asked for.
 *     A failure here is a genuinely unbuildable ratio, which the recipe must
 *     then report as a deviation rather than pass off as a match.
 */
function reportLayout(
  layout: ResolvedLayout,
  labelTargets: ElementalTargets,
  reportedDeviations: Array<{ element: keyof ElementalTargets }>,
  saltVolumeLiters: number
): boolean {
  const delivered = elementalPpmFromSaltAmounts(layout.salts, saltVolumeLiters, layout.dilutionRatio)
  const declaredDeviations = new Set(reportedDeviations.map((deviation) => deviation.element))

  console.log(`\n  ${layout.label}`)
  console.log(
    `    ${padRight("element", 8)}${padLeft("label", 11)}${padLeft("delivered", 11)}${padLeft("on screen", 11)}${padLeft("diff", 10)}   status`
  )

  let allPass = true
  for (const key of [...MACRO_KEYS, ...MICRO_KEYS]) {
    const target = labelTargets[key]
    const actual = delivered[key]
    const onScreen = layout.reported[key]
    if (target === 0 && actual === 0) continue

    const isMacro = MACRO_KEYS.includes(key)
    const diff = actual - target
    const matchesLabel = isWithinMatchTolerance(key, actual, target)
    // The screen must always agree with the grams, to well inside display
    // precision — this one is a hard invariant, not a tolerance.
    const screenAgrees = Math.abs(onScreen - actual) < 1e-6

    let status: string
    if (!screenAgrees) {
      status = "SCREEN != GRAMS"
      allPass = false
    } else if (matchesLabel) {
      status = "ok"
    } else if (!isMacro) {
      status = "off (micro)"
    } else if (declaredDeviations.has(key)) {
      status = "off label, reported"
    } else {
      status = "OFF LABEL, UNREPORTED"
      allPass = false
    }

    console.log(
      `    ${padRight(ELEMENT_SYMBOLS[key], 8)}${padLeft(fmt(target), 11)}${padLeft(fmt(actual), 11)}${padLeft(fmt(onScreen), 11)}${padLeft(signed(diff), 10)}   ${status}`
    )
  }
  return allPass
}

async function runScenario(scenario: Scenario): Promise<boolean> {
  console.log(`\n${"=".repeat(88)}`)
  console.log(scenario.name)
  console.log(
    `Stock tank ${STOCK_VOLUME_LITERS} L at 1:${DILUTION_RATIO} — feed rates: ` +
      scenario.parts.map((part) => `${part.name} ${part.dose} g/gal`).join(", ")
  )
  console.log("=".repeat(88))

  const result = await calculateRecipeAction({
    partsAnalysis: scenario.partsAnalysis,
    parts: scenario.parts,
    stockTankOption: scenario.stockTankOption,
    stockVolumeLiters: STOCK_VOLUME_LITERS,
    dilutionRatio: DILUTION_RATIO,
  })

  console.log("\n  Label-derived elemental targets (from the guaranteed analysis + feed rates):")
  for (const key of [...MACRO_KEYS, ...MICRO_KEYS]) {
    if (result.targets[key] === 0) continue
    console.log(`    ${padRight(ELEMENT_SYMBOLS[key], 6)}${padLeft(fmt(result.targets[key]), 10)} ppm`)
  }

  const layouts = resolvedLayouts(result)
  reportSalts("Separate Nitrogen salt amounts", layouts[0].salts)

  // Requirement: a checked Potassium Sulfate must be used when it's *needed*.
  // "Needed" means the recipe under-delivers Potassium or Sulfur — the two
  // things K₂SO₄ supplies. Sitting at 0 g because both are already satisfied is
  // the right answer, not a dropped salt.
  const k2so4Checked = scenario.partsAnalysis.some((part) => part.includedSalts.potassiumSulfate)
  const k2so4Used = layouts[0].salts.potassiumSulfate > 0
  const k2so4Delivered = elementalPpmFromSaltAmounts(
    layouts[0].salts,
    result.stockVolumeLiters,
    layouts[0].dilutionRatio
  )
  const k2so4Needed =
    (["potassium", "sulfur"] as const).some(
      (element) =>
        result.targets[element] > 0 &&
        k2so4Delivered[element] < result.targets[element] &&
        !isWithinMatchTolerance(element, k2so4Delivered[element], result.targets[element])
    )
  if (k2so4Checked) {
    console.log(
      `\n    Potassium Sulfate checked: needed for K/S? ${k2so4Needed ? "yes" : "no"} — used? ` +
        `${k2so4Used ? `yes (${layouts[0].salts.potassiumSulfate.toFixed(3)} g)` : "no"}`
    )
  }

  const deviationsByLayout = [
    result.threeTankRecipe.deviations,
    result.multiPartRecipe.deviations,
    result.directRecipe.deviations,
  ]

  let allPass = true
  layouts.forEach((layout, index) => {
    if (!reportLayout(layout, result.targets, deviationsByLayout[index], result.stockVolumeLiters)) {
      allPass = false
    }
  })

  const warnings = result.threeTankRecipe.warnings ?? []
  if (warnings.length > 0) {
    console.log(`\n    no checked salt supplies: ${warnings.map((warning) => warning.label).join(", ")}`)
  }
  for (const note of result.threeTankRecipe.autoAddedSalts ?? []) {
    console.log(`    auto-added ${note.saltLabel} for ${note.elementLabel}`)
  }
  if (k2so4Checked && k2so4Needed && !k2so4Used) {
    console.log("\n    EXPECTED Potassium Sulfate to be used — it's checked and K/S run short")
    allPass = false
  }

  if (scenario.expectExactMatch) {
    for (const [index, layout] of layouts.entries()) {
      if (deviationsByLayout[index].length === 0) continue
      console.log(
        `\n    EXPECTED EXACT MATCH but ${layout.label} deviates on ` +
          deviationsByLayout[index].map((deviation) => deviation.label).join(", ")
      )
      allPass = false
    }
  }

  for (const saltKey of scenario.expectAbsent ?? []) {
    for (const layout of layouts) {
      if (layout.salts[saltKey] <= 0) continue
      console.log(
        `\n    EXPECTED ${RAW_SALTS[saltKey].name} to be unused, but ${layout.label} has ` +
          `${layout.salts[saltKey].toFixed(3)} g`
      )
      allPass = false
    }
  }

  console.log(`\n  RESULT: ${allPass ? "PASS" : "FAIL"}`)
  return allPass
}

async function main(): Promise<void> {
  const scenarios = [
    REPORTED_THREE_PART,
    K2SO4_UNCHECKED,
    CORE_BLOOM_TWO_PART,
    EXACTLY_BUILDABLE_TWO_PART,
    CALCIUM_AMMONIUM_DOUBLE_SALT,
    MKP_MAP_BLEND,
    NO_DECLARED_SULFUR,
    DECLARED_DOSES_HELD_FIXED,
  ]
  const results: boolean[] = []
  for (const scenario of scenarios) {
    results.push(await runScenario(scenario))
  }

  console.log(`\n${"=".repeat(88)}`)
  scenarios.forEach((scenario, index) => {
    console.log(`${results[index] ? "PASS" : "FAIL"}  ${scenario.name}`)
  })
  console.log("=".repeat(88))

  if (results.some((passed) => !passed)) process.exitCode = 1
}

void main()
