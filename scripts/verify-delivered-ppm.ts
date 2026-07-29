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
  CALCIUM_INCOMPATIBLE_SALTS,
  DEFAULT_INCLUDED_SALTS,
  elementalPpmFromSaltAmounts,
  emptySaltAmounts,
  getEnabledSaltKeys,
  isWithinMatchTolerance,
  RAW_SALTS,
  SALT_DISPLAY_ORDER,
  saltAmountsCarryTaperableNitrogen,
  saltFitsOneTank,
  sumSaltAmounts,
  TAPERABLE_NITROGEN_SALTS,
  TANK_1_SALTS,
  TANK_3_SALTS,
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

/** The salts that carry `MICRO_KEYS` — one per micronutrient. */
const MICRO_SALT_KEYS = new Set<SaltKey>(TANK_3_SALTS)

/**
 * The Calcium salts, which must all be in the Separate Nitrogen layout's Tank 1
 * and nowhere else.
 */
const TANK_1_SALT_KEYS = new Set<SaltKey>(TANK_1_SALTS)

/**
 * What Tank 1 must never hold besides the Calcium: the phosphate and sulfate
 * salts that precipitate it. Every other MACRO salt the host bottle declared is
 * fair game — Ammonium Nitrate included, now that `RAW_SALTS.calciumNitrate`
 * models the Ca(NO₃)₂/NH₄NO₃ double salt itself rather than being built from two
 * salts. Whether the micros may share it is a separate question that has nothing
 * to do with precipitation — see `reportSeparateNitrogenTaperability`.
 */
const CALCIUM_INCOMPATIBLE_SALT_KEYS = new Set<SaltKey>(CALCIUM_INCOMPATIBLE_SALTS)

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
 *   Part A — 100% Calcium Nitrate     → 19% Ca, 15.5% N
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
      nitrogen: "15.5",
      phosphate: "",
      potash: "",
      calcium: "19",
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
 * A CalciNit label — 15.5-0-0 + 19% Ca, exactly `RAW_SALTS.calciumNitrate`'s
 * own composition — with the ammonium box also checked. Calcium Nitrate alone
 * hits both targets, and since it already *is* the calcium ammonium nitrate
 * double salt there is no shortfall left for an ammonium salt to fill. So
 * neither may appear: adding NH₄NO₃ here would stack a second helping of
 * ammoniacal N onto a salt that already carries it, which is the bug the old
 * "replicate the double salt at a 5:1 ratio" split introduced.
 */
