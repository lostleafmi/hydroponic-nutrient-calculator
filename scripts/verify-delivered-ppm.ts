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
 * `reportDisplayedRoundTrip` then closes the loop the solver can't see: it
 * takes the numbers as the *screen* prints them — each tank's grams at the
 * chosen Target EC, the tank size, and the one mL/gal usage rate — and works
 * forward to the reservoir ppm the way a grower with a scale and a measuring
 * jug would. Checking the solver against itself was never enough: the Target EC
 * scale used to be applied only where grams were formatted, so the tanks and
 * the ppm panel could disagree by that factor with every server-side check
 * still green.
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
  emptyElementalTargets,
  emptySaltAmounts,
  formatGrams,
  formatMl,
  getEnabledSaltKeys,
  isWithinMatchTolerance,
  LITERS_PER_GALLON,
  RAW_SALTS,
  SALT_DISPLAY_ORDER,
  saltAmountsCarryTaperableNitrogen,
  saltFitsOneTank,
  stockTankMlPerGallon,
  sumSaltAmounts,
  TAPERABLE_NITROGEN_SALTS,
  TANK_1_SALTS,
  TANK_3_SALTS,
  type DirectMixRecipe,
  type ElementalTargets,
  type IncludedSaltsSelection,
  type MultiPartTankRecipe,
  type SaltAmounts,
  type SaltKey,
  type SeparateNitrogenRecipe,
} from "@/lib/hydro-calc/recipe-types"
import {
  deliveredPpmFromStockTankDose,
  scaleDirectMixRecipe,
  scaleElementalTargets,
  scaleMultiPartTankRecipe,
  scaleSeparateNitrogenRecipe,
  stockSaltGramsPerGallonOfStock,
} from "@/lib/hydro-calc/displayed-recipe"
import {
  buildDryBulkBatch,
  DRY_BATCH_SIZES_LB,
  DRY_BATCH_USE_RATE_LITERS,
  findDryBagCompatibilityViolations,
  GRAMS_PER_POUND,
} from "@/lib/hydro-calc/dry-batch"

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
  /** Stock tank the grower is mixing into, when `STOCK_VOLUME_LITERS` isn't the interesting size. */
  stockVolumeLiters?: number
  dilutionRatio?: number
  /**
   * A Target EC the grower typed over the solver's own estimate, which the
   * Recipe screen honours by scaling every gram in every tank (see
   * `lib/hydro-calc/displayed-recipe.ts`). Left unset, the screen shows the
   * recipe at its estimated EC and the scale is 1.
   */
  targetEc?: number
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
 * up).
 *
 * The Cal-Mag also brings Magnesium Nitrate, which is the second kind of
 * taperable Nitrogen a line can carry. It joins the Nitrogen tank alongside the
 * Ca(NO₃)₂ and KNO₃ — safe there, since it carries no phosphate or sulfate —
 * rather than holding a fourth tank open for a bottle whose Calcium and Nitrogen
 * have both moved. So four parts come back as three tanks: the Nitrogen tank and
 * the two phosphate/sulfate bottles.
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
 * A 3-part line whose Calcium bottle carries Magnesium Sulfate as well, so that
 * bottle can't hold the pooled Calcium — the two would precipitate as gypsum at
 * stock strength. Its Calcium is lifted out into a tank of its own and the
 * bottle keeps a tank for the sulfate, which is the right answer: the grower who
 * would rather have Calcium and sulfate together in one tank already has the
 * per-part layout for that.
 *
 * Here to pin down that chemistry outranks the tank count (see
 * `pickCalciumHost`). It costs nothing here as it happens — the K Base is pure
 * KNO₃, which follows the Calcium into the Nitrogen tank and empties its own
 * tank out — so three parts still come back as three tanks. What matters is that
 * the sulfate never follows.
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
 * A three-part line where every bottle declares Nitrogen, which is what makes it
 * worth checking where the micronutrients land.
 *
 * Part A is the Calcium bottle (Ca(NO₃)₂ + KNO₃) and carries the micro package.
 * Part B is a P/K/Mg bottle that also lists KNO₃. Part C is a MAP-only phosphate
 * booster, whose Nitrogen is ammoniacal and rides along with the Phosphorus it
 * was bought for — the kind of Nitrogen `TAPERABLE_NITROGEN_SALTS` deliberately
 * leaves where it is.
 *
 * Gathering both bottles' KNO₃ into the Nitrogen tank is what leaves Part B
 * Nitrogen-free, and that's where the micros go: beside MKP, MgSO₄ and K₂SO₄, out
 * of reach of any taper. They don't stay with the Calcium package that declared
 * them — a tank a grower cuts to bring Nitrogen down is the last place the micro
 * package belongs, and after the gathering that's exactly what the Calcium tank
 * is.
 */
