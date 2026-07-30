/**
 * Fidelity check for saving a formulation and loading it back: does every part
 * come back with the salts the grower checked on THAT part, and nothing else?
 *
 * The bug this exists to catch is quiet. A reload that hands each part the
 * formulation's pooled salt list still produces a recipe, still solves, and
 * still looks plausible — it just silently gives a Calcium-only Part A the
 * Monopotassium Phosphate that belonged to Part B. Only comparing the reloaded
 * checkboxes against the ones that went in shows it.
 *
 * Runs the real payload builder from the Recipe screen through the real
 * hydration the load path uses, with a JSON round-trip in between so anything
 * that doesn't survive serialization counts as lost.
 *
 * Run with: npm run verify:roundtrip
 */

import type { PartAnalysis } from "@/components/hydro-calc/guaranteed-analysis-screen"
import type { NutrientPart } from "@/components/hydro-calc/feeding-rates-screen"
import {
  buildSavedPartSalts,
  FORMULATION_SCHEMA_VERSION,
  hydrateSavedFeedingParts,
  hydrateSavedPartsAnalysis,
  unwrapSavedFormulation,
} from "@/lib/hydro-calc/formulation-persistence"
import {
  convertDoseValue,
  convertStockTankSize,
  DEFAULT_INCLUDED_SALTS,
  DEFAULT_STOCK_TANK_SIZE,
  DIRECT_MIX_RESERVOIR_SIZE,
  getDoseGramsPerGallon,
  LITERS_PER_GALLON,
  SALT_CHECKBOX_OPTIONS,
  unionIncludedSalts,
  type DoseUnit,
  type IncludedSaltsSelection,
  type VolumeUnit,
} from "@/lib/hydro-calc/recipe-types"

const SALT_IDS: Array<keyof IncludedSaltsSelection> = SALT_CHECKBOX_OPTIONS.map((option) => option.id)

let failures = 0

function check(passed: boolean, description: string, detail?: string) {
  if (passed) {
    console.log(`  ✅ ${description}`)
    return
  }
  failures += 1
  console.log(`  ❌ ${description}`)
  if (detail) console.log(`     ${detail}`)
}

function salts(...checked: Array<keyof IncludedSaltsSelection>): IncludedSaltsSelection {
  const selection = { ...DEFAULT_INCLUDED_SALTS }
  for (const key of checked) selection[key] = true
  return selection
}

function checkedSaltNames(selection: IncludedSaltsSelection): string {
  const names = SALT_CHECKBOX_OPTIONS.filter((option) => selection[option.id]).map((option) => option.label)
  return names.length > 0 ? names.join(", ") : "(none)"
}

function sameSelection(a: IncludedSaltsSelection, b: IncludedSaltsSelection): boolean {
  return SALT_IDS.every((id) => a[id] === b[id])
}

function part(overrides: Partial<PartAnalysis> & Pick<PartAnalysis, "id" | "name" | "includedSalts">): PartAnalysis {
  return {
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
    ...overrides,
  }
}

/**
 * A four-part line with a genuinely different selection on every bottle: a
 * Calcium/Nitrogen base, a phosphate-and-Potassium bloom bottle, a Magnesium
 * supplement, and a micronutrient bottle. No two parts share a salt list, and
 * the pooled list is broader than any of them — so any load that reaches for
 * the pooled list shows up as extra boxes rather than as a near miss.
 */
const FOUR_PART_LINE: PartAnalysis[] = [
  part({
    id: "part-a",
    name: "Part A",
    nitrogen: "8",
    calcium: "10",
    includedSalts: salts("calciumNitrate"),
  }),
  part({
    id: "part-b",
    name: "Part B",
    phosphate: "12",
    potash: "14",
    sulfur: "3",
    includedSalts: salts("monoPotassiumPhosphate", "potassiumSulfate"),
  }),
  part({
    id: "part-c",
    name: "Part C",
    magnesium: "4",
    sulfur: "5",
    includedSalts: salts("magnesiumSulfate"),
  }),
  part({
    id: "part-d",
    name: "Part D",
    iron: "0.35",
    manganese: "0.1",
    zinc: "0.05",
    boron: "0.05",
    copper: "0.05",
    molybdenum: "0.003",
    includedSalts: salts("chelatedMicronutrients"),
  }),
]

const FOUR_PART_FEEDING: NutrientPart[] = FOUR_PART_LINE.map((analysisPart, index) => ({
  id: analysisPart.id,
  name: analysisPart.name,
  dose: String(2 + index),
  unit: "ml_per_gallon",
}))