const CALCIUM_AMMONIUM_DOUBLE_SALT: Scenario = {
  name: "CalciNit label + ammonium checked (no stacked ammonium salt)",
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
  expectExactMatch: true,
  expectAbsent: ["ammoniumNitrate", "ammoniumSulfate"],
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

/**
 * The reported 3-part line with a fourth Cal-Mag bottle added, on Separate
 * Nitrogen. Past three parts this layout used to be refused outright, so this
 * covers both that it builds at all and that regrouping four independently
 * solved parts still adds up (see
 * `calculateSeparateNitrogenMultiPartRecipe`) — including a second Calcium
 * bottle pooling into the first, which is the case that decides which bottle
 * hosts the Calcium (Part A carries far more of it than the Cal-Mag topping it
 * up), and Magnesium Nitrate staying with its own part rather than landing
 * beside the phosphate it would precipitate with.
 */
const FOUR_PART_SEPARATE_NITROGEN: Scenario = {
  name: "4-part line on Separate Nitrogen (two Calcium bottles pooling into Tank 1)",
  partsAnalysis: [
    ...REPORTED_THREE_PART.partsAnalysis,
    {
      id: "d",
      name: "Cal Mag",
      nitrogen: "4",
      phosphate: "",
      potash: "",
      calcium: "5",
      magnesium: "3",
      sulfur: "",
      iron: "",
      manganese: "",
      zinc: "",
      boron: "",
      copper: "",
      molybdenum: "",
      includedSalts: salts("calciumNitrate", "magnesiumNitrate"),
    },
  ],
  parts: [
    ...REPORTED_THREE_PART.parts,
    { id: "d", name: "Cal Mag", dose: "2", unit: "g_per_gallon" },
  ],
  stockTankOption: "separate",
}

/**
 * The one 3-part line that can't come back as 3 tanks: its Calcium bottle
 * carries Magnesium Sulfate as well, so that bottle can't hold the pooled
 * Calcium — the two would precipitate as gypsum at stock strength. Keeping the
 * Calcium isolated then costs a fourth tank, and that's the right answer:
 * Separate Nitrogen exists to isolate the Calcium, and the grower who'd rather
 * have three tanks with Calcium and sulfate together already has the per-part
 * layout for that.
 *
 * Here to pin down which of the two rules gives way. Everything else about the
 * layout is arranged to hold the tank count to the part count, so it matters
 * that chemistry still outranks it (see `pickCalciumHost`).
 */
const CALCIUM_BOTTLE_CARRIES_SULFATE: Scenario = {
  name: "3-part line whose Calcium bottle also carries MgSO₄ (Calcium stays isolated)",
  partsAnalysis: [
    {
      id: "a",
      name: "Cal Mag",
      // 31.6% Ca(NO₃)₂ + 20.2% MgSO₄ — Ca 6%, N 4.9%, Mg 2%, S 2.6%.
      nitrogen: "4.9",
      phosphate: "",
      potash: "",
      calcium: "6",
      magnesium: "2",
      sulfur: "2.6",
      iron: "",
      manganese: "",
      zinc: "",
      boron: "",
      copper: "",
      molybdenum: "",
      includedSalts: salts("calciumNitrate", "magnesiumSulfate"),
    },
    {
      id: "b",
      name: "PK Base",
      nitrogen: "",
      phosphate: "52.3",
      potash: "34.6",
      calcium: "",
      magnesium: "",
      sulfur: "",
      iron: "",
      manganese: "",
      zinc: "",
      boron: "",
      copper: "",
      molybdenum: "",
      includedSalts: salts("monoPotassiumPhosphate"),
    },
    {
      id: "c",
      name: "K Base",
      nitrogen: "13.9",
      phosphate: "",
      potash: "46.6",
      calcium: "",
      magnesium: "",
      sulfur: "",
      iron: "",
      manganese: "",
      zinc: "",
      boron: "",
      copper: "",
      molybdenum: "",
      includedSalts: salts("potassiumNitrate"),
    },
  ],
  parts: [
    { id: "a", name: "Cal Mag", dose: "3", unit: "g_per_gallon" },
    { id: "b", name: "PK Base", dose: "1.5", unit: "g_per_gallon" },
    { id: "c", name: "K Base", dose: "2", unit: "g_per_gallon" },
  ],
  stockTankOption: "separate",
}

/**
 * A three-part line where no bottle's non-Calcium salts are Nitrogen-free, so
 * the micronutrients have no Nitrogen-free macro tank to ride in — the case that
 * exercises the fallback, and the one that used to buy a fourth tank.
 *
 * Part A is the Calcium bottle (Ca(NO₃)₂ + KNO₃) and carries the micro package.
 * Part B is a P/K/Mg bottle that also lists KNO₃, so it absorbs Part A's KNO₃
 * when the Nitrogen is gathered and still carries Nitrogen afterwards. Part C is
 * a MAP-only phosphate booster, whose Nitrogen is ammoniacal and rides along
 * with the Phosphorus it was bought for — the kind of Nitrogen
 * `TAPERABLE_NITROGEN_SALTS` deliberately leaves where it is.
 *
 * The micros go to the Calcium tank. Gathering the KNO₃ into Part B leaves that
 * tank holding nothing but Ca(NO₃)₂, whose Nitrogen isn't what a grower reaches
 * for when tapering — cutting it means giving up Calcium, the thing this layout
 * exists to protect. So the micros sit in a tank that's held steady, in the
 * conventional Tank A arrangement, and the line still comes back as three tanks
 * for three parts.
 */
const EVERY_BOTTLE_CARRIES_NITROGEN: Scenario = {
  name: "3-part line where no bottle is N-free (micros fall back to the Calcium tank)",
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
      // 100% MAP: P 26.9% → 61.7% P₂O₅, N 12.2%.
      name: "P Booster",
      nitrogen: "12.2",
      phosphate: "61.7",
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
      includedSalts: salts("monoAmmoniumPhosphate"),
    },
  ],
  parts: [
    { id: "a", name: "Part A", dose: "4.9", unit: "g_per_gallon" },
    { id: "b", name: "Part B", dose: "3.3", unit: "g_per_gallon" },
    { id: "c", name: "P Booster", dose: "1.5", unit: "g_per_gallon" },
  ],
  stockTankOption: "separate",
}