const EVERY_BOTTLE_CARRIES_NITROGEN: Scenario = {
  name: "3-part line where every bottle declares N (micros land off the taper path)",
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
 * The one recipe shape where the micronutrients have nowhere good to go: a
 * single-bottle N-K-Ca base of Ca(NO₃)₂ and KNO₃ with no Phosphorus, Magnesium or
 * Sulfur at all. Gathering the Nitrogen leaves one macro tank rather than two, so
 * there's no phosphate/sulfate side for the micros to ride on.
 *
 * Both rules about micronutrients can't hold at once here, and this pins which
 * gives way. They ride along in the Nitrogen tank, where a taper will cut them:
 * the alternative is a stock tank holding nothing but a few grams of chelates,
 * which is no product a grower has a counterpart for and one more tank to mix and
 * label. A recipe with a tank the taper can't reach never has to make the choice
 * (see `placeMicronutrients`), which is nearly all of them.
 */
const ALL_NITROGEN_SINGLE_PART: Scenario = {
  name: "N-K-Ca base with no P/Mg/S (micros have no tank off the taper path)",
  partsAnalysis: [
    {
      id: "a",
      // 50% Ca(NO₃)₂ + 50% KNO₃ — Ca 9.5%, N 14.7%, K 19.35% → 23.31% K₂O.
      name: "Veg Base",
      nitrogen: "14.7",
      phosphate: "",
      potash: "23.31",
      calcium: "9.5",
      magnesium: "",
      sulfur: "",
      iron: "0.2",
      manganese: "0.05",
      zinc: "0.02",
      boron: "0.02",
      copper: "0.01",
      molybdenum: "0.001",
      includedSalts: salts("calciumNitrate", "potassiumNitrate", "chelatedMicronutrients"),
    },
  ],
  parts: [{ id: "a", name: "Veg Base", dose: "5", unit: "g_per_gallon" }],
  stockTankOption: "separate",
}

/**
 * The one good reason to leave a recipe's Nitrogen in two tanks: at 5 L there is
 * no single tank that holds 1,100-odd grams of KNO₃ in solution, but two tanks
 * hold half that each with room to spare. So the split isn't a shortcoming of the
 * layout, it's the remedy — and the recipe has to say so rather than gather the
 * Nitrogen anyway and quietly hand the grower a tank that won't dissolve (see
 * `pourTaperableNitrogenIntoCalciumTank`).
 *
 * The Calcium bottle's own KNO₃ still goes in with its Calcium, so the K Base is
 * the tank that keeps its share and the line still comes back as three tanks.
 */
const NITROGEN_TOO_MUCH_FOR_ONE_TANK: Scenario = {
  name: "High-K 3-part line (KNO₃ stays split because it wouldn't all dissolve)",
  partsAnalysis: [
    {
      id: "a",
      // 40% Ca(NO₃)₂ + 60% KNO₃ — Ca 7.6%, N 14.54%, K 23.22% → 27.98% K₂O.
      name: "Cal Base",
      nitrogen: "14.54",
      phosphate: "",
      potash: "27.98",
      calcium: "7.6",
      magnesium: "",
      sulfur: "",
      iron: "",
      manganese: "",
      zinc: "",
      boron: "",
      copper: "",
      molybdenum: "",
      includedSalts: salts("calciumNitrate", "potassiumNitrate"),
    },
    {
      id: "b",
      // 40% MKP + 30% MgSO₄ + 30% K₂SO₄ — P 9.12% → 20.9% P₂O₅,
      // K 24.95% → 30.06% K₂O, Mg 2.97%, S 9.42%.
      name: "PK Base",
      nitrogen: "",
      phosphate: "20.9",
      potash: "30.06",
      calcium: "",
      magnesium: "2.97",
      sulfur: "9.42",
      iron: "0.2",
      manganese: "0.05",
      zinc: "0.02",
      boron: "0.02",
      copper: "0.01",
      molybdenum: "0.001",
      includedSalts: salts(
        "monoPotassiumPhosphate",
        "magnesiumSulfate",
        "potassiumSulfate",
        "chelatedMicronutrients"
      ),
    },
    {
      id: "c",
      // 100% KNO₃ — N 13.9%, K 38.7% → 46.63% K₂O.
      name: "K Base",
      nitrogen: "13.9",
      phosphate: "",
      potash: "46.63",
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
    { id: "a", name: "Cal Base", dose: "8", unit: "g_per_gallon" },
    { id: "b", name: "PK Base", dose: "3", unit: "g_per_gallon" },
    { id: "c", name: "K Base", dose: "4", unit: "g_per_gallon" },
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
 * 3. Every taperable Nitrogen salt is in the tank holding the Calcium, so one
 *    tank carries the whole Nitrogen load and a taper is one dial. Ca(NO₃)₂ is
 *    normally a recipe's biggest Nitrogen source and its Nitrogen can't be cut
 *    without cutting the Calcium bought with it, so KNO₃ in a tank of its own
 *    doesn't give the grower a Calcium-free Nitrogen dial — it gives them two
 *    dials to turn in step. The pairing is chemically routine (that's a
 *    conventional Tank A), so solubility is the one good reason not to: when the
 *    combined amount genuinely wouldn't dissolve in one tank, splitting it halves
 *    the concentration in each, and that's reported as intentional rather than
 *    failed — provided the recipe owns up to it in `nitrogenKeptApart`, since a
 *    grower who has to cut two tanks in step needs telling (see
 *    `saltFitsOneTank` / `pourTaperableNitrogenIntoCalciumTank`).
 *
 *    With no Calcium in any tank there's nothing to pair the Nitrogen with, and
 *    the weaker rule applies: one tank for each salt, whichever tank that is.
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

  // Where the Nitrogen belongs: with the Calcium Nitrate. Read off the tank
  // roles rather than off the recipe's own account of what it did.
  const calciumTank = tanks.find((tank) => tank.role === "calcium")
  const ownedUpTo = new Set(result.separateNitrogenRecipe.nitrogenKeptApart ?? [])

  for (const saltKey of TAPERABLE_NITROGEN_SALTS) {
    const holding = tanks.filter((tank) => tank.salts[saltKey] > 0)
    if (holding.length === 0) continue
    // Nothing to gather: it's already whole, and either in the Calcium tank or in
    // a recipe that has no Calcium tank to gather it into.
    if (holding.length === 1 && (calciumTank === undefined || holding.includes(calciumTank))) {
      continue
    }

    const total = holding.reduce((grams, tank) => grams + tank.salts[saltKey], 0)
    const where = holding
      .map((tank) => `${tank.name} ${tank.salts[saltKey].toFixed(3)} g`)
      .join(", ")
    const home = calciumTank ? `with the Calcium in ${calciumTank.name}` : "in one tank"

    if (!saltFitsOneTank(saltKey, total, stockVolumeLiters)) {
      console.log(
        `\n    ${RAW_SALTS[saltKey].name} isn't ${home} (${where}) — all ${total.toFixed(3)} g in ` +
          `${stockVolumeLiters} L would exceed its safe solubility, so keeping it apart is intentional`
      )
      if (!ownedUpTo.has(saltKey)) {
        console.log(
          `    ...but the recipe doesn't report it, so the grower is never told they have two ` +
            "tanks to cut in step"
        )
        allPass = false
      }
      continue
    }

    console.log(
      `\n    ${RAW_SALTS[saltKey].name} isn't ${home} (${where}) even though all ` +
        `${total.toFixed(3)} g would dissolve there`
    )
    allPass = false
  }

  return allPass
}

/**
 * From three parts up, Separate Nitrogen is only a regrouping of the per-part
 * tanks: the same parts are solved the same independent way, and what moves is
 * only the Calcium and the taperable Nitrogen, both pooling into one tank (see
 * `calculateSeparateNitrogenMultiPartRecipe`). So the two layouts must weigh out
 * the same grams of every salt, to the gram. Any difference means the layout
 * re-solved something behind the grower's back — which is exactly the drift away
 * from the original line that solving them per part is meant to avoid.
 *
 * On top of that, five things about the tanks themselves:
 *
 *  - Pooling never buys an extra tank. A three-part line gets three tanks or
 *    fewer, not a fourth thin one holding what was left of the Calcium bottle.
 *    This is the check that pins the layout to the shape of the original line,
 *    and it covers the micronutrients too: they ride along in an existing tank
 *    rather than taking one (see `reportSeparateNitrogenTaperability`).
 *  - All the Calcium is in one tank, and nothing phosphate- or sulfate-bearing
 *    shares it. Pooling several parts' Calcium is only safe as long as no
 *    part's phosphate or sulfate can land beside another part's Calcium at
 *    stock strength. What may share it is the recipe's nitrates and Urea and —
 *    when there was nowhere else for them — the chelated micros: that's a
 *    conventional Tank A.
 *  - The Calcium tank stands for no single part. It draws its Calcium from every
 *    bottle and its Nitrogen from every bottle, so a part name on it would tell
 *    the grower something untrue about what's inside (see
 *    `SeparateNitrogenTank.partName`).
 *  - Every other tank stands for exactly one original part, and holds only macro
 *    salts that part declared — the same containment the per-part tanks are held
 *    to below. A tank that merged two bottles, or borrowed a neighbour's salt,
 *    would still deliver a plausible total, so this is invisible in the ppm
 *    table.
 *  - No tank is empty. A part that's pure Calcium Nitrate and KNO₃ has nothing
 *    left once both are pooled, and must not leave a blank tank behind.
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
    // The Calcium tank is the one that legitimately draws on every part at once,
    // so it names none of them and there's no bottle to hold its contents to.
    if (tank.role === "calcium") {
      if (!tank.partId) continue
      console.log(
        `\n    ${tank.name} is named after ${tank.partName}, but the tank pooling every part's ` +
          "Calcium and every part's Nitrogen stands for no single bottle"
      )
      allPass = false
      continue
    }

    if (!tank.partId) {
      console.log(`\n    ${tank.name} merges the parts together instead of standing for one of them`)
      allPass = false
      continue
    }

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

  const empty = tanks.filter((tank) => !SALT_DISPLAY_ORDER.some((key) => tank.salts[key] > 0))
  if (empty.length > 0) {
    console.log(
      `\n    Separate Nitrogen emitted empty tanks: ${empty.map((tank) => tank.name).join(", ")}`
    )
    allPass = false
  }

  return allPass
}

/**
 * The reported delivered-ppm case, reconstructed: a 1 gallon stock tank at
 * 1:160 — so each tank card reads directly as g per gallon of stock solution,
 * and the usage rate prints as 23.7 mL/gal — on a three-part line whose Calcium
 * bottle is straight CalciNit and whose two bloom bottles are MKP / MgSO₄ /
 * K₂SO₄ blends. Plus the detail that turns out to be the whole scenario: a
 * grower who typed a Target EC above the solver's own estimate.
 *
 * Every label ratio here is exactly buildable from the salts checked, so the
 * solver lands on the label and every server-side check passes. What the grower
 * saw was the tank cards reading ~5.7% richer than the ppm panel above them at
 * an unchanged 23.7 mL/gal — Ca 209 against a displayed 197.4, N 170.5 against
 * 161.1, K 306 against 289.2 — proportional across all twelve elements, because
 * one scale factor was reaching the grams and nothing else.
 */
const TARGET_EC_SCALED_THREE_PART: Scenario = {
  name: "3-part line at a raised Target EC (tanks and ppm panel must still agree)",
  partsAnalysis: [
    {
      id: "a",
      // Straight CalciNit — `RAW_SALTS.calciumNitrate`'s own composition.
      name: "Cal Nitrate",
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
      // 13.67% MKP + 47.92% MgSO₄ + 38.41% K₂SO₄ — P 3.12% → 7.14% P₂O₅,
      // K 21.17% → 25.51% K₂O, Mg 4.74%, S 13.30% — plus the micro package.
      name: "Bloom A",
      nitrogen: "",
      phosphate: "7.14",
      potash: "25.51",
      calcium: "",
      magnesium: "4.74",
      sulfur: "13.30",
      iron: "0.415",
      manganese: "0.133",
      zinc: "0.066",
      boron: "0.05",
      copper: "0.013",
      molybdenum: "0.05",
      includedSalts: salts(
        "monoPotassiumPhosphate",
        "magnesiumSulfate",
        "potassiumSulfate",
        "chelatedMicronutrients"
      ),
    },
    {
      id: "c",
      // 55.65% MKP + 26.61% MgSO₄ + 17.74% K₂SO₄ — P 12.69% → 29.07% P₂O₅,
      // K 23.94% → 28.85% K₂O, Mg 2.63%, S 6.72%.
      name: "Bloom B",
      nitrogen: "",
      phosphate: "29.07",
      potash: "28.85",
      calcium: "",
      magnesium: "2.63",
      sulfur: "6.72",
      iron: "",
      manganese: "",
      zinc: "",
      boron: "",
      copper: "",
      molybdenum: "",
      includedSalts: salts("monoPotassiumPhosphate", "magnesiumSulfate", "potassiumSulfate"),
    },
  ],
  parts: [
    { id: "a", name: "Cal Nitrate", dose: "3.93", unit: "g_per_gallon" },
    { id: "b", name: "Bloom A", dose: "3.92", unit: "g_per_gallon" },
    { id: "c", name: "Bloom B", dose: "1.10", unit: "g_per_gallon" },
  ],
  stockTankOption: "separate",
  stockVolumeLiters: LITERS_PER_GALLON,
  dilutionRatio: 160,
  targetEc: 3.0,
}

/** A layout's resolved salts, as the Recipe screen would show them. */
interface ResolvedLayout {
  label: string
  /**
   * One entry per stock tank the grower mixes, in card order — kept separate
   * rather than summed because each tank's grams are rounded for display on
   * their own, and `reportDisplayedRoundTrip` works from the rounded figures.
   *
   * Any direct-add Calcium Carbonate rides along as a tank of its own: it never
   * goes into a stock tank, but it does dissolve into the reservoir, so it has
   * to be counted somewhere.
   */
  tanks: SaltAmounts[]
  salts: SaltAmounts
  /** Direct-mix amounts are already at working strength (see calculateDirectMixRecipe). */
  dilutionRatio: number
  /** What the layout itself reports it delivers — cross-checked against the salts. */
  reported: ElementalTargets
}

/**
 * A whole result as the Recipe screen renders it: every layout, and the label's
 * own targets, brought to the strength the grower asked for. Built with the same
 * helpers `recipe-screen.tsx` uses before it renders a single gram, so this is
 * the screen's arithmetic rather than a restatement of it (see
 * `lib/hydro-calc/displayed-recipe.ts`).
 *
 * The label targets are scaled alongside the tanks for the reason spelled out
 * in `scaleDeviations`: running the recipe 6% strong doesn't put six elements
 * off label, it moves the whole comparison up by 6%.
 */
interface DisplayedRecipes {
  ecScaleFactor: number
  targets: ElementalTargets
  separateNitrogen: SeparateNitrogenRecipe
  perPart: MultiPartTankRecipe
  direct: DirectMixRecipe
}

function displayedRecipes(
  result: CalculateRecipeResult,
  targetEc: number | undefined
): DisplayedRecipes {
  const ecScaleFactor =
    targetEc !== undefined &&
    targetEc > 0 &&
    result.estimatedEc !== null &&
    result.estimatedEc > 0
      ? targetEc / result.estimatedEc
      : 1

  return {
    ecScaleFactor,
    targets: scaleElementalTargets(result.targets, ecScaleFactor),
    separateNitrogen: scaleSeparateNitrogenRecipe(result.separateNitrogenRecipe, ecScaleFactor),
    perPart: scaleMultiPartTankRecipe(result.multiPartRecipe, ecScaleFactor),
    direct: scaleDirectMixRecipe(result.directRecipe, ecScaleFactor),
  }
}

function resolvedLayouts(displayed: DisplayedRecipes, dilutionRatio: number): ResolvedLayout[] {
  const carbonate = (grams: number | undefined): SaltAmounts[] => {
    if (!(grams !== undefined && grams > 0)) return []
    const set = emptySaltAmounts()
    set.calciumCarbonate = grams
    return [set]
  }

  const { separateNitrogen, perPart, direct } = displayed

  const layout = (
    label: string,
    tanks: SaltAmounts[],
    dilutionRatio: number,
    reported: ElementalTargets
  ): ResolvedLayout => ({
    label,
    tanks,
    salts: sumSaltAmounts(...tanks),
    dilutionRatio,
    reported,
  })

  const tankCount = separateNitrogen.tanks.length
  return [
    layout(
      `Separate Nitrogen (${tankCount} tank${tankCount === 1 ? "" : "s"})`,
      [
        ...separateNitrogen.tanks.map((tank) => tank.salts),
        ...carbonate(separateNitrogen.directAddCalciumCarbonate?.grams),
      ],
      dilutionRatio,
      separateNitrogen.delivered
    ),
    layout(
      "One tank per part",
      [
        ...perPart.tanks.map((tank) => tank.salts),
        ...carbonate(perPart.directAddCalciumCarbonate?.grams),
      ],
      dilutionRatio,
      perPart.delivered
    ),
    layout(
      "Direct mix",
      [direct.salts, ...carbonate(direct.directAddCalciumCarbonate?.grams)],
      1,
      direct.delivered
    ),
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

/**
 * Relative agreement demanded of the exact displayed quantities. This isn't a
 * tolerance so much as a float-noise allowance: the g-per-gallon-of-stock and
 * mL/gal figures describe the same physical feed as the grams, so the two paths
 * have to agree to the last few bits or one of them has a unit wrong.
 */
const ROUND_TRIP_EXACT_RELATIVE = 1e-9

/** What the numbers as *printed* have to hold to, once display rounding is allowed for. */
const ROUND_TRIP_PRINTED_RELATIVE = 0.005
const ROUND_TRIP_PRINTED_MACRO_FLOOR_PPM = 0.5

/**
 * The rounding budget below is a tight bound rather than a generous one: for a
 * trace salt whose printed grams are the *only* thing feeding an element, the
 * budget and the observed drift are the same quantity computed two ways, and
 * whichever one lands a bit higher is down to float ordering. Widen it by
 * enough to swallow that and nothing more.
 */
const ROUND_TRIP_BUDGET_SLACK = 1e-9

/** A number as the screen prints it — back through the app's own formatters. */
function asPrintedGrams(grams: number): number {
  return parseFloat(formatGrams(grams))
}

function asPrintedMl(ml: number): number {
  return parseFloat(formatMl(ml))
}

/**
 * The check the reported bug would have failed.
 *
 * Works entirely from what the Recipe screen puts in front of the grower — each
 * tank's grams, the tank's size, and the single mL/gal usage rate — and derives
 * the reservoir ppm the way they would: how much of each salt a gallon of that
 * stock solution holds, times how much stock goes into a gallon of water.
 *
 *   g per gallon of stock = tank grams × LITERS_PER_GALLON ÷ tank litres
 *   mL/gal               = 1000 ÷ dilution ratio × LITERS_PER_GALLON
 *   ppm                  = g per gallon of stock × (mL/gal ÷ ML_PER_GALLON)
 *                          ÷ LITERS_PER_GALLON × 1000 × element fraction
 *
 * Deliberately routed through mL and gallons rather than the solver's
 * `grams × 1000 ÷ (litres × ratio)`, so a gallon↔litre hop applied twice or
 * skipped once on either path shows up as a mismatch instead of cancelling.
 *
 * Two passes. The first uses the underlying values and holds them to float
 * noise — that's the real invariant. The second re-reads every figure through
 * `formatGrams`/`formatMl`, so it measures what a grower who types the printed
 * numbers into a calculator actually gets, and allows for the rounding those
 * formatters introduce on top of a 0.5% band.
 */
function reportDisplayedRoundTrip(
  layout: ResolvedLayout,
  stockVolumeLiters: number
): boolean {
  const mlPerGallon = stockTankMlPerGallon(layout.dilutionRatio)
  const printedMlPerGallon = asPrintedMl(mlPerGallon)

  const fromDisplayed = (
    tankSalts: SaltAmounts[],
    ml: number,
    round: (grams: number) => number
  ): ElementalTargets => {
    const perTank = tankSalts.map((salts) => {
      const printed = emptySaltAmounts()
      for (const key of SALT_DISPLAY_ORDER) {
        if (salts[key] > 0) printed[key] = round(salts[key])
      }
      return deliveredPpmFromStockTankDose(
        stockSaltGramsPerGallonOfStock(printed, stockVolumeLiters),
        ml
      )
    })
    const total = emptyElementalTargets()
    for (const tank of perTank) {
      for (const key of Object.keys(total) as Array<keyof ElementalTargets>) {
        total[key] += tank[key]
      }
    }
    return total
  }

  const exact = fromDisplayed(layout.tanks, mlPerGallon, (grams) => grams)
  const printed = fromDisplayed(layout.tanks, printedMlPerGallon, asPrintedGrams)

  // Upper bound on how far display rounding alone can move each element: the
  // grams each tank was rounded by, converted to ppm, plus the whole figure
  // shifted by however much the usage rate was rounded by.
  const rateSkew = mlPerGallon > 0 ? Math.abs(printedMlPerGallon - mlPerGallon) / mlPerGallon : 0
  const roundingBudget = emptyElementalTargets()
  for (const tankSalts of layout.tanks) {
    for (const key of SALT_DISPLAY_ORDER) {
      const grams = tankSalts[key]
      if (!(grams > 0)) continue
      const gramsSkew = Math.abs(asPrintedGrams(grams) - grams)
      if (gramsSkew === 0) continue
      const skewed = emptySaltAmounts()
      skewed[key] = gramsSkew
      const asPpm = deliveredPpmFromStockTankDose(
        stockSaltGramsPerGallonOfStock(skewed, stockVolumeLiters),
        printedMlPerGallon
      )
      for (const element of Object.keys(roundingBudget) as Array<keyof ElementalTargets>) {
        roundingBudget[element] += asPpm[element]
      }
    }
  }

  console.log(
    `\n  ${layout.label} — round-trip from the displayed tanks at ` +
      `${formatMl(mlPerGallon)} mL/gal into ${(stockVolumeLiters / LITERS_PER_GALLON).toFixed(2)} gal of stock`
  )
  console.log(
    `    ${padRight("element", 8)}${padLeft("on screen", 11)}${padLeft("from g/gal", 12)}${padLeft("as printed", 12)}${padLeft("diff", 10)}   status`
  )

  let allPass = true
  for (const key of [...MACRO_KEYS, ...MICRO_KEYS]) {
    const onScreen = layout.reported[key]
    if (onScreen === 0 && exact[key] === 0) continue

    const exactDiff = exact[key] - onScreen
    const printedDiff = printed[key] - onScreen
    const exactAllowance = Math.max(Math.abs(onScreen) * ROUND_TRIP_EXACT_RELATIVE, 1e-9)
    const printedAllowance = Math.max(
      Math.abs(onScreen) * ROUND_TRIP_PRINTED_RELATIVE,
      (roundingBudget[key] + Math.abs(onScreen) * rateSkew) * (1 + ROUND_TRIP_BUDGET_SLACK),
      MACRO_KEYS.includes(key) ? ROUND_TRIP_PRINTED_MACRO_FLOOR_PPM : 0
    )

    let status: string
    if (Math.abs(exactDiff) > exactAllowance) {
      status = "TANKS != PANEL"
      allPass = false
    } else if (Math.abs(printedDiff) > printedAllowance) {
      status = "PRINTED != PANEL"
      allPass = false
    } else {
      status = "ok"
    }

    console.log(
      `    ${padRight(ELEMENT_SYMBOLS[key], 8)}${padLeft(fmt(onScreen), 11)}${padLeft(fmt(exact[key]), 12)}${padLeft(fmt(printed[key]), 12)}${padLeft(signed(printedDiff), 10)}   ${status}`
    )
  }

  return allPass
}

/**
 * The bulk dry batch (see `lib/hydro-calc/dry-batch.ts`) is a re-presentation
 * of the Direct Mix salt list, so what has to be checked isn't chemistry the
 * solver already settled — it's that the re-presentation is lossless and that
 * the bag split it invents is safe.
 *
 * Four things, for both bag sizes:
 *
 *  1. No bag holds a Calcium source beside a phosphate, sulfate or Magnesium
 *     source. `buildDryBulkBatch` claims this can't happen by construction;
 *     this checks the claim against real solved recipes rather than trusting it.
 *  2. Every salt lands in exactly one bag, and none is dropped.
 *  3. The bags sum to the selected weight, and every salt is the direct-mix
 *     amount times one shared scale — i.e. the ratios the solver produced
 *     survived the split untouched.
 *  4. Dosing each bag at its own printed use rate reproduces the direct-mix
 *     ppm. This is the closing check: a bag split that got the weights right
 *     but the per-bag use rate wrong would pass 1–3 and still starve the
 *     grower's reservoir.
 */
function reportDryBulkBatch(
  directSalts: SaltAmounts,
  reservoirLiters: number,
  scenario: Scenario
): boolean {
  const activeKeys = SALT_DISPLAY_ORDER.filter((key) => directSalts[key] > 0)
  const solvedTotal = activeKeys.reduce((total, key) => total + directSalts[key], 0)
  if (!(solvedTotal > 0)) return true

  const reservoirPpm = elementalPpmFromSaltAmounts(directSalts, reservoirLiters, 1)
  let allPass = true

  for (const sizeLb of DRY_BATCH_SIZES_LB) {
    const batch = buildDryBulkBatch({
      salts: directSalts,
      reservoirLiters,
      sizeLb,
      partsAnalysis: scenario.partsAnalysis,
    })

    console.log(`\n  Dry bulk batch — ${sizeLb} lb`)
    if (!batch) {
      console.log("    EXPECTED a batch from a non-empty direct-mix recipe, got none")
      return false
    }

    console.log(
      `    split: ${batch.splitBasis} — ${batch.bags.length} bag${batch.bags.length === 1 ? "" : "s"}, ` +
        `treats ${batch.treatsGallons.toFixed(0)} gal`
    )

    const violations = findDryBagCompatibilityViolations(batch.bags)
    for (const violation of violations) {
      console.log(`    FORBIDDEN BAG: ${violation}`)
      allPass = false
    }
    if (violations.length === 0) {
      console.log("    calcium kept clear of phosphate / sulfate / magnesium in every bag: ok")
    }

    // Each salt in exactly one bag, and the whole recipe accounted for.
    const bagCountByKey = new Map<SaltKey, number>()
    const batchSalts = emptySaltAmounts()
    const usePerGallon = emptySaltAmounts()
    for (const bag of batch.bags) {
      console.log(
        `    Bag ${bag.letter} — ${padRight(bag.title, 30)} ${padLeft(bag.totalGrams.toFixed(1), 9)} g` +
          ` (${bag.totalPounds.toFixed(2)} lb)  ${bag.gramsPerGallonOfWater.toFixed(3)} g/gal` +
          ` · ${bag.gramsPerBatchUseRateLiters.toFixed(3)} g/${DRY_BATCH_USE_RATE_LITERS} L`
      )
      const bagSaltTotal = bag.salts.reduce((total, salt) => total + salt.grams, 0)
      if (Math.abs(bagSaltTotal - bag.totalGrams) > Math.max(bag.totalGrams * 1e-9, 1e-9)) {
        console.log(
          `      BAG TOTAL != ITS SALTS: ${bag.totalGrams.toFixed(6)} g vs ${bagSaltTotal.toFixed(6)} g`
        )
        allPass = false
      }
      for (const salt of bag.salts) {
        bagCountByKey.set(salt.key, (bagCountByKey.get(salt.key) ?? 0) + 1)
        batchSalts[salt.key] += salt.grams
        // What the grower actually applies: this bag's use rate, split back
        // across the bag by each salt's share of it.
        usePerGallon[salt.key] +=
          bag.totalGrams > 0 ? (salt.grams / bag.totalGrams) * bag.gramsPerGallonOfWater : 0
      }
    }

    for (const key of activeKeys) {
      // Calcium Carbonate is deliberately excluded from the bags (it's a direct
      // reservoir addition), so it's never in a `salts` set the batch is built
      // from either — a non-zero one here would be a solver change, not a bug.
      const bags = bagCountByKey.get(key) ?? 0
      if (bags !== 1) {
        console.log(
          `      ${RAW_SALTS[key].name} is in ${bags} bag${bags === 1 ? "" : "s"} — must be exactly 1`
        )
        allPass = false
      }
    }
    for (const [key] of bagCountByKey) {
      if (directSalts[key] > 0) continue
      console.log(`      ${RAW_SALTS[key].name} is bagged but isn't in the recipe`)
      allPass = false
    }

    // Bags sum to the selected weight.
    const targetGrams = sizeLb * GRAMS_PER_POUND
    const totalSkew = Math.abs(batch.totalGrams - targetGrams)
    if (totalSkew > Math.max(targetGrams * 1e-9, 1e-6)) {
      console.log(
        `      BAGS DON'T SUM TO ${sizeLb} lb: ${batch.totalGrams.toFixed(6)} g vs ` +
          `${targetGrams.toFixed(6)} g (off by ${totalSkew.toExponential(2)} g)`
      )
      allPass = false
    } else {
      console.log(
        `    bags sum to ${batch.totalGrams.toFixed(3)} g = ${sizeLb} lb ` +
          `(off by ${totalSkew.toExponential(2)} g): ok`
      )
    }

    // One shared scale, applied to every salt — i.e. the solver's ratios intact.
    const scale = targetGrams / solvedTotal
    let ratiosHeld = true
    for (const key of activeKeys) {
      const expected = directSalts[key] * scale
      if (Math.abs(batchSalts[key] - expected) <= Math.max(expected * 1e-9, 1e-9)) continue
      console.log(
        `      ${RAW_SALTS[key].name} scaled to ${batchSalts[key].toFixed(6)} g, expected ` +
          `${expected.toFixed(6)} g (×${scale.toFixed(6)})`
      )
      ratiosHeld = false
      allPass = false
    }
    if (ratiosHeld) {
      console.log(`    every salt is its direct-mix amount ×${scale.toFixed(4)}: ok`)
    }

    // The use rates put the reservoir back where the direct mix had it.
    const fromUseRates = elementalPpmFromSaltAmounts(usePerGallon, LITERS_PER_GALLON, 1)
    console.log(
      `    ${padRight("element", 8)}${padLeft("direct mix", 12)}${padLeft("from bags", 12)}${padLeft("diff", 10)}   status`
    )
    for (const key of [...MACRO_KEYS, ...MICRO_KEYS]) {
      if (reservoirPpm[key] === 0 && fromUseRates[key] === 0) continue
      const diff = fromUseRates[key] - reservoirPpm[key]
      const ok = Math.abs(diff) <= Math.max(Math.abs(reservoirPpm[key]) * 1e-9, 1e-9)
      if (!ok) allPass = false
      console.log(
        `    ${padRight(ELEMENT_SYMBOLS[key], 8)}${padLeft(fmt(reservoirPpm[key]), 12)}` +
          `${padLeft(fmt(fromUseRates[key]), 12)}${padLeft(signed(diff), 10)}   ` +
          `${ok ? "ok" : "USE RATE != DIRECT MIX"}`
      )
    }
  }

  return allPass
}

async function runScenario(scenario: Scenario): Promise<boolean> {
  const stockVolumeLiters = scenario.stockVolumeLiters ?? STOCK_VOLUME_LITERS
  const dilutionRatio = scenario.dilutionRatio ?? DILUTION_RATIO

  console.log(`\n${"=".repeat(88)}`)
  console.log(scenario.name)
  console.log(
    `Stock tank ${stockVolumeLiters.toFixed(3)} L at 1:${dilutionRatio} — feed rates: ` +
      scenario.parts.map((part) => `${part.name} ${part.dose} g/gal`).join(", ")
  )
  console.log("=".repeat(88))

  const result = await calculateRecipeAction({
    partsAnalysis: scenario.partsAnalysis,
    parts: scenario.parts,
    stockTankOption: scenario.stockTankOption,
    stockVolumeLiters,
    dilutionRatio,
  })

  // Everything below is checked against the recipe the grower is looking at, at
  // whatever Target EC they set — not the one the solver returned.
  const displayed = displayedRecipes(result, scenario.targetEc)
  if (displayed.ecScaleFactor !== 1) {
    console.log(
      `\n  Target EC ${scenario.targetEc?.toFixed(2)} over an estimated ` +
        `${result.estimatedEc?.toFixed(2)} — every tank scaled ×${displayed.ecScaleFactor.toFixed(4)}`
    )
  }

  console.log("\n  Label-derived elemental targets (from the guaranteed analysis + feed rates):")
  for (const key of [...MACRO_KEYS, ...MICRO_KEYS]) {
    if (displayed.targets[key] === 0) continue
    console.log(
      `    ${padRight(ELEMENT_SYMBOLS[key], 6)}${padLeft(fmt(displayed.targets[key]), 10)} ppm`
    )
  }

  const layouts = resolvedLayouts(displayed, dilutionRatio)
  for (const tank of displayed.separateNitrogen.tanks) {
    const role = [tank.partName, tank.role === "calcium" ? "calcium" : null]
      .filter(Boolean)
      .join(" + ")
    reportSalts(`Separate Nitrogen ${tank.name} (${role})`, tank.salts)
  }
  for (const tank of displayed.perPart.tanks) {
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
        displayed.targets[element] > 0 &&
        k2so4Delivered[element] < displayed.targets[element] &&
        !isWithinMatchTolerance(element, k2so4Delivered[element], displayed.targets[element])
    )
  if (k2so4Checked) {
    console.log(
      `\n    Potassium Sulfate checked: needed for K/S? ${k2so4Needed ? "yes" : "no"} — used? ` +
        `${k2so4Used ? `yes (${layouts[0].salts.potassiumSulfate.toFixed(3)} g)` : "no"}`
    )
  }

  const deviationsByLayout = [
    displayed.separateNitrogen.deviations,
    displayed.perPart.deviations,
    displayed.direct.deviations,
  ]

  let allPass = true
  layouts.forEach((layout, index) => {
    if (
      !reportLayout(layout, displayed.targets, deviationsByLayout[index], result.stockVolumeLiters)
    ) {
      allPass = false
    }
    if (!reportDisplayedRoundTrip(layout, result.stockVolumeLiters)) {
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
  const keptApart = result.separateNitrogenRecipe.nitrogenKeptApart ?? []
  if (keptApart.length > 0) {
    console.log(
      `\n    recipe reports kept out of the Nitrogen tank by solubility: ` +
        keptApart.map((key) => RAW_SALTS[key].name).join(", ")
    )
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

  // Checked for every scenario rather than only the direct-mix ones: the Direct
  // Mix recipe is solved on every request regardless of the layout on screen,
  // and the bag split has to hold for any label a grower might bring.
  if (!reportDryBulkBatch(displayed.direct.salts, result.stockVolumeLiters, scenario)) {
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
    ALL_NITROGEN_SINGLE_PART,
    NITROGEN_TOO_MUCH_FOR_ONE_TANK,
    TARGET_EC_SCALED_THREE_PART,
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