/**
 * The part of the "Save to Dashboard" payload this check is about, built the
 * same way `recipe-screen.tsx` builds it. The tank breakdown the Feeding
 * Scheduler reads is exercised by `verify:ppm` and left out here.
 */
function buildSavePayload(partsAnalysis: PartAnalysis[], parts: NutrientPart[]) {
  return {
    formulationSchemaVersion: FORMULATION_SCHEMA_VERSION,
    partsAnalysis: partsAnalysis.map(({ photoUrl: _photoUrl, photoName: _photoName, ...rest }) => rest),
    partSalts: buildSavedPartSalts(partsAnalysis),
    parts,
    stockTankOption: "per-part",
    includedSalts: unionIncludedSalts(partsAnalysis),
    stockTankSize: "5",
    stockTankUnit: "gallons",
    concentrationRatio: 100,
    targetEc: 2.1,
  }
}

/** Whatever the save wrote, as a loader receives it. */
function throughJson<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value))
}

function reportPerPartRoundTrip() {
  console.log("\n=== Per-part salts survive save → load (4-part line, different salts each) ===")

  const saved = unwrapSavedFormulation(throughJson(buildSavePayload(FOUR_PART_LINE, FOUR_PART_FEEDING)))
  const loaded = hydrateSavedPartsAnalysis(saved)

  if (!loaded) {
    check(false, "load rebuilt the parts", "hydrateSavedPartsAnalysis returned null")
    return
  }

  check(loaded.length === FOUR_PART_LINE.length, `all ${FOUR_PART_LINE.length} parts came back`)

  for (const [index, original] of FOUR_PART_LINE.entries()) {
    const reloaded = loaded[index]
    check(
      reloaded !== undefined && sameSelection(reloaded.includedSalts, original.includedSalts),
      `${original.name} salts match exactly`,
      reloaded &&
        `saved [${checkedSaltNames(original.includedSalts)}] → loaded [${checkedSaltNames(reloaded.includedSalts)}]`
    )
    check(
      reloaded?.id === original.id && reloaded?.name === original.name,
      `${original.name} keeps its id and name`
    )
    check(
      reloaded?.nitrogen === original.nitrogen &&
        reloaded?.phosphate === original.phosphate &&
        reloaded?.potash === original.potash &&
        reloaded?.calcium === original.calcium &&
        reloaded?.magnesium === original.magnesium &&
        reloaded?.sulfur === original.sulfur &&
        reloaded?.iron === original.iron &&
        reloaded?.molybdenum === original.molybdenum,
      `${original.name} guaranteed analysis matches`
    )
  }

  // The whole point: the pooled list is broader than any single part's, so no
  // part may come back holding it.
  const pooled = unionIncludedSalts(FOUR_PART_LINE)
  const partsHoldingPooledList = loaded.filter((loadedPart) => sameSelection(loadedPart.includedSalts, pooled))
  check(
    partsHoldingPooledList.length === 0,
    "no part was handed the formulation-wide salt list",
    partsHoldingPooledList.length > 0
      ? `${partsHoldingPooledList.map((p) => p.name).join(", ")} came back with [${checkedSaltNames(pooled)}]`
      : undefined
  )

  const feedingParts = hydrateSavedFeedingParts(saved)
  check(
    feedingParts !== null &&
      feedingParts.length === FOUR_PART_FEEDING.length &&
      feedingParts.every(
        (loadedPart, index) =>
          loadedPart.id === FOUR_PART_FEEDING[index].id &&
          loadedPart.dose === FOUR_PART_FEEDING[index].dose &&
          loadedPart.unit === FOUR_PART_FEEDING[index].unit
      ),
    "feeding rates and dose units come back unchanged"
  )
}

/**
 * A consumer that rebuilds `partsAnalysis` from the fields it knows about
 * drops `includedSalts` without saying so. `partSalts` is the second place the
 * per-part selection is written for exactly this case.
 */