/**
 * Three parts whose salt lists share nothing, run through the per-part layout:
 * a Calcium bottle, a P/K bottle and a Mg/S bottle. Every element has exactly
 * one part that can legally supply it, so any cross-bottle borrowing shows up
 * immediately (see `reportPerPartSaltContainment`) instead of hiding inside a
 * plausible-looking total.
 */
const PER_PART_ISOLATION: Scenario = {
  name: "3 parts with disjoint salt lists (per-part tanks must not borrow across bottles)",
  partsAnalysis: [
    {
      id: "a",
      name: "Cal Base",
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
      includedSalts: salts("calciumNitrate"),
    },
    {
      id: "b",
      name: "PK Base",
      nitrogen: "",
      phosphate: "52.3",
      potash: "34.6",
      calcium: "",
      magnesium: "",
      sulfur: "",
      iron: "",
      manganese: "",
      zinc: "",
      boron: "",
      copper: "",
      molybdenum: "",
      includedSalts: salts("monoPotassiumPhosphate"),
    },
    {
      id: "c",
      name: "Mag Sulfur",
      nitrogen: "",
      phosphate: "",
      potash: "",
      calcium: "",
      magnesium: "9.9",
      sulfur: "13",
      iron: "0.2",
      manganese: "0.05",
      zinc: "0.02",
      boron: "0.02",
      copper: "0.01",
      molybdenum: "0.001",
      includedSalts: salts("magnesiumSulfate", "chelatedMicronutrients"),
    },
  ],
  parts: [
    { id: "a", name: "Cal Base", dose: "4", unit: "g_per_gallon" },
    { id: "b", name: "PK Base", dose: "1.5", unit: "g_per_gallon" },
    { id: "c", name: "Mag Sulfur", dose: "3", unit: "g_per_gallon" },
  ],
  stockTankOption: "per-part",
  // Each part's label is exactly its one salt, so every tank has a
  // zero-residual solution and the per-part totals must land on the label.
  expectExactMatch: true,
}

/**
 * The per-part layout is the high-fidelity replication path for a multi-part
 * line: each tank must be buildable from nothing but the part it represents,
 * so a macro salt checked on Part B can never quietly show up in Part A's tank
 * to help balance the recipe overall. That independence is the whole reason the
 * layout tracks the original bottles more closely than the combined ones, and
 * it's invisible in the ppm table above — a tank that borrowed a neighbour's
 * salt would still deliver a perfectly plausible total.
 *
 * Scoped to macros, because micronutrients are deliberately NOT part-faithful:
 * a label that declares no anchorable micro gets a whole balanced package
 * invented for it (see `applyMicroEstimates`), and the doser variant pools
 * every part's micros into one shared tank on purpose. Micro grams therefore
 * say nothing about whether the parts were kept independent.
 */