function reportPartsAnalysisStrippedOfSalts() {
  console.log("\n=== Per-part salts survive a save whose partsAnalysis lost them ===")

  const payload = buildSavePayload(FOUR_PART_LINE, FOUR_PART_FEEDING)
  const stripped = throughJson({
    ...payload,
    partsAnalysis: payload.partsAnalysis.map(({ includedSalts: _includedSalts, ...rest }) => rest),
  })

  const loaded = hydrateSavedPartsAnalysis(unwrapSavedFormulation(stripped))
  if (!loaded) {
    check(false, "load rebuilt the parts", "hydrateSavedPartsAnalysis returned null")
    return
  }

  for (const [index, original] of FOUR_PART_LINE.entries()) {
    check(
      sameSelection(loaded[index].includedSalts, original.includedSalts),
      `${original.name} recovered its own salts from partSalts`,
      `saved [${checkedSaltNames(original.includedSalts)}] → loaded [${checkedSaltNames(loaded[index].includedSalts)}]`
    )
  }
}

/**
 * A save from before per-part selection existed: one salt list for the whole
 * formulation and nothing per-part. The right answer can't be recovered, so
 * the bar is that each part keeps only salts its own label could be sourcing —
 * and that no part is handed the full list.
 */
function reportLegacyGlobalSaltsSave() {
  console.log("\n=== Legacy save with one formulation-wide salt list degrades safely ===")

  const pooled = unionIncludedSalts(FOUR_PART_LINE)
  const legacySave = throughJson({
    partsAnalysis: FOUR_PART_LINE.map(({ includedSalts: _includedSalts, ...rest }) => rest),
    parts: FOUR_PART_FEEDING,
    includedSalts: pooled,
    stockTankOption: "ab",
    stockTankSize: "5",
  })

  const loaded = hydrateSavedPartsAnalysis(unwrapSavedFormulation(legacySave))
  if (!loaded) {
    check(false, "load rebuilt the parts", "hydrateSavedPartsAnalysis returned null")
    return
  }

  check(
    loaded.every((loadedPart) => !sameSelection(loadedPart.includedSalts, pooled)),
    "no part was handed the formulation-wide salt list",
    loaded.map((p) => `${p.name}: [${checkedSaltNames(p.includedSalts)}]`).join(" | ")
  )
  check(
    loaded.every((loadedPart) => SALT_IDS.filter((id) => loadedPart.includedSalts[id]).length < SALT_IDS.length),
    "no part was handed a full salt kit"
  )

  // Part A declares Calcium and Nitrogen only, so the phosphate, Potassium,
  // Magnesium and micronutrient salts from the other bottles must not land on it.
  const partA = loaded[0]
  check(
    !partA.includedSalts.monoPotassiumPhosphate &&
      !partA.includedSalts.potassiumSulfate &&
      !partA.includedSalts.magnesiumSulfate &&
      !partA.includedSalts.chelatedMicronutrients,
    "Part A (Ca + N only) kept none of the other bottles' salts",
    `Part A: [${checkedSaltNames(partA.includedSalts)}]`
  )
  check(partA.includedSalts.calciumNitrate, "Part A kept Calcium Nitrate, which its analysis supports")

  // Part B declares P, K and S — and no Calcium, Magnesium or micros.
  const partB = loaded[1]
  check(
    partB.includedSalts.monoPotassiumPhosphate &&
      partB.includedSalts.potassiumSulfate &&
      !partB.includedSalts.calciumNitrate &&
      !partB.includedSalts.magnesiumSulfate &&
      !partB.includedSalts.chelatedMicronutrients,
    "Part B (P + K + S) kept its phosphate and sulfate and nothing else",
    `Part B: [${checkedSaltNames(partB.includedSalts)}]`
  )

  const partD = loaded[3]
  check(
    partD.includedSalts.chelatedMicronutrients &&
      !partD.includedSalts.calciumNitrate &&
      !partD.includedSalts.monoPotassiumPhosphate,
    "Part D (micros only) kept only the micronutrient package",
    `Part D: [${checkedSaltNames(partD.includedSalts)}]`
  )

  check(
    loaded.every((loadedPart) => SALT_IDS.some((id) => loadedPart.includedSalts[id])),
    "every part still has at least one salt, so the wizard isn't blocked",
    loaded.map((p) => `${p.name}: [${checkedSaltNames(p.includedSalts)}]`).join(" | ")
  )
}

/**
 * The oldest saves have no salt information anywhere. Nothing may be invented
 * for them — the Guaranteed Analysis screen already asks the grower to pick,
 * which beats a list they'd have to audit against the bottle to find wrong.
 */