function reportPerPartSaltContainment(
  result: CalculateRecipeResult,
  scenario: Scenario
): boolean {
  const analysisById = new Map(scenario.partsAnalysis.map((part) => [part.id, part]))
  // One documented exception among the macros: an element that NO checked salt
  // on the part can supply. The solver reaches for a fallback there rather than
  // leave the target unmet, and reports it as a `SaltAutoAddNote`.
  const autoAdded = new Set(
    (result.multiPartRecipe.autoAddedSalts ?? []).map((note) => note.saltKey)
  )
  const macroKeys = SALT_DISPLAY_ORDER.filter((key) => !MICRO_SALT_KEYS.has(key))

  let allPass = true
  for (const tank of result.multiPartRecipe.tanks) {
    // The doser variant's consolidated micro tank holds nothing but micros, so
    // there's no single part to hold it to.
    if (tank.isMicroTank) continue

    const analysis = analysisById.get(tank.partId)
    if (!analysis) continue

    const allowed = getEnabledSaltKeys(analysis.includedSalts)
    const foreign = macroKeys.filter(
      (key) => tank.salts[key] > 0 && !allowed.has(key) && !autoAdded.has(key)
    )
    if (foreign.length === 0) continue

    console.log(
      `\n    ${tank.name} (${tank.partName}) holds macro salts not checked on that part: ` +
        foreign.map((key) => `${RAW_SALTS[key].name} ${tank.salts[key].toFixed(3)} g`).join(", ")
    )
    allPass = false
  }

  return allPass
}

/**
 * The three things that decide whether the taper tool actually works, checked on
 * every scenario regardless of part count or layout.
 *
 * 1. No micronutrient-only tank. There's no such product and no reason to mix
 *    one: a grower buys chelates inside a bottle that carries macros too, and an
 *    extra tank to weigh a few grams into is pure overhead. Micros belong beside
 *    the recipe's Nitrogen-free macros — MKP, MgSO₄, K₂SO₄ and the like — or, if
 *    there are none, in the Calcium tank (see `placeMicronutrients`).
 *
 * 2. No tank holds micronutrients beside Nitrogen the grower would taper (see
 *    `TAPERABLE_NITROGEN_SALTS`). Tapering means dialling a tank back, and every
 *    gram in it comes down by the same fraction — so micros sharing a tank with
 *    the KNO₃ turn "cut Nitrogen before harvest" into "cut Nitrogen and the
 *    whole micro package". Nitrogen that arrives inside a Calcium or Phosphorus
 *    source is a different matter: nobody cuts their Ca(NO₃)₂ to move Nitrogen
 *    without meaning to move Calcium too, so micros beside it are fine, and
 *    that's what keeps the layout from spending a tank on them. A recipe with no
 *    tank free of taperable Nitrogen anywhere has no better option, so that's
 *    reported as intentional rather than failed.
 *
 * 3. No taperable Nitrogen salt is spread over two tanks when one tank could
 *    hold the lot. Solving each part on its own leaves the same KNO₃ in two
 *    places, and the grower then has to cut both in step to move Nitrogen once.
 *    Solubility is the one good reason to keep the split — so when the combined
 *    amount genuinely wouldn't dissolve, that's reported as intentional rather
 *    than failed (see `saltFitsOneTank` / `consolidateTaperableNitrogen`).
 */
function reportSeparateNitrogenTaperability(
  result: CalculateRecipeResult,
  stockVolumeLiters: number
): boolean {
  const tanks = result.separateNitrogenRecipe.tanks
  let allPass = true

  // Whether the recipe has anywhere for the micros to go that a taper won't
  // reach. Without one, sharing with taperable Nitrogen is the least bad answer
  // available, and a tank of their own still isn't on the table.
  const somewhereOffTaperPath = tanks.some(
    (tank) => !saltAmountsCarryTaperableNitrogen(tank.salts)
  )

  for (const tank of tanks) {
    const micros = TANK_3_SALTS.filter((key) => tank.salts[key] > 0)
    if (micros.length === 0) continue

    const macros = SALT_DISPLAY_ORDER.filter(
      (key) => tank.salts[key] > 0 && !MICRO_SALT_KEYS.has(key)
    )
    if (macros.length === 0) {
      console.log(
        `\n    ${tank.name} (${tank.role}) holds nothing but micronutrients — there is no ` +
          "micros-only product to stand in for, so they belong beside this recipe's " +
          "Nitrogen-free macros or in the Calcium tank"
      )
      allPass = false
      continue
    }

    const taperable = TAPERABLE_NITROGEN_SALTS.filter((key) => tank.salts[key] > 0)
    if (taperable.length === 0) continue

    const complaint =
      `${tank.name} (${tank.role}) holds micronutrients beside Nitrogen a grower would ` +
      `taper — dialling it back would cut ${micros.map((key) => RAW_SALTS[key].name).join(", ")} ` +
      `along with the ${taperable.map((key) => RAW_SALTS[key].name).join(", ")}`

    if (!somewhereOffTaperPath) {
      console.log(`\n    ${complaint}, but no tank in this recipe is free of it`)
      continue
    }

    console.log(`\n    ${complaint}`)
    allPass = false
  }

  for (const saltKey of TAPERABLE_NITROGEN_SALTS) {
    const holding = tanks.filter((tank) => tank.salts[saltKey] > 0)
    if (holding.length < 2) continue

    const total = holding.reduce((grams, tank) => grams + tank.salts[saltKey], 0)
    const where = holding
      .map((tank) => `${tank.name} ${tank.salts[saltKey].toFixed(3)} g`)
      .join(", ")

    if (!saltFitsOneTank(saltKey, total, stockVolumeLiters)) {
      console.log(
        `\n    ${RAW_SALTS[saltKey].name} stays split (${where}) — ${total.toFixed(3)} g in ` +
          `${stockVolumeLiters} L exceeds its safe solubility, so the split is intentional`
      )
      continue
    }

    console.log(
      `\n    ${RAW_SALTS[saltKey].name} is split across tanks (${where}) even though all ` +
        `${total.toFixed(3)} g would dissolve in one`
    )
    allPass = false
  }

  return allPass
}

/**
 * From three parts up, Separate Nitrogen is only a regrouping of the per-part
 * tanks: the same parts are solved the same independent way, and the only thing
 * that moves is the Calcium, which pools into whichever tank is the line's
 * Calcium bottle (see `calculateSeparateNitrogenMultiPartRecipe`). So the two
 * layouts must weigh out the same grams of every salt, to the gram. Any
 * difference means the layout re-solved something behind the grower's back —
 * which is exactly the drift away from the original line that solving them per
 * part is meant to avoid.
 *
 * On top of that, four things about the tanks themselves:
 *
 *  - Moving the Calcium never buys an extra tank. A three-part line gets three
 *    tanks, not a fourth thin one holding what was left of the Calcium bottle.
 *    This is the check that pins the layout to the shape of the original line,
 *    and it covers the micronutrients too: they ride along in an existing tank
 *    rather than taking one (see `reportSeparateNitrogenTaperability`).
 *  - All the Calcium is in one tank, and nothing phosphate- or sulfate-bearing
 *    shares it. Pooling several parts' Calcium is only safe as long as no
 *    part's phosphate or sulfate can land beside another part's Calcium at
 *    stock strength. What may share it is the host bottle's own nitrates, Urea
 *    and — when there was nowhere else for them — the chelated micros: that's a
 *    conventional Tank A, and it's what keeps the tank count down.
 *  - Every tank stands for exactly one original part, and holds only macro salts
 *    that part declared — the same containment the per-part tanks are held to
 *    below, applied to the Calcium tank as well for everything except the pooled
 *    Calcium itself. A tank that merged two bottles, or borrowed a neighbour's
 *    salt, would still deliver a plausible total, so this is invisible in the
 *    ppm table. The Calcium tank when it holds nothing but Calcium is the one
 *    that legitimately belongs to no part.
 *  - No tank is empty. A part that's pure Calcium Nitrate has nothing left once
 *    its Calcium is pooled, and must not leave a blank tank behind.
 *
 * The three-part threshold is spelled out here rather than imported from
 * `SEPARATE_NITROGEN_PER_PART_SOLVE_MIN_PARTS`: reading the same knob this
 * check exists to guard would make it agree with the solver by construction,
 * and quietly skip every scenario the moment that knob moved.
 */
const SEPARATE_NITROGEN_PER_PART_PARTS = 3