function reportSaveWithNoSaltsAtAll() {
  console.log("\n=== Save with no salt information invents nothing ===")

  const bareSave = throughJson({
    partsAnalysis: FOUR_PART_LINE.map(({ includedSalts: _includedSalts, ...rest }) => rest),
    parts: FOUR_PART_FEEDING,
  })

  const loaded = hydrateSavedPartsAnalysis(unwrapSavedFormulation(bareSave))
  if (!loaded) {
    check(false, "load rebuilt the parts", "hydrateSavedPartsAnalysis returned null")
    return
  }

  check(
    loaded.every((loadedPart) => SALT_IDS.every((id) => !loadedPart.includedSalts[id])),
    "every part came back with nothing checked",
    loaded.map((p) => `${p.name}: [${checkedSaltNames(p.includedSalts)}]`).join(" | ")
  )
  check(
    loaded.every((loadedPart, index) => loadedPart.calcium === FOUR_PART_LINE[index].calcium),
    "the guaranteed analysis still loaded, so only the salts are left to pick"
  )
}

/** Legacy migrations that have to keep working: `ironChelate`, and a row-wrapped response. */
function reportLegacyFieldMigrations() {
  console.log("\n=== Legacy field migrations ===")

  const ironChelateSave = throughJson({
    partsAnalysis: [
      {
        ...FOUR_PART_LINE[3],
        includedSalts: { ironChelate: true, other: true, otherText: "kelp" },
      },
    ],
  })
  const ironChelateLoaded = hydrateSavedPartsAnalysis(unwrapSavedFormulation(ironChelateSave))
  check(
    ironChelateLoaded?.[0].includedSalts.chelatedMicronutrients === true,
    "ironChelate becomes the chelated micronutrient package",
    ironChelateLoaded ? `[${checkedSaltNames(ironChelateLoaded[0].includedSalts)}]` : undefined
  )
  check(
    ironChelateLoaded !== null &&
      SALT_IDS.filter((id) => ironChelateLoaded[0].includedSalts[id]).length === 1,
    "the dropped other/otherText fields add nothing"
  )

  const rowWrapped = throughJson({
    id: "row-id",
    user_id: "user-id",
    name: "Saved row",
    data: buildSavePayload(FOUR_PART_LINE, FOUR_PART_FEEDING),
  })
  const rowLoaded = hydrateSavedPartsAnalysis(unwrapSavedFormulation(rowWrapped))
  check(
    rowLoaded !== null &&
      rowLoaded.every((loadedPart, index) =>
        sameSelection(loadedPart.includedSalts, FOUR_PART_LINE[index].includedSalts)
      ),
    "a formulation nested under a stored row's `data` still loads per-part"
  )
}

/**
 * The liters feed chart reads per 10 L (`CHART_DOSE_LITERS`), because that's
 * what a metric chart prints. Nothing on screen says so once the number reaches
 * the solver, which is what makes a wrong basis here so quiet: a per-10 L rate
 * mistaken for per-litre still solves, still balances, and still looks
 * plausible — it just feeds the plants ten times what the grower asked for.
 *
 * So the bar is that the three ways of writing one dose are one dose. 29 mL/10 L
 * is 2.9 mL/L is 10.978 mL/gal, and all three have to arrive at the solver's
 * per-gallon basis as the same number.
 */