/**
 * Whether the line has a bottle that can hold every part's Calcium — i.e. one
 * that declares a Calcium salt and no phosphate or sulfate to precipitate it.
 *
 * Read off the grower's own checkboxes rather than off the tanks that came back,
 * so it's an independent expectation rather than a restatement of what the
 * solver did. It's the one input shape that can't fit the tank cap below: a
 * Calcium bottle carrying sulfate has to be split in two for the Calcium to stay
 * isolated, and no other bottle can take the Calcium instead.
 */
function someBottleCanHoldTheCalcium(scenario: Scenario): boolean {
  return scenario.partsAnalysis.some((analysis) => {
    const checked = getEnabledSaltKeys(analysis.includedSalts)
    if (!TANK_1_SALTS.some((key) => checked.has(key))) return false
    return !CALCIUM_INCOMPATIBLE_SALTS.some((key) => checked.has(key))
  })
}

function reportSeparateNitrogenMatchesPerPartTanks(
  result: CalculateRecipeResult,
  scenario: Scenario
): boolean {
  if (scenario.parts.length < SEPARATE_NITROGEN_PER_PART_PARTS) return true
  // The doser layout pools every part's micros into a tank of their own, so its
  // per-part totals aren't the ones this layout is built from.
  if (scenario.stockTankOption === "doser") return true

  const tanks = result.separateNitrogenRecipe.tanks
  const separateNitrogen = sumSaltAmounts(...tanks.map((tank) => tank.salts))
  const perPart = sumSaltAmounts(...result.multiPartRecipe.tanks.map((tank) => tank.salts))
  const drifted = SALT_DISPLAY_ORDER.filter(
    (key) => Math.abs(separateNitrogen[key] - perPart[key]) > 1e-9
  )

  let allPass = true
  if (drifted.length > 0) {
    console.log(
      "\n    Separate Nitrogen tanks don't hold the per-part amounts: " +
        drifted
          .map(
            (key) =>
              `${RAW_SALTS[key].name} ${separateNitrogen[key].toFixed(3)} g vs ${perPart[key].toFixed(3)} g`
          )
          .join(", ")
    )
    allPass = false
  }

  if (someBottleCanHoldTheCalcium(scenario) && tanks.length > scenario.parts.length) {
    console.log(
      `\n    Separate Nitrogen split ${scenario.parts.length} parts into ${tanks.length} tanks — ` +
        "isolating the Calcium must not add a tank on top of the original line"
    )
    allPass = false
  }

  const calciumTanks = tanks.filter((tank) => tank.role === "calcium")
  if (calciumTanks.length > 1) {
    console.log(
      `\n    Separate Nitrogen spread the Calcium over ${calciumTanks.length} tanks: ` +
        calciumTanks.map((tank) => tank.name).join(", ")
    )
    allPass = false
  }

  for (const tank of tanks) {
    const misplaced = SALT_DISPLAY_ORDER.filter((key) => {
      if (tank.salts[key] <= 0) return false
      return tank.role === "calcium"
        ? CALCIUM_INCOMPATIBLE_SALT_KEYS.has(key)
        : TANK_1_SALT_KEYS.has(key)
    })
    if (misplaced.length === 0) continue

    console.log(
      `\n    ${tank.name} (${tank.role}) is on the wrong side of the Calcium split: ` +
        misplaced.map((key) => RAW_SALTS[key].name).join(", ")
    )
    allPass = false
  }

  const analysisById = new Map(scenario.partsAnalysis.map((part) => [part.id, part]))
  const autoAdded = new Set(
    (result.separateNitrogenRecipe.autoAddedSalts ?? []).map((note) => note.saltKey)
  )
  // Scoped to macros for the same reason `reportPerPartSaltContainment` is:
  // micronutrients are deliberately not part-faithful.
  const macroKeys = SALT_DISPLAY_ORDER.filter((key) => !MICRO_SALT_KEYS.has(key))

  for (const tank of tanks) {
    // The Calcium tank is unnamed when it holds nothing but Calcium (plus, when
    // there was nowhere else for them, the micros), which is the one tank that
    // legitimately draws on every part at once.
    if (!tank.partId) {
      if (tank.role === "calcium") continue
      console.log(`\n    ${tank.name} merges the parts together instead of standing for one of them`)
      allPass = false
      continue
    }

    const analysis = analysisById.get(tank.partId)
    if (!analysis) continue

    const allowed = getEnabledSaltKeys(analysis.includedSalts)
    const foreign = macroKeys.filter((key) => {
      // Every part's Calcium pools into the Calcium tank by design, so it's the
      // only salt group there that isn't the host bottle's own.
      if (tank.role === "calcium" && TANK_1_SALT_KEYS.has(key)) return false
      return tank.salts[key] > 0 && !allowed.has(key) && !autoAdded.has(key)
    })
    if (foreign.length === 0) continue

    console.log(
      `\n    ${tank.name} (${tank.partName}) holds macro salts not checked on that part: ` +
        foreign.map((key) => `${RAW_SALTS[key].name} ${tank.salts[key].toFixed(3)} g`).join(", ")
    )
    allPass = false
  }

  const empty = tanks.filter((tank) => !SALT_DISPLAY_ORDER.some((key) => tank.salts[key] > 0))
  if (empty.length > 0) {
    console.log(
      `\n    Separate Nitrogen emitted empty tanks: ${empty.map((tank) => tank.name).join(", ")}`
    )
    allPass = false
  }

  return allPass
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

  const separateNitrogenTanks = result.separateNitrogenRecipe.tanks
  return [
    {
      label: `Separate Nitrogen (${separateNitrogenTanks.length} tank${separateNitrogenTanks.length === 1 ? "" : "s"})`,
      salts: sumSaltAmounts(
        ...separateNitrogenTanks.map((tank) => tank.salts),
        carbonate(result.separateNitrogenRecipe.directAddCalciumCarbonate?.grams)
      ),
      dilutionRatio: result.dilutionRatio,
      reported: result.separateNitrogenRecipe.delivered,
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
  for (const tank of result.separateNitrogenRecipe.tanks) {
    const role = [tank.partName, tank.role === "calcium" ? "calcium" : null]
      .filter(Boolean)
      .join(" + ")
    reportSalts(`Separate Nitrogen ${tank.name} (${role})`, tank.salts)
  }
  for (const tank of result.multiPartRecipe.tanks) {
    reportSalts(`Per-part ${tank.name} (${tank.partName})`, tank.salts)
  }

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
    result.separateNitrogenRecipe.deviations,
    result.multiPartRecipe.deviations,
    result.directRecipe.deviations,
  ]

  let allPass = true
  layouts.forEach((layout, index) => {
    if (!reportLayout(layout, result.targets, deviationsByLayout[index], result.stockVolumeLiters)) {
      allPass = false
    }
  })

  const warnings = result.separateNitrogenRecipe.warnings ?? []
  if (warnings.length > 0) {
    console.log(`\n    no checked salt supplies: ${warnings.map((warning) => warning.label).join(", ")}`)
  }
  for (const note of result.separateNitrogenRecipe.autoAddedSalts ?? []) {
    console.log(`    auto-added ${note.saltLabel} for ${note.elementLabel}`)
  }
  if (k2so4Checked && k2so4Needed && !k2so4Used) {
    console.log("\n    EXPECTED Potassium Sulfate to be used — it's checked and K/S run short")
    allPass = false
  }

  if (!reportSeparateNitrogenTaperability(result, result.stockVolumeLiters)) {
    allPass = false
  }

  if (!reportPerPartSaltContainment(result, scenario)) {
    allPass = false
  }

  if (!reportSeparateNitrogenMatchesPerPartTanks(result, scenario)) {
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
    PER_PART_ISOLATION,
    FOUR_PART_SEPARATE_NITROGEN,
    CALCIUM_BOTTLE_CARRIES_SULFATE,
    EVERY_BOTTLE_CARRIES_NITROGEN,
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