function reportDoseUnitBasis() {
  console.log("\n=== One dose, three units, one feed ===")

  const dose = (value: string, unit: DoseUnit): NutrientPart => ({
    id: "a",
    name: "Part A",
    dose: value,
    unit,
  })

  // 29 mL per 10 L is the shape of an Athena/Canna chart line.
  const perTenLiters = getDoseGramsPerGallon(dose("29", "ml_per_10L"))
  const perLiter = getDoseGramsPerGallon(dose("2.9", "ml_per_liter"))
  const perGallon = getDoseGramsPerGallon(dose(String(2.9 * LITERS_PER_GALLON), "ml_per_gallon"))

  const agree = (a: number, b: number) => Math.abs(a - b) <= Math.abs(a) * 1e-9
  check(
    agree(perTenLiters, perLiter),
    "29 mL/10 L is the same feed as 2.9 mL/L",
    `${perTenLiters} vs ${perLiter} g/gal`
  )
  check(
    agree(perTenLiters, perGallon),
    "29 mL/10 L is the same feed as its mL/gal equivalent",
    `${perTenLiters} vs ${perGallon} g/gal`
  )
  check(
    // 29 mL/10 L × 1.2 g/mL ÷ 10 L × 3.785 L/gal
    agree(perTenLiters, ((29 * 1.2) / 10) * LITERS_PER_GALLON),
    "the per-gallon grams are the literal unit conversion, not a tenfold miss",
    `${perTenLiters} g/gal`
  )

  // Flipping the toggle re-quotes the number rather than reinterpreting it, so
  // the dose has to survive the flip — to within the rounding the rewritten
  // value is deliberately held to (`CONVERTED_AMOUNT_TOLERANCE`), since a
  // grower is shown 10.9777 rather than 10.977694274 mL/gal.
  const toGallons = convertDoseValue("29", "ml_per_10L", "ml_per_gallon")
  const flipped = getDoseGramsPerGallon(dose(toGallons, "ml_per_gallon"))
  check(
    Math.abs(flipped - perTenLiters) <= perTenLiters * 1e-5,
    "flipping 29 mL/10 L to gallons keeps the dose",
    `29 mL/10 L → ${toGallons} mL/gal (${flipped} vs ${perTenLiters} g/gal)`
  )
  check(
    convertDoseValue(toGallons, "ml_per_gallon", "ml_per_10L") === "29",
    "and flipping it back reads 29 again, not 28.999…",
    `→ ${convertDoseValue(toGallons, "ml_per_gallon", "ml_per_10L")}`
  )
  check(
    convertDoseValue("", "ml_per_10L", "ml_per_gallon") === "" &&
      convertDoseValue(".", "ml_per_10L", "ml_per_gallon") === ".",
    "a field the grower hasn't filled in stays empty rather than becoming 0"
  )

  // A save from the first liters mode carries a true per-litre rate. Loading it
  // has to re-quote the number, not just relabel it.
  const legacySave = throughJson({
    partsAnalysis: [FOUR_PART_LINE[0]],
    parts: [dose("2.9", "ml_per_liter")],
  })
  const loaded = hydrateSavedFeedingParts(unwrapSavedFormulation(legacySave))
  check(
    loaded?.[0].unit === "ml_per_10L",
    "a legacy per-litre save loads onto the per-10 L basis",
    `unit came back as ${loaded?.[0].unit}`
  )
  check(
    loaded !== null && agree(getDoseGramsPerGallon(loaded[0]), perLiter),
    "and it's still the same feed it was saved as",
    loaded ? `2.9 ml/L → ${loaded[0].dose} ${loaded[0].unit}` : undefined
  )
}

/**
 * The tank/reservoir size field starts on a round number in whichever unit it's
 * showing, rather than on a conversion of the other unit's round number — a
 * grower who has typed nothing should never be looking at 18.927 L. A size they
 * did type is converted like any other volume, since it's theirs.
 */
function reportRoundDefaultSizes() {
  console.log("\n=== Untouched default sizes stay round across a unit flip ===")

  const cases: Array<[string, VolumeUnit, VolumeUnit, string]> = [
    [DEFAULT_STOCK_TANK_SIZE.gallons, "gallons", "liters", DEFAULT_STOCK_TANK_SIZE.liters],
    [DEFAULT_STOCK_TANK_SIZE.liters, "liters", "gallons", DEFAULT_STOCK_TANK_SIZE.gallons],
    [DIRECT_MIX_RESERVOIR_SIZE.gallons, "gallons", "liters", DIRECT_MIX_RESERVOIR_SIZE.liters],
    [DIRECT_MIX_RESERVOIR_SIZE.liters, "liters", "gallons", DIRECT_MIX_RESERVOIR_SIZE.gallons],
  ]
  for (const [value, from, to, expected] of cases) {
    const converted = convertStockTankSize(value, from, to)
    check(
      converted === expected,
      `${value} ${from} flips to ${expected} ${to}`,
      `got ${converted}`
    )
  }

  // A size the grower typed is not a default, so it converts normally.
  check(
    convertStockTankSize("13", "gallons", "liters") === "49.21",
    "a size the grower typed is converted, not swapped",
    `13 gallons → ${convertStockTankSize("13", "gallons", "liters")} liters`
  )
}

console.log("Formulation save → load round-trip verification")
reportDoseUnitBasis()
reportRoundDefaultSizes()
reportPerPartRoundTrip()
reportPartsAnalysisStrippedOfSalts()
reportLegacyGlobalSaltsSave()
reportSaveWithNoSaltsAtAll()
reportLegacyFieldMigrations()

console.log(
  failures === 0
    ? "\nAll round-trip checks passed."
    : `\n${failures} round-trip check${failures === 1 ? "" : "s"} failed.`
)
process.exit(failures === 0 ? 0 : 1)
