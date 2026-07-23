"use client"

import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useToast } from "@/hooks/use-toast"
import {
  HelpCircle,
  ArrowLeft,
  FlaskConical,
  Scale,
  ShoppingCart,
  Beaker,
  AlertTriangle,
  ShieldCheck,
  Sparkles,
  Gauge,
  Info,
  Droplets,
  BookmarkPlus,
  Loader2,
  CalendarPlus,
  CalendarCheck2,
} from "lucide-react"
import {
  addFeedingScheduleEntry,
  getFeedingScheduleEntries,
  formatWeekRanges,
  STAGE_WEEK_COUNT,
  type FeedingStage,
} from "@/lib/hydro-calc/feeding-scheduler"
import { buildFormulationTanksData, type FormulationTankMode } from "@/lib/hydro-calc/formulation-export"
import type { PartAnalysis } from "./guaranteed-analysis-screen"
import type { NutrientPart, StockTankOption } from "./feeding-rates-screen"
import {
  calculateRecipeAction,
  type CalculateRecipeResult,
} from "@/app/actions/calculate-recipe"
import { saveFormulationToDashboardAction } from "@/app/actions/formulations"
import {
  DOSER_PRESET_RATIOS,
  RAW_SALTS,
  checkRecipeSolubility,
  emptyElementalTargets,
  emptySaltAmounts,
  formatEc,
  formatGrams,
  formatMl,
  formatPpm,
  getOrderedSaltEntries,
  hasValidRecipeInput,
  isSeparateNitrogenAvailable,
  LITERS_PER_GALLON,
  MICRO_LABELS,
  pickDoserPresetForRatio,
  roundDownToNiceRatio,
  stockTankMlPerGallon,
  stockTankMlPerLiter,
  unionIncludedSalts,
  type DirectMixRecipe,
  type MicroKey,
  type MultiPartTankRecipe,
  type MultiTankSolubilityReport,
  type PartStockTank,
  type SaltGapWarning,
  type SaltKey,
  type ThreeTankRecipe,
} from "@/lib/hydro-calc/recipe-types"

/** Rendered before the first Server Action response arrives */
const EMPTY_TARGETS = emptyElementalTargets()
const EMPTY_THREE_TANK_RECIPE: ThreeTankRecipe = {
  tank1: emptySaltAmounts(),
  tank2: emptySaltAmounts(),
  tank3: emptySaltAmounts(),
  hasMicroTank: false,
  hasMicronutrients: false,
  warnings: [],
  isApproximate: false,
}
const EMPTY_MULTI_PART_RECIPE: MultiPartTankRecipe = { tanks: [], warnings: [], isApproximate: false }
const EMPTY_DIRECT_RECIPE: DirectMixRecipe = {
  salts: emptySaltAmounts(),
  warnings: [],
  isApproximate: false,
}

/** Debounce for recalculating via the server action while the user is typing */
const CALCULATE_DEBOUNCE_MS = 250

export interface RecipeInitialSettings {
  stockTankSize?: string
  stockTankUnit?: "gallons" | "liters"
  concentrationRatio?: string
  doserLayout?: "per-part" | "separate-ca"
  targetEcInput?: string
  keepMicrosSeparate?: boolean
}

interface RecipeScreenProps {
  partsAnalysis: PartAnalysis[]
  parts: NutrientPart[]
  stockTankOption: StockTankOption
  initialSettings?: RecipeInitialSettings
  onBack: () => void
}

const MICRO_SALT_KEYS = new Set<SaltKey>([
  "ironDTPA",
  "manganeseSulfate",
  "zincSulfate",
  "boricAcid",
  "copperSulfate",
  "sodiumMolybdate",
])

export function RecipeScreen({
  partsAnalysis,
  parts,
  stockTankOption,
  initialSettings = {},
  onBack,
}: RecipeScreenProps) {
  const { toast } = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const [isSaveDashboardModalOpen, setIsSaveDashboardModalOpen] = useState(false)
  const [dashboardFormulationName, setDashboardFormulationName] = useState("")

  const [isSchedulerModalOpen, setIsSchedulerModalOpen] = useState(false)
  const [isSavingSchedulerEntry, setIsSavingSchedulerEntry] = useState(false)
  const [schedulerRecipeName, setSchedulerRecipeName] = useState("")
  const [schedulerStage, setSchedulerStage] = useState<FeedingStage>("Vegetative")
  const [schedulerWeeks, setSchedulerWeeks] = useState<Set<number>>(new Set())
  const [schedulerNotes, setSchedulerNotes] = useState("")
  const [schedulerEntryCount, setSchedulerEntryCount] = useState(0)

  // Pick up any entries already saved (Clerk or localStorage) so the "Added
  // to Scheduler" indicator reflects reality across reloads, not just this session.
  useEffect(() => {
    let isMounted = true
    getFeedingScheduleEntries()
      .then((entries) => {
        if (isMounted) setSchedulerEntryCount(entries.length)
      })
      .catch((err) => {
        console.error("Failed to load feeding schedule entries:", err)
      })
    return () => {
      isMounted = false
    }
  }, [])

  const [stockTankSize, setStockTankSize] = useState(initialSettings.stockTankSize ?? "5")
  const [stockTankUnit, setStockTankUnit] = useState<"gallons" | "liters">(
    initialSettings.stockTankUnit ?? "gallons"
  )
  const [concentrationRatio, setConcentrationRatio] = useState(
    initialSettings.concentrationRatio ?? "100"
  )
  // Once the user types a custom value, we stop auto-syncing the input to the
  // recommended ratio so we never overwrite their choice mid-edit.
  // If we loaded a saved ratio, treat it as manual so the auto-sync won't overwrite it.
  const [ratioIsManual, setRatioIsManual] = useState(!!initialSettings.concentrationRatio)

  const [targetEcInput, setTargetEcInput] = useState(initialSettings.targetEcInput ?? "")
  const [targetEcIsManual, setTargetEcIsManual] = useState(!!initialSettings.targetEcInput)

  // Sub-layout toggle for doser mode: one tank per part vs. separate Ca(NO₃)₂ tank
  const [doserLayout, setDoserLayout] = useState<"per-part" | "separate-ca">(
    initialSettings.doserLayout ?? "per-part"
  )

  // Advanced option for the Separate Nitrogen layout: by default micronutrients
  // are folded into Tank 2 for a clean 2-tank system. Power users can flip this
  // to keep micros isolated in their own Tank 3 instead.
  const [keepMicrosSeparate, setKeepMicrosSeparate] = useState(
    initialSettings.keepMicrosSeparate ?? false
  )

  // Reset to per-part when the recipe grows beyond 3 parts (separate Ca requires ≤3)
  useEffect(() => {
    if (stockTankOption === "doser" && !isSeparateNitrogenAvailable(parts.length)) {
      setDoserLayout("per-part")
    }
  }, [stockTankOption, parts.length])

  // Default the size field to 1 gal when the user is in direct-mix mode
  // (the field represents reservoir size there, not stock tank size)
  useEffect(() => {
    if (stockTankOption === "direct") {
      setStockTankSize("1")
      setStockTankUnit("gallons")
    }
  }, [stockTankOption])

  // Separate Ca option is only offered in doser mode with ≤3 parts
  const canSeparateCalciumInDoser =
    stockTankOption === "doser" && isSeparateNitrogenAvailable(parts.length)

  const usesPerPartTanks =
    (stockTankOption === "doser" && doserLayout === "per-part") || stockTankOption === "ab"
  const usesSeparateNitrogenLayout =
    stockTankOption === "separate" ||
    (canSeparateCalciumInDoser && doserLayout === "separate-ca")

  const stockVolumeLiters = useMemo(() => {
    const size = parseFloat(stockTankSize) || 5
    return stockTankUnit === "gallons" ? size * LITERS_PER_GALLON : size
  }, [stockTankSize, stockTankUnit])

  const dilutionRatio = parseFloat(concentrationRatio) || 100

  // The actual recipe math (elemental targets, salt solving, EC estimate)
  // runs exclusively on the server via `calculateRecipeAction` — this
  // component only sends inputs and renders the plain-data result it gets
  // back. See `lib/hydro-calc/recipe-calculator.ts` and
  // `app/actions/calculate-recipe.ts`.
  const [calcResult, setCalcResult] = useState<CalculateRecipeResult | null>(null)
  const [isCalculating, setIsCalculating] = useState(false)
  const calcRequestIdRef = useRef(0)
  const hasCalculatedOnceRef = useRef(false)

  useEffect(() => {
    const requestId = ++calcRequestIdRef.current
    const delay = hasCalculatedOnceRef.current ? CALCULATE_DEBOUNCE_MS : 0

    const timer = setTimeout(() => {
      setIsCalculating(true)
      calculateRecipeAction({
        partsAnalysis,
        parts,
        stockTankOption,
        stockVolumeLiters,
        dilutionRatio,
        keepMicrosSeparate,
      })
        .then((result) => {
          if (calcRequestIdRef.current !== requestId) return
          hasCalculatedOnceRef.current = true
          setCalcResult(result)
        })
        .catch((err) => {
          console.error("Recipe calculation failed:", err)
        })
        .finally(() => {
          if (calcRequestIdRef.current === requestId) setIsCalculating(false)
        })
    }, delay)

    return () => clearTimeout(timer)
  }, [partsAnalysis, parts, stockTankOption, stockVolumeLiters, dilutionRatio, keepMicrosSeparate])

  const targets = calcResult?.targets ?? EMPTY_TARGETS
  const anchor = calcResult?.anchor ?? null
  const estimated = useMemo(
    () => new Set<MicroKey>(calcResult?.estimatedMicros ?? []),
    [calcResult]
  )
  const estimatedEc = calcResult?.estimatedEc ?? null
  const threeTankRecipe = calcResult?.threeTankRecipe ?? EMPTY_THREE_TANK_RECIPE
  const multiPartRecipe = calcResult?.multiPartRecipe ?? EMPTY_MULTI_PART_RECIPE
  const directRecipe = calcResult?.directRecipe ?? EMPTY_DIRECT_RECIPE

  // Unified warning surface — whichever mode is active drives which recipe's
  // gaps get reported to the user.
  const activeRecipeWarnings: SaltGapWarning[] = useMemo(() => {
    if (stockTankOption === "direct") return directRecipe.warnings
    if (usesSeparateNitrogenLayout) return threeTankRecipe.warnings ?? []
    if (usesPerPartTanks) return multiPartRecipe.warnings ?? []
    return []
  }, [
    stockTankOption,
    usesSeparateNitrogenLayout,
    usesPerPartTanks,
    directRecipe.warnings,
    threeTankRecipe.warnings,
    multiPartRecipe.warnings,
  ])

  const isRecipeApproximate = activeRecipeWarnings.length > 0

  // Solubility-aware safety check for the chosen mode. We feed in the *actual*
  // tank groupings used in the UI so the limiting-salt report matches the
  // bottle the user will be filling.
  //
  // Important: this must be checked against the volume/ratio that the server
  // action actually used to produce these salt amounts (`calcResult`), not
  // the live `stockVolumeLiters`/`dilutionRatio` state. Those can briefly run
  // ahead of `calcResult` while a debounced recalculation is in flight — e.g.
  // right after the auto-sync effect below writes a new recommended ratio
  // into state. Since the safe-ratio formula is only ratio-invariant when the
  // ratio matches the one the grams were computed with, feeding it a
  // still-live (already-bumped) ratio against stale grams makes the reported
  // "safe ratio" balloon on every render — which then feeds right back into
  // that same auto-sync effect and spirals into "Maximum update depth
  // exceeded". Anchoring on `calcResult`'s own basis keeps the two in sync.
  const solubilityBasisVolumeLiters = calcResult?.stockVolumeLiters ?? stockVolumeLiters
  const solubilityBasisDilutionRatio = calcResult?.dilutionRatio ?? dilutionRatio

  const solubilityReport = useMemo(() => {
    if (usesSeparateNitrogenLayout) {
      const tanks = [
        { name: "Tank 1 (Calcium Nitrate)", salts: threeTankRecipe.tank1 },
        { name: "Tank 2 (Macros)", salts: threeTankRecipe.tank2 },
      ]
      if (threeTankRecipe.hasMicroTank) {
        tanks.push({ name: "Tank 3 (Micros)", salts: threeTankRecipe.tank3 })
      }
      return checkRecipeSolubility(tanks, solubilityBasisVolumeLiters, solubilityBasisDilutionRatio)
    }
    if (usesPerPartTanks) {
      return checkRecipeSolubility(
        multiPartRecipe.tanks.map((tank) => ({
          name: `${tank.name} (${tank.partName})`,
          salts: tank.salts,
        })),
        solubilityBasisVolumeLiters,
        solubilityBasisDilutionRatio
      )
    }
    return null
  }, [
    usesSeparateNitrogenLayout,
    usesPerPartTanks,
    threeTankRecipe,
    multiPartRecipe,
    solubilityBasisVolumeLiters,
    solubilityBasisDilutionRatio,
  ])

  // For doser mode we prefer a "real-world doser preset" (1:100, 1:128, 1:200)
  // whenever the recipe is dilute enough. If even 1:100 would precipitate,
  // we fall back to the salt-safe maximum so the warning surfaces correctly.
  const doserPreset = useMemo(() => {
    if (stockTankOption !== "doser" || !solubilityReport) return null
    return pickDoserPresetForRatio(solubilityReport.maxSafeDilutionRatio)
  }, [stockTankOption, solubilityReport])

  const recommendedRatio = useMemo(() => {
    if (!solubilityReport) return null
    if (stockTankOption === "doser" && doserPreset !== null) {
      return doserPreset
    }
    const ratio = roundDownToNiceRatio(solubilityReport.maxSafeDilutionRatio)
    return Number.isFinite(ratio) && ratio > 0 ? ratio : null
  }, [solubilityReport, stockTankOption, doserPreset])

  // Whenever the recommendation changes (different recipe, stock volume, or
  // tank layout) and the user hasn't typed a custom value, snap the input to
  // the recommended ratio. This is what makes the screen "auto-apply" the
  // recommendation as the default.
  useEffect(() => {
    if (ratioIsManual || recommendedRatio === null) return
    const next = String(recommendedRatio)
    if (next !== concentrationRatio) {
      setConcentrationRatio(next)
    }
  }, [recommendedRatio, ratioIsManual, concentrationRatio])

  const handleRatioChange = (value: string) => {
    setConcentrationRatio(value)
    setRatioIsManual(true)
  }

  const resetRatioToRecommended = () => {
    setRatioIsManual(false)
    if (recommendedRatio !== null) {
      setConcentrationRatio(String(recommendedRatio))
    }
  }

  // Sync Target EC input to estimated EC whenever the base recipe changes,
  // unless the user has already typed their own value.
  useEffect(() => {
    if (targetEcIsManual || estimatedEc === null) return
    const next = estimatedEc.toFixed(2)
    if (next !== targetEcInput) setTargetEcInput(next)
  }, [estimatedEc, targetEcIsManual, targetEcInput])

  const handleTargetEcChange = (value: string) => {
    setTargetEcInput(value)
    setTargetEcIsManual(true)
  }

  const resetTargetEc = () => {
    setTargetEcIsManual(false)
    if (estimatedEc !== null) setTargetEcInput(estimatedEc.toFixed(2))
  }

  const parsedTargetEc = parseFloat(targetEcInput)
  // Scale factor applied to every displayed salt amount. Keeping the dilution
  // ratio fixed, scaling the gram amounts up/down changes the nutrient dose
  // proportionally, which shifts the EC by the same factor.
  const ecScaleFactor =
    estimatedEc !== null && estimatedEc > 0 && parsedTargetEc > 0
      ? parsedTargetEc / estimatedEc
      : 1

  // Helper used in inline JSX — applies the EC scale before formatting
  const scaledGrams = (g: number) => formatGrams(g * ecScaleFactor)

  // What to show in the Estimated EC badge
  const displayedEc =
    parsedTargetEc > 0 ? parsedTargetEc : (estimatedEc ?? 0)

  // True when Tank 2 in the Separate Nitrogen layout holds the merged
  // micronutrients (the 2-tank default) — drives the badge/description and
  // the extra "Micronutrients" sub-section rendered inside that card.
  const tank2IncludesMicros = !keepMicrosSeparate && threeTankRecipe.hasMicronutrients

  const hasAnyMicro = anchor !== null
  const hasEstimates = estimated.size > 0

  const hasValidData = hasValidRecipeInput(partsAnalysis, parts)

  const neededSalts = useMemo(() => {
    if (stockTankOption === "direct") {
      return Object.entries(directRecipe.salts).filter(([, amount]) => amount > 0)
    }

    const combined: Record<string, number> = {}
    const tanks = usesSeparateNitrogenLayout
      ? [threeTankRecipe.tank1, threeTankRecipe.tank2, threeTankRecipe.tank3]
      : usesPerPartTanks
        ? multiPartRecipe.tanks.map((tank) => tank.salts)
        : []
    for (const tank of tanks) {
      for (const [key, amount] of Object.entries(tank)) {
        combined[key] = (combined[key] ?? 0) + amount
      }
    }

    return Object.entries(combined).filter(([, amount]) => amount > 0)
  }, [threeTankRecipe, multiPartRecipe, directRecipe, stockTankOption, usesSeparateNitrogenLayout, usesPerPartTanks])

  // Every part's own salt selection, unioned together — used for
  // shopping-list naming below, which isn't part-specific.
  const combinedIncludedSalts = useMemo(() => unionIncludedSalts(partsAnalysis), [partsAnalysis])

  // When the user selected "Chelated Micronutrients" on any part, show the chelated
  // (EDTA/DTPA) product names in the shopping list rather than the raw sulfate
  // salts the solver uses internally for elemental-fraction math.
  const usesChelatedMicros = combinedIncludedSalts.chelatedMicronutrients

  const shoppingItems: Array<{ key: SaltKey; name: string; note: string; disclaimer?: string }> = [
    {
      key: "calciumNitrate",
      name: "Calcium Nitrate",
      note: "Ca(NO₃)₂·4H₂O - tetrahydrate form",
      disclaimer:
        "Make sure you are buying pure Calcium Nitrate (Ca(NO₃)₂). Avoid products that contain added ammoniacal nitrogen or blended fertilizers.",
    },
    {
      key: "calciumCarbonate",
      name: "Calcium Carbonate",
      note: "CaCO₃ - limestone/chalk, a nitrogen-free calcium source",
    },
    { key: "potassiumNitrate", name: "Potassium Nitrate", note: "KNO₃ - also called saltpeter" },
    { key: "monoPotassiumPhosphate", name: "Mono Potassium Phosphate", note: "MKP, KH₂PO₄" },
    { key: "magnesiumSulfate", name: "Magnesium Sulfate", note: "Epsom salt, MgSO₄·7H₂O" },
    { key: "potassiumSulfate", name: "Potassium Sulfate", note: "K₂SO₄ - sulfate of potash" },
    { key: "ammoniumNitrate", name: "Ammonium Nitrate", note: "NH₄NO₃" },
    { key: "ammoniumSulfate", name: "Ammonium Sulfate", note: "(NH₄)₂SO₄" },
    {
      key: "ironDTPA",
      name: "Iron DTPA 11%",
      note: usesChelatedMicros ? "Fe-DTPA chelate - chelated iron for hydroponics" : "Fe-DTPA",
    },
    {
      key: "manganeseSulfate",
      name: usesChelatedMicros ? "Manganese EDTA" : "Manganese Sulfate",
      note: usesChelatedMicros ? "Mn-EDTA chelate" : "MnSO₄·H₂O",
    },
    {
      key: "zincSulfate",
      name: usesChelatedMicros ? "Zinc EDTA" : "Zinc Sulfate",
      note: usesChelatedMicros ? "Zn-EDTA chelate" : "ZnSO₄·7H₂O",
    },
    { key: "boricAcid", name: "Boric Acid", note: "H₃BO₃ - powder form" },
    {
      key: "copperSulfate",
      name: usesChelatedMicros ? "Copper EDTA" : "Copper Sulfate",
      note: usesChelatedMicros ? "Cu-EDTA chelate" : "CuSO₄·5H₂O - pentahydrate",
    },
    { key: "sodiumMolybdate", name: "Sodium Molybdate", note: "Na₂MoO₄·2H₂O" },
  ]

  const neededSaltKeys = new Set<string>(neededSalts.map(([key]) => key))

  const stockTankUsageLabels = useMemo(() => {
    if (stockTankOption === "direct") return []
    if (usesSeparateNitrogenLayout) {
      const labels = ["Tank 1", "Tank 2"]
      if (threeTankRecipe.hasMicroTank) labels.push("Tank 3")
      return labels
    }
    if (usesPerPartTanks) {
      return multiPartRecipe.tanks.map((tank) => tank.name)
    }
    return []
  }, [
    stockTankOption,
    usesSeparateNitrogenLayout,
    usesPerPartTanks,
    threeTankRecipe.hasMicroTank,
    multiPartRecipe.tanks,
  ])

  // How many stock tanks the doser safety banner should reference
  const doserTankCount = useMemo(() => {
    if (stockTankOption !== "doser") return 0
    if (canSeparateCalciumInDoser && doserLayout === "separate-ca") {
      return 2 + (threeTankRecipe.hasMicroTank ? 1 : 0)
    }
    return multiPartRecipe.tanks.length
  }, [stockTankOption, canSeparateCalciumInDoser, doserLayout, threeTankRecipe.hasMicroTank, multiPartRecipe.tanks.length])

  const mlPerGallon = stockTankMlPerGallon(dilutionRatio)
  const mlPerLiter = stockTankMlPerLiter(dilutionRatio)

  // Direct-mix amounts are already sized for the whole reservoir (no stock
  // tank being diluted), so there's no meaningful dilution ratio there.
  const effectiveDilutionRatio = stockTankOption === "direct" ? 1 : dilutionRatio

  const formulationMode: FormulationTankMode = usesSeparateNitrogenLayout
    ? "separate-nitrogen"
    : usesPerPartTanks
      ? "per-part"
      : "direct"

  // The full per-tank ingredient + mixing breakdown, in the shape the
  // standalone Feeding Scheduler's import parser expects. Built from the
  // exact same recipe results rendered above, so it always matches what the
  // user sees on this screen.
  const formulationTanksData = useMemo(
    () =>
      buildFormulationTanksData({
        mode: formulationMode,
        threeTankRecipe,
        multiPartRecipe,
        directRecipe,
        ecScaleFactor,
        stockTankSize,
        stockTankUnit,
        dilutionRatio: effectiveDilutionRatio,
        isDoser: stockTankOption === "doser",
      }),
    [
      formulationMode,
      threeTankRecipe,
      multiPartRecipe,
      directRecipe,
      ecScaleFactor,
      stockTankSize,
      stockTankUnit,
      effectiveDilutionRatio,
      stockTankOption,
    ]
  )

  // Sensible starting point for a formulation's name — there's no dedicated
  // "formulation name" input yet, so we fall back to a name built from the
  // nutrient parts currently in the recipe. Used both for Save to Dashboard
  // and as the default in the "Add to Feeding Scheduler" modal.
  const defaultSchedulerRecipeName = useMemo(() => {
    const partNames = parts.map((p) => p.name.trim()).filter(Boolean)
    return partNames.length > 0 ? `${partNames.join(" + ")} Recipe` : "My Recipe"
  }, [parts])

  // Sensible fallback when the user submits the naming modal without typing
  // anything — includes today's date so multiple untitled saves stay
  // distinguishable on the dashboard.
  const buildUntitledFormulationName = () =>
    `Untitled Formulation - ${new Date().toLocaleDateString()}`

  const openSaveDashboardModal = () => {
    setDashboardFormulationName(defaultSchedulerRecipeName)
    setIsSaveDashboardModalOpen(true)
  }

  const handleSaveToDashboard = async () => {
    if (isSaving) return
    setIsSaving(true)
    try {
      const formulationName = dashboardFormulationName.trim() || buildUntitledFormulationName()
      const resolvedTargetEc = parsedTargetEc > 0 ? parsedTargetEc : estimatedEc
      const payload = {
        // Strip local blob URLs from photo fields before sending. Each part
        // already carries its own `includedSalts` selection; the top-level
        // `includedSalts` below is kept only for backward compatibility with
        // consumers that still expect the old global shape (it's the union
        // of every part's selection).
        partsAnalysis: partsAnalysis.map(({ photoUrl: _photoUrl, photoName: _photoName, ...p }) => p),
        parts,
        stockTankOption,
        includedSalts: combinedIncludedSalts,
        stockTankSize,
        stockTankUnit,
        concentrationRatio: dilutionRatio,
        targetEc: resolvedTargetEc,
        ecScaleFactor,
        elementalTargets: targets,
        estimatedEc,
        doserLayout: stockTankOption === "doser" ? doserLayout : undefined,
        keepMicrosSeparate: usesSeparateNitrogenLayout ? keepMicrosSeparate : undefined,
        savedAt: new Date().toISOString(),

        // --- Rich tank breakdown for the Feeding Scheduler import parser ---
        id: crypto.randomUUID(),
        name: formulationName,
        createdAt: new Date().toISOString(),
        targetEC: resolvedTargetEc ?? undefined,
        dilutionRatio: effectiveDilutionRatio,
        defaultStockTankSize: formulationTanksData.defaultStockTankSize,
        usageRates: formulationTanksData.usageRates,
        tanks: formulationTanksData.tanks,
      }

      const result = await saveFormulationToDashboardAction(payload)

      if (!result.ok) {
        throw new Error(
          result.reason === "unauthenticated"
            ? "Please sign in to save formulations to your dashboard."
            : result.message
        )
      }

      setIsSaveDashboardModalOpen(false)
      toast({
        title: "Formulation saved to Dashboard",
        description: `Saved as "${formulationName}". You can view and manage it on your main dashboard.`,
      })
    } catch (err) {
      toast({
        title: "Failed to save formulation",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const openSchedulerModal = () => {
    setSchedulerRecipeName(defaultSchedulerRecipeName)
    setSchedulerStage("Vegetative")
    setSchedulerWeeks(new Set())
    setSchedulerNotes("")
    setIsSchedulerModalOpen(true)
  }

  const handleSchedulerStageChange = (value: string) => {
    setSchedulerStage(value as FeedingStage)
    // Week ranges differ per stage, so clear the selection to avoid carrying
    // over weeks that don't exist in the newly selected stage.
    setSchedulerWeeks(new Set())
  }

  const toggleSchedulerWeek = (week: number) => {
    setSchedulerWeeks((prev) => {
      const next = new Set(prev)
      if (next.has(week)) {
        next.delete(week)
      } else {
        next.add(week)
      }
      return next
    })
  }

  const schedulerWeekCount = STAGE_WEEK_COUNT[schedulerStage]
  const selectAllSchedulerWeeks = () =>
    setSchedulerWeeks(new Set(Array.from({ length: schedulerWeekCount }, (_, i) => i + 1)))
  const clearSchedulerWeeks = () => setSchedulerWeeks(new Set())

  const handleSaveToScheduler = async () => {
    if (isSavingSchedulerEntry) return

    const trimmedName = schedulerRecipeName.trim()
    if (!trimmedName) {
      toast({
        title: "Recipe name required",
        description: "Give this recipe a name before adding it to the scheduler.",
        variant: "destructive",
      })
      return
    }
    if (schedulerWeeks.size === 0) {
      toast({
        title: "Select at least one week",
        description: "Choose which weeks this recipe applies to.",
        variant: "destructive",
      })
      return
    }

    setIsSavingSchedulerEntry(true)
    try {
      const trimmedNotes = schedulerNotes.trim()
      const resolvedTargetEc = parsedTargetEc > 0 ? parsedTargetEc : estimatedEc
      const entry = await addFeedingScheduleEntry({
        recipeName: trimmedName,
        stage: schedulerStage,
        weeks: Array.from(schedulerWeeks),
        notes: trimmedNotes || undefined,

        // --- Rich tank breakdown so the scheduler can render real tank
        // cards instead of falling back to a dummy starter tank ---
        targetEC: resolvedTargetEc ?? undefined,
        dilutionRatio: effectiveDilutionRatio,
        defaultStockTankSize: formulationTanksData.defaultStockTankSize,
        usageRates: formulationTanksData.usageRates,
        tanks: formulationTanksData.tanks,
      })

      setSchedulerEntryCount((count) => count + 1)
      setIsSchedulerModalOpen(false)

      toast({
        title: "Added to Feeding Scheduler",
        description: `${entry.recipeName} — ${entry.stage}, ${formatWeekRanges(entry.weeks)}`,
      })
    } catch (err) {
      toast({
        title: "Failed to add to Feeding Scheduler",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsSavingSchedulerEntry(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Stock Tank Settings / Reservoir Size */}
      <Card className="border-2 border-border bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl text-foreground">
            <FlaskConical className="h-5 w-5 text-primary" />
            <span>{stockTankOption === "direct" ? "Reservoir Size" : "Stock Tank Settings"}</span>
          </CardTitle>
          <CardDescription>
            {stockTankOption === "direct"
              ? "How big is your reservoir and what is your target EC"
              : "How big are your stock tanks, and how much do you want to dilute them?"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-6">
            <div className="min-w-[200px]">
              <Label htmlFor="stock-size" className="mb-1.5 block text-sm font-medium">
                {stockTankOption === "direct" ? "Reservoir Size" : "Stock Tank Size"}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="stock-size"
                  type="number"
                  min="1"
                  max="100"
                  value={stockTankSize}
                  onChange={(e) => setStockTankSize(e.target.value)}
                  className="w-24 border-2 border-border"
                />
                <div className="flex rounded-lg border-2 border-border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setStockTankUnit("gallons")}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                      stockTankUnit === "gallons"
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground hover:bg-secondary/80"
                    }`}
                  >
                    gal
                  </button>
                  <button
                    type="button"
                    onClick={() => setStockTankUnit("liters")}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors border-l-2 border-border ${
                      stockTankUnit === "liters"
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground hover:bg-secondary/80"
                    }`}
                  >
                    L
                  </button>
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {stockTankUnit === "gallons"
                  ? `= ${(parseFloat(stockTankSize || "0") * LITERS_PER_GALLON).toFixed(1)} liters`
                  : `= ${(parseFloat(stockTankSize || "0") / LITERS_PER_GALLON).toFixed(2)} gallons`}
              </p>
            </div>
            {stockTankOption !== "direct" && (
              <div className="min-w-[150px]">
                <Label htmlFor="ratio" className="mb-1.5 block text-sm font-medium">
                  {stockTankOption === "doser" ? "Doser / Injector Ratio" : "Dilution Ratio"}
                </Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">1 :</span>
                  <Input
                    id="ratio"
                    type="number"
                    min="10"
                    max="500"
                    value={concentrationRatio}
                    onChange={(e) => handleRatioChange(e.target.value)}
                    className="w-24 border-2 border-border"
                  />
                </div>
                {stockTankOption === "doser" && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {DOSER_PRESET_RATIOS.map((preset) => {
                      const isActive = dilutionRatio === preset
                      return (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => handleRatioChange(String(preset))}
                          className={`rounded-full border-2 px-3 py-1 text-xs font-medium transition-colors ${
                            isActive
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-secondary text-foreground hover:border-primary/50"
                          }`}
                        >
                          1 : {preset}
                        </button>
                      )
                    })}
                  </div>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {stockTankOption === "doser"
                    ? ratioIsManual
                      ? "Set this to the ratio printed on your injector. Most units are fixed at one of the presets above."
                      : "Auto-picked to match a standard doser ratio that keeps your salts safely dissolved."
                    : ratioIsManual
                      ? "You're using a custom value. We recommend the value we picked below."
                      : "Auto-picked from your recipe to keep salts safely dissolved."}
                </p>
              </div>
            )}

            {estimatedEc !== null && (
              <div className="min-w-[150px]">
                <Label htmlFor="target-ec" className="mb-1.5 block text-sm font-medium">
                  Target EC
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="target-ec"
                    type="number"
                    min="0.1"
                    max="10"
                    step="0.1"
                    value={targetEcInput}
                    onChange={(e) => handleTargetEcChange(e.target.value)}
                    className="w-24 border-2 border-border"
                  />
                  <span className="text-sm text-muted-foreground">mS/cm</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {targetEcIsManual && Math.abs(ecScaleFactor - 1) > 0.005
                    ? `All amounts scaled to hit ${parsedTargetEc.toFixed(2)} mS/cm.`
                    : "All amounts adjust automatically when you change this."}
                </p>
                {targetEcIsManual && Math.abs(ecScaleFactor - 1) > 0.005 && (
                  <button
                    type="button"
                    onClick={resetTargetEc}
                    className="mt-1 text-xs text-primary underline-offset-2 hover:underline"
                  >
                    Reset to estimated
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Doser tank layout toggle — only when ≤3 parts so separate Ca is possible */}
          {canSeparateCalciumInDoser && (
            <div className="mt-4 border-t border-border pt-4">
              <Label className="mb-2 block text-sm font-medium">Tank Layout</Label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setDoserLayout("per-part")}
                  className={`flex items-center gap-2 rounded-lg border-2 px-4 py-2 text-sm font-medium transition-all ${
                    doserLayout === "per-part"
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-secondary/20 text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  <Gauge className="h-4 w-4" />
                  One tank per part
                </button>
                <button
                  type="button"
                  onClick={() => setDoserLayout("separate-ca")}
                  className={`flex items-center gap-2 rounded-lg border-2 px-4 py-2 text-sm font-medium transition-all ${
                    doserLayout === "separate-ca"
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-secondary/20 text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  <Droplets className="h-4 w-4" />
                  Separate Calcium Nitrate
                </button>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {doserLayout === "separate-ca"
                  ? "Ca(NO₃)₂ gets its own suction line, making it easy to taper nitrogen at the end of flower."
                  : "One suction line per part in your feed chart — standard doser setup."}
              </p>
            </div>
          )}

          {/* Advanced option — only relevant while the Separate Nitrogen layout is active */}
          {usesSeparateNitrogenLayout && (
            <div className="mt-4 border-t border-border pt-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="keep-micros-separate" className="block text-sm font-medium">
                    Advanced: keep micronutrients in their own tank
                  </Label>
                  <p className="mt-1 max-w-md text-xs text-muted-foreground">
                    By default micronutrients are combined with the other non-nitrogen
                    components into one clean Tank 2. Flip this on to split them out into a
                    separate Tank 3 instead.
                  </p>
                </div>
                <Switch
                  id="keep-micros-separate"
                  checked={keepMicrosSeparate}
                  onCheckedChange={setKeepMicrosSeparate}
                  className="mt-0.5 shrink-0"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Doser mode: show ratio card + safety banner here, right after settings */}
      {hasValidData && stockTankOption === "doser" && solubilityReport && (
        <RecommendedRatioCard
          report={solubilityReport}
          currentRatio={dilutionRatio}
          recommendedRatio={recommendedRatio}
          ratioIsManual={ratioIsManual}
          onReset={resetRatioToRecommended}
          stockTankOption={stockTankOption}
          isDoserPreset={
            (DOSER_PRESET_RATIOS as readonly number[]).includes(recommendedRatio ?? -1)
          }
        />
      )}
      {hasValidData && stockTankOption === "doser" && (
        <MixingSafetyBanner
          option={stockTankOption}
          partCount={doserTankCount}
          separateCaLayout={doserLayout === "separate-ca"}
        />
      )}

      {/* How to Use — hidden in doser mode (injector handles dosing automatically) */}
      {hasValidData && stockTankOption !== "direct" && stockTankOption !== "doser" && stockTankUsageLabels.length > 0 && (
        <StockTankUsageCard
          tankLabels={stockTankUsageLabels}
          dilutionRatio={dilutionRatio}
          mlPerGallon={mlPerGallon}
          mlPerLiter={mlPerLiter}
          isDoser={false}
        />
      )}

      {/* Elemental Targets */}
      <Card className="border-2 border-border bg-card">
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2 text-xl text-foreground">
                <Scale className="h-5 w-5 text-primary" />
                <span>What your plants will get</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-4 w-4 cursor-help text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    The amount of each nutrient (in parts per million, or ppm) your plants will see in
                    the reservoir, based on the label percentages and feed-chart doses you entered.
                  </TooltipContent>
                </Tooltip>
                {isCalculating && hasValidData && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Calculating…
                  </span>
                )}
              </CardTitle>
              <CardDescription>
                How much of each nutrient ends up in your reservoir, in ppm (parts per million).
              </CardDescription>
            </div>
            {hasValidData && estimatedEc !== null && (
              <div className="shrink-0 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <Gauge className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium text-muted-foreground">Estimated EC</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Estimated electrical conductivity of your final reservoir at 25 °C. Calculated
                      from macro-nutrient targets, then adjusted with a real-world buffer to account
                      for chelated micronutrients, pH compounds, and other ionic contributors found
                      in commercial fertilizers. Actual measured EC typically varies by ±0.2 mS/cm
                      depending on your water quality, temperature, and specific product formulation.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <p className="mt-1 font-mono text-2xl font-semibold text-primary">
                  {displayedEc.toFixed(2)}
                </p>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!hasValidData ? (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-foreground">A few more details needed</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Head back to Step 1 and 2 to enter your nutrient label percentages and feed
                  chart doses. Once those are in, we&apos;ll show you the full recipe here.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <TargetCard label="Nitrogen (N)" value={formatPpm(targets.nitrogen)} primary />
                <TargetCard label="Phosphorus (P)" value={formatPpm(targets.phosphorus)} />
                <TargetCard label="Potassium (K)" value={formatPpm(targets.potassium)} primary />
                <TargetCard label="Calcium (Ca)" value={formatPpm(targets.calcium)} />
                <TargetCard label="Magnesium (Mg)" value={formatPpm(targets.magnesium)} />
                <TargetCard label="Sulfur (S)" value={formatPpm(targets.sulfur)} />
                <TargetCard label="Iron (Fe)" value={formatPpm(targets.iron)} micro estimated={estimated.has("iron")} />
                <TargetCard label="Manganese (Mn)" value={formatPpm(targets.manganese)} micro estimated={estimated.has("manganese")} />
                <TargetCard label="Zinc (Zn)" value={formatPpm(targets.zinc)} micro estimated={estimated.has("zinc")} />
                <TargetCard label="Boron (B)" value={formatPpm(targets.boron)} micro estimated={estimated.has("boron")} />
                <TargetCard label="Copper (Cu)" value={formatPpm(targets.copper)} micro estimated={estimated.has("copper")} />
                <TargetCard label="Molybdenum (Mo)" value={formatPpm(targets.molybdenum)} micro estimated={estimated.has("molybdenum")} />
              </div>

              {hasEstimates && anchor && (
                <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                  <span className="italic">Estimated</span> values were filled in from {MICRO_LABELS[anchor]}
                  {" "}using standard hydroponic micro ratios
                  {" "}(Fe : Mn : Zn : B : Cu : Mo ≈ 1 : 1/3.5 : 1/7 : 1/9 : 1/18 : 1/1200).
                  To override an estimate, enter the actual percentage on Step 1.
                </p>
              )}

              {hasValidData && !hasAnyMicro && (
                <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <p className="text-xs leading-relaxed text-amber-300">
                    We didn&apos;t see any micronutrients in your label data. Add at least one micro
                    (Iron is the easiest) back on Step 1 and we&apos;ll fill in the rest for a
                    complete recipe.
                  </p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Salt-selection mismatch warning — shown when the checked salts can't fully cover the targets */}
      {hasValidData && isRecipeApproximate && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border-2 border-amber-500/60 bg-amber-500/10 p-4"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div className="space-y-1.5 text-sm leading-relaxed text-amber-100">
            <p className="font-semibold">
              Cannot perfectly match all targets with only the selected salts. Closest possible
              recipe shown.
            </p>
            <p>
              <strong className="text-amber-50">{activeRecipeWarnings.map((w) => w.label).join(", ")}</strong>{" "}
              couldn&apos;t be fully matched because the salt that would supply{" "}
              {activeRecipeWarnings.length === 1 ? "it" : "them"} is unchecked on the relevant
              part back on Step 1. Check more salts in that part&apos;s &quot;Salts &amp; Inputs
              Included&quot; section, or leave it as-is if you know you don&apos;t have that input
              on hand.
            </p>
          </div>
        </div>
      )}

      {/* Mixing-safety banner — non-doser modes only (doser banner shown above settings) */}
      {hasValidData && stockTankOption !== "doser" && (
        <MixingSafetyBanner
          option={stockTankOption}
          partCount={multiPartRecipe.tanks.length}
          separateNitrogenTankCount={threeTankRecipe.hasMicroTank ? 2 : 1}
        />
      )}

      {/* Prominent never-mix warning — shown whenever concentrated tanks exist */}
      {hasValidData &&
        (stockTankOption === "separate" ||
          stockTankOption === "doser" ||
          stockTankOption === "ab") && (
          <>
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg border-2 border-amber-500/60 bg-amber-500/10 p-4"
            >
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <div className="space-y-1 text-sm leading-relaxed text-amber-100">
                <p className="font-semibold">
                  Don&apos;t pour your stock tanks into each other.
                </p>
                <p>
                  Always add each stock tank to your reservoir on its own
                  {stockTankOption === "doser"
                    ? " — and give each stock tank its own suction line. Never tee them together before the injector. "
                    : ". "}
                  If you combine two stock tanks at full strength, some of the nutrients clump
                  up into a cloudy white sludge that won&apos;t dissolve — and your plants
                  can&apos;t use those nutrients anymore.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-lg border-2 border-sky-500/50 bg-sky-500/10 p-4">
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-400" />
              <p className="text-sm leading-relaxed text-sky-100">
                A paddle mixer with a drill are recommended for mixing stock tanks. If you are
                mixing your tanks into 5 gallon buckets it&apos;s easier to only prepare 3 to 4
                gallons of stock solution. Ensure that you use a precise measuring tool like a
                5000ml pitcher to mark out your 3 and 4 gallon levels prior to mixing as most
                buckets with gallon markers on them are inaccurate.
              </p>
            </div>
          </>
        )}

      {/* Recipe Cards — Separate Nitrogen (chemistry 3-tank) layout */}
      {hasValidData && usesSeparateNitrogenLayout && (
        <>
          {/* Tank 1 — Calcium source only: Calcium Nitrate, or Calcium Carbonate as a nitrogen-free fallback */}
          <Card className="border-2 border-primary/50 bg-card">
            <CardHeader className="bg-primary/5">
              <CardTitle className="flex items-center gap-2 text-xl text-foreground">
                <Beaker className="h-5 w-5 text-primary" />
                <span>Stock Tank 1 Recipe</span>
                <span className="rounded-full bg-primary/20 px-2 py-0.5 text-xs font-semibold text-primary">
                  Nitrogen + Calcium
                </span>
                <span className="ml-auto text-sm font-normal text-muted-foreground">
                  {stockTankSize} {stockTankUnit === "gallons" ? "gal" : "L"} tank
                </span>
              </CardTitle>
              <CardDescription>
                Just your Calcium source in this stock tank. Keeping it on its own makes it easy
                to taper down near the end of flower without changing the rest of your recipe.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="space-y-2">
                <SaltRow
                  name={RAW_SALTS.calciumNitrate.name}
                  formula={RAW_SALTS.calciumNitrate.formula}
                  amount={scaledGrams(threeTankRecipe.tank1.calciumNitrate)}
                />
                <SaltRow
                  name={RAW_SALTS.calciumCarbonate.name}
                  formula={RAW_SALTS.calciumCarbonate.formula}
                  amount={scaledGrams(threeTankRecipe.tank1.calciumCarbonate)}
                />
              </div>
              <div className="mt-4 rounded-lg border border-border bg-secondary/30 p-3">
                <p className="text-sm text-muted-foreground">
                  <strong className="text-foreground">How to mix:</strong> Fill the stock tank
                  about halfway with RO water, add the calcium source and stir until it&apos;s fully
                  dissolved then top it up to {stockTankSize}{" "}
                  {stockTankUnit === "gallons" ? "gallons" : "liters"} and label it
                  &quot;Tank 1&quot;.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Tank 2 — Remaining macros, plus micros by default (2-tank system) */}
          <Card className="border-2 border-accent/50 bg-card">
            <CardHeader className="bg-accent/5">
              <CardTitle className="flex items-center gap-2 text-xl text-foreground">
                <Beaker className="h-5 w-5 text-accent" />
                <span>Stock Tank 2 Recipe</span>
                <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs font-semibold text-accent">
                  {tank2IncludesMicros ? "Macros + Micros" : "Macros"}
                </span>
                <span className="ml-auto text-sm font-normal text-muted-foreground">
                  {stockTankSize} {stockTankUnit === "gallons" ? "gal" : "L"} tank
                </span>
              </CardTitle>
              <CardDescription>
                {tank2IncludesMicros
                  ? "The rest of your main salts (KNO₃, MKP, MgSO₄, K₂SO₄) plus your micronutrients, combined into one clean tank. Safe to combine because calcium stays in Tank 1."
                  : "The rest of your main salts (KNO₃, MKP, MgSO₄, K₂SO₄). Safe to combine in this stock tank because calcium stays in Tank 1."}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="space-y-2">
                <SaltRow
                  name={RAW_SALTS.potassiumNitrate.name}
                  formula={RAW_SALTS.potassiumNitrate.formula}
                  amount={scaledGrams(threeTankRecipe.tank2.potassiumNitrate)}
                />
                <SaltRow
                  name={RAW_SALTS.ammoniumNitrate.name}
                  formula={RAW_SALTS.ammoniumNitrate.formula}
                  amount={scaledGrams(threeTankRecipe.tank2.ammoniumNitrate)}
                />
                <SaltRow
                  name={RAW_SALTS.monoPotassiumPhosphate.name}
                  formula={RAW_SALTS.monoPotassiumPhosphate.formula}
                  amount={scaledGrams(threeTankRecipe.tank2.monoPotassiumPhosphate)}
                />
                <SaltRow
                  name={RAW_SALTS.magnesiumSulfate.name}
                  formula={RAW_SALTS.magnesiumSulfate.formula}
                  amount={scaledGrams(threeTankRecipe.tank2.magnesiumSulfate)}
                />
                <SaltRow
                  name={RAW_SALTS.potassiumSulfate.name}
                  formula={RAW_SALTS.potassiumSulfate.formula}
                  amount={scaledGrams(threeTankRecipe.tank2.potassiumSulfate)}
                />
                <SaltRow
                  name={RAW_SALTS.ammoniumSulfate.name}
                  formula={RAW_SALTS.ammoniumSulfate.formula}
                  amount={scaledGrams(threeTankRecipe.tank2.ammoniumSulfate)}
                />
              </div>
              {tank2IncludesMicros && (
                <div className="mt-3 border-t border-dashed border-muted-foreground/30 pt-2">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Micronutrients
                  </p>
                  <div className="space-y-2">
                    <SaltRow
                      name={RAW_SALTS.ironDTPA.name}
                      formula={RAW_SALTS.ironDTPA.formula}
                      amount={scaledGrams(threeTankRecipe.tank2.ironDTPA)}
                      micro
                    />
                    <SaltRow
                      name={RAW_SALTS.manganeseSulfate.name}
                      formula={RAW_SALTS.manganeseSulfate.formula}
                      amount={scaledGrams(threeTankRecipe.tank2.manganeseSulfate)}
                      micro
                    />
                    <SaltRow
                      name={RAW_SALTS.zincSulfate.name}
                      formula={RAW_SALTS.zincSulfate.formula}
                      amount={scaledGrams(threeTankRecipe.tank2.zincSulfate)}
                      micro
                    />
                    <SaltRow
                      name={RAW_SALTS.boricAcid.name}
                      formula={RAW_SALTS.boricAcid.formula}
                      amount={scaledGrams(threeTankRecipe.tank2.boricAcid)}
                      micro
                    />
                    <SaltRow
                      name={RAW_SALTS.copperSulfate.name}
                      formula={RAW_SALTS.copperSulfate.formula}
                      amount={scaledGrams(threeTankRecipe.tank2.copperSulfate)}
                      micro
                    />
                    <SaltRow
                      name={RAW_SALTS.sodiumMolybdate.name}
                      formula={RAW_SALTS.sodiumMolybdate.formula}
                      amount={scaledGrams(threeTankRecipe.tank2.sodiumMolybdate)}
                      micro
                    />
                  </div>
                </div>
              )}
              <div className="mt-4 rounded-lg border border-border bg-secondary/30 p-3">
                <p className="text-sm text-muted-foreground">
                  <strong className="text-foreground">How to mix:</strong> Fill the stock tank
                  about halfway with RO water, then add the salts in the order listed above
                  {tank2IncludesMicros
                    ? ", dissolving the Iron DTPA first among the micronutrients"
                    : ""}
                  . Wait for each one to fully dissolve before adding the next. Top up to{" "}
                  {stockTankSize} {stockTankUnit === "gallons" ? "gallons" : "liters"} and label
                  it &quot;Tank 2&quot;.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Tank 3 — Micros, only when the advanced "keep micros separate" option is on */}
          {threeTankRecipe.hasMicroTank && (
            <Card className="border-2 border-muted-foreground/40 bg-card">
              <CardHeader className="bg-muted/40">
                <CardTitle className="flex items-center gap-2 text-xl text-foreground">
                  <Beaker className="h-5 w-5 text-muted-foreground" />
                  <span>Stock Tank 3 Recipe</span>
                  <span className="rounded-full bg-muted-foreground/15 px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                    Micros
                  </span>
                  <span className="ml-auto text-sm font-normal text-muted-foreground">
                    {stockTankSize} {stockTankUnit === "gallons" ? "gal" : "L"} tank
                  </span>
                </CardTitle>
                <CardDescription>
                  Chelated iron and the micronutrients, kept in their own tank since you turned
                  on the advanced 3-tank option.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="space-y-2">
                  <SaltRow
                    name={RAW_SALTS.ironDTPA.name}
                    formula={RAW_SALTS.ironDTPA.formula}
                    amount={scaledGrams(threeTankRecipe.tank3.ironDTPA)}
                    micro
                  />
                  <SaltRow
                    name={RAW_SALTS.manganeseSulfate.name}
                    formula={RAW_SALTS.manganeseSulfate.formula}
                    amount={scaledGrams(threeTankRecipe.tank3.manganeseSulfate)}
                    micro
                  />
                  <SaltRow
                    name={RAW_SALTS.zincSulfate.name}
                    formula={RAW_SALTS.zincSulfate.formula}
                    amount={scaledGrams(threeTankRecipe.tank3.zincSulfate)}
                    micro
                  />
                  <SaltRow
                    name={RAW_SALTS.boricAcid.name}
                    formula={RAW_SALTS.boricAcid.formula}
                    amount={scaledGrams(threeTankRecipe.tank3.boricAcid)}
                    micro
                  />
                  <SaltRow
                    name={RAW_SALTS.copperSulfate.name}
                    formula={RAW_SALTS.copperSulfate.formula}
                    amount={scaledGrams(threeTankRecipe.tank3.copperSulfate)}
                    micro
                  />
                  <SaltRow
                    name={RAW_SALTS.sodiumMolybdate.name}
                    formula={RAW_SALTS.sodiumMolybdate.formula}
                    amount={scaledGrams(threeTankRecipe.tank3.sodiumMolybdate)}
                    micro
                  />
                </div>
                <div className="mt-4 rounded-lg border border-border bg-secondary/30 p-3">
                  <p className="text-sm text-muted-foreground">
                    <strong className="text-foreground">How to mix:</strong> Use room temperature
                    RO water ~70°F if possible, this will help with mixing. Fill the tank halfway and
                    dissolve the Iron DTPA first, then add the rest of the micros. Boric Acid is
                    slow to dissolve so give it a minute if it&apos;s being stubborn. Top up to{" "}
                    {stockTankSize}{" "}
                    {stockTankUnit === "gallons" ? "gallons" : "liters"} and label it
                    &quot;Tank 3&quot;.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Recipe Cards — one stock tank per nutrient part (doser + A+B modes) */}
      {hasValidData && usesPerPartTanks && (
        <PerPartStockTankCards
          tanks={multiPartRecipe.tanks}
          stockTankSize={stockTankSize}
          stockTankUnit={stockTankUnit}
          isDoser={stockTankOption === "doser"}
          ecScaleFactor={ecScaleFactor}
        />
      )}

      {/* Direct Mixing Instructions */}
      {hasValidData && stockTankOption === "direct" && (
        <Card className="border-2 border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl text-foreground">
              <Beaker className="h-5 w-5 text-primary" />
              <span>Direct Mixing Recipe</span>
            </CardTitle>
            <CardDescription>
              Dilute these salts one by one in a pitcher (preferably with a paddle mixer and a
              drill) and then add to your reservoir, it is recommended to use some sort of
              recirculating pump in the reservoir while mixing.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {/* Rendered from `getOrderedSaltEntries` (the same `SALT_DISPLAY_ORDER`
                used to build the saved formulation's tank inputs) so the mix
                order shown here always matches what gets saved to the
                Dashboard / Feeding Scheduler. */}
            <div className="space-y-2 mb-4">
              {getOrderedSaltEntries(directRecipe.salts).map(([key, amount]) => (
                <SaltRow
                  key={key}
                  name={RAW_SALTS[key].name}
                  formula={RAW_SALTS[key].formula}
                  amount={scaledGrams(amount)}
                  micro={MICRO_SALT_KEYS.has(key)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Shopping List */}
      {hasValidData && (
        <Card className="border-2 border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl text-foreground">
              <ShoppingCart className="h-5 w-5 text-primary" />
              <span>What to Buy — Shopping List</span>
            </CardTitle>
            <CardDescription>
              Raw salts needed for this recipe
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2">
              {shoppingItems
                .filter((item) => neededSaltKeys.has(item.key))
                .map((item) => (
                  <Fragment key={item.key}>
                    <ShoppingItem name={item.name} note={item.note} />
                    {item.disclaimer && (
                      <p className="col-span-full rounded border border-amber-500/35 bg-amber-500/10 px-2.5 py-1.5 text-xs leading-snug text-amber-100">
                        {item.disclaimer}
                      </p>
                    )}
                  </Fragment>
                ))}
            </div>
            <div className="mt-4 rounded-lg border border-border bg-secondary/30 p-4">
              <h4 className="font-medium text-foreground mb-2">Where to Buy</h4>
              <p className="text-sm text-muted-foreground">
                It&apos;s best to purchase from a local hydroponic supply store if you can as you
                will save money on shipping. Customhydronutrients.com is a great resource if you
                don&apos;t have access to a local shop or you can&apos;t find all of the components.
                Buy a precision scale (.01g accuracy) for measuring your micronutrients and ensure
                that you aren&apos;t weighing them out in a room with a lot of airflow as this will
                mess with the measurement.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Feeding Scheduler integration — first step toward a full scheduler feature */}
      {hasValidData && (
        <Card className="border-2 border-primary/30 bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl text-foreground">
              <CalendarPlus className="h-5 w-5 text-primary" />
              <span>Feeding Scheduler</span>
            </CardTitle>
            <CardDescription>
              Assign this recipe to a grow stage and week range so you can track it in your
              Feeding Scheduler.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Button onClick={openSchedulerModal} variant="outline" className="gap-2">
              <CalendarPlus className="h-4 w-4" />
              Add to Feeding Scheduler
            </Button>
            {schedulerEntryCount > 0 && (
              <Badge variant="secondary" className="gap-1.5 py-1 text-emerald-700 dark:text-emerald-400">
                <CalendarCheck2 className="h-3.5 w-3.5" />
                Added to Scheduler{schedulerEntryCount > 1 ? ` (${schedulerEntryCount})` : ""}
              </Badge>
            )}
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Feeding Rates
        </Button>

        {hasValidData && (
          <Button
            onClick={openSaveDashboardModal}
            disabled={isSaving}
            className="gap-2 bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:bg-primary/90 disabled:opacity-70"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <BookmarkPlus className="h-4 w-4" />
            )}
            {isSaving ? "Saving…" : "Save to Dashboard"}
          </Button>
        )}
      </div>

      {/* Save to Dashboard modal — collects a formulation name before saving */}
      <Dialog open={isSaveDashboardModalOpen} onOpenChange={(open) => !isSaving && setIsSaveDashboardModalOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save to Dashboard</DialogTitle>
            <DialogDescription>
              Give this formulation a name so it&apos;s easy to find on your main dashboard.
            </DialogDescription>
          </DialogHeader>

          <div>
            <Label htmlFor="dashboard-formulation-name" className="mb-1.5 block text-sm font-medium">
              Formulation name
            </Label>
            <Input
              id="dashboard-formulation-name"
              value={dashboardFormulationName}
              onChange={(e) => setDashboardFormulationName(e.target.value)}
              placeholder={buildUntitledFormulationName()}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleSaveToDashboard()
                }
              }}
              className="border-2 border-border"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Leave blank to save as &quot;{buildUntitledFormulationName()}&quot;.
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsSaveDashboardModalOpen(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveToDashboard} disabled={isSaving} className="gap-2">
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <BookmarkPlus className="h-4 w-4" />
              )}
              {isSaving ? "Saving…" : "Save to Dashboard"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add to Feeding Scheduler modal */}
      <Dialog open={isSchedulerModalOpen} onOpenChange={setIsSchedulerModalOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add to Feeding Scheduler</DialogTitle>
            <DialogDescription>
              Save this recipe to a grow stage and week range so you can track it later.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div>
              <Label htmlFor="scheduler-recipe-name" className="mb-1.5 block text-sm font-medium">
                Recipe name
              </Label>
              <Input
                id="scheduler-recipe-name"
                value={schedulerRecipeName}
                onChange={(e) => setSchedulerRecipeName(e.target.value)}
                placeholder="e.g. Blue Dream Veg Mix"
                className="border-2 border-border"
              />
            </div>

            <div>
              <Label className="mb-1.5 block text-sm font-medium">Growth stage</Label>
              <RadioGroup
                value={schedulerStage}
                onValueChange={handleSchedulerStageChange}
                className="grid grid-cols-2 gap-2"
              >
                {(["Vegetative", "Flowering"] as const).map((stage) => (
                  <Label
                    key={stage}
                    htmlFor={`scheduler-stage-${stage}`}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-medium transition-colors ${
                      schedulerStage === stage
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-secondary/20 text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    <RadioGroupItem value={stage} id={`scheduler-stage-${stage}`} />
                    {stage}
                  </Label>
                ))}
              </RadioGroup>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">
                  Weeks (1–{schedulerWeekCount} {schedulerStage})
                </Label>
                <div className="flex gap-3 text-xs">
                  <button
                    type="button"
                    onClick={selectAllSchedulerWeeks}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={clearSchedulerWeeks}
                    className="text-muted-foreground underline-offset-2 hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-5">
                {Array.from({ length: schedulerWeekCount }, (_, i) => i + 1).map((week) => (
                  <Label
                    key={week}
                    htmlFor={`scheduler-week-${week}`}
                    className={`flex cursor-pointer items-center gap-1.5 rounded border-2 px-2 py-1.5 text-xs font-medium transition-colors ${
                      schedulerWeeks.has(week)
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-secondary/20 text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    <Checkbox
                      id={`scheduler-week-${week}`}
                      checked={schedulerWeeks.has(week)}
                      onCheckedChange={() => toggleSchedulerWeek(week)}
                    />
                    Wk {week}
                  </Label>
                ))}
              </div>
            </div>

            <div>
              <Label htmlFor="scheduler-notes" className="mb-1.5 block text-sm font-medium">
                Notes <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="scheduler-notes"
                value={schedulerNotes}
                onChange={(e) => setSchedulerNotes(e.target.value)}
                placeholder="Any adjustments or reminders for this stage…"
                rows={3}
                className="border-2 border-border"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsSchedulerModalOpen(false)}
              disabled={isSavingSchedulerEntry}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveToScheduler} disabled={isSavingSchedulerEntry} className="gap-2">
              {isSavingSchedulerEntry ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CalendarPlus className="h-4 w-4" />
              )}
              {isSavingSchedulerEntry ? "Saving…" : "Save to Scheduler"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function TargetCard({
  label,
  value,
  primary = false,
  micro = false,
  estimated = false,
}: {
  label: string
  value: string
  primary?: boolean
  micro?: boolean
  estimated?: boolean
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        primary
          ? "border-primary/50 bg-primary/5"
          : micro
            ? "border-muted bg-muted/30"
            : "border-border bg-secondary/30"
      }`}
    >
      <p className={`text-xs font-medium ${micro ? "text-muted-foreground" : "text-muted-foreground"}`}>
        {label}
      </p>
      <p
        className={`text-lg font-semibold font-mono ${
          primary ? "text-primary" : estimated ? "text-muted-foreground" : "text-foreground"
        }`}
      >
        {value}
      </p>
      {estimated && (
        <p className="mt-0.5 text-[10px] italic text-muted-foreground">estimated</p>
      )}
    </div>
  )
}

function SaltRow({
  name,
  formula,
  amount,
  micro = false,
}: {
  name: string
  formula: string
  amount: string
  micro?: boolean
}) {
  if (amount === "—") return null

  return (
    <div
      className={`flex items-center justify-between py-2 px-3 rounded ${
        micro ? "bg-muted/30" : "bg-secondary/50"
      }`}
    >
      <div>
        <p className={`font-medium ${micro ? "text-sm" : ""} text-foreground`}>{name}</p>
        <p className="text-xs text-muted-foreground font-mono">{formula}</p>
      </div>
      <p className="font-mono font-semibold text-foreground">{amount}</p>
    </div>
  )
}

function PerPartStockTankCards({
  tanks,
  stockTankSize,
  stockTankUnit,
  isDoser,
  ecScaleFactor,
}: {
  tanks: PartStockTank[]
  stockTankSize: string
  stockTankUnit: "gallons" | "liters"
  isDoser: boolean
  ecScaleFactor: number
}) {
  const scaledGrams = (g: number) => formatGrams(g * ecScaleFactor)
  const tankStyles = [
    {
      border: "border-primary/50",
      header: "bg-primary/5",
      icon: "text-primary",
      badge: "bg-primary/20 text-primary",
    },
    {
      border: "border-accent/50",
      header: "bg-accent/5",
      icon: "text-accent",
      badge: "bg-accent/20 text-accent",
    },
    {
      border: "border-muted-foreground/40",
      header: "bg-muted/40",
      icon: "text-muted-foreground",
      badge: "bg-muted-foreground/15 text-muted-foreground",
    },
  ] as const

  if (tanks.length === 0) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
        Enter your feed-chart doses on Step 2 to see one stock tank recipe per part.
      </div>
    )
  }

  return (
    <>
      {tanks.map((tank, index) => {
        const style = tankStyles[index % tankStyles.length]
        const saltEntries = getOrderedSaltEntries(tank.salts)
        const macroEntries = saltEntries.filter(([key]) => !MICRO_SALT_KEYS.has(key))
        const microEntries = saltEntries.filter(([key]) => MICRO_SALT_KEYS.has(key))
        const unitLabel = stockTankUnit === "gallons" ? "gallons" : "liters"

        return (
          <Card key={tank.partId} className={`border-2 ${style.border} bg-card`}>
            <CardHeader className={style.header}>
              <CardTitle className="flex flex-wrap items-center gap-2 text-xl text-foreground">
                <Beaker className={`h-5 w-5 ${style.icon}`} />
                <span>Stock {tank.name} Recipe</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${style.badge}`}>
                  {tank.partName}
                </span>
                <span className="ml-auto text-sm font-normal text-muted-foreground">
                  {stockTankSize} {stockTankUnit === "gallons" ? "gal" : "L"} tank
                </span>
              </CardTitle>
              <CardDescription>
                {tank.isMicroTank
                  ? `All micronutrients from every part consolidated into one tank. Feeds suction line ${tank.index} on your doser — add it to your reservoir separately from the macro tanks.`
                  : isDoser
                    ? `Matches your ${tank.partName} from Steps 1 and 2. This tank feeds suction line ${tank.index} on your doser.`
                    : `Matches your ${tank.partName} from Steps 1 and 2. Add this stock tank to your reservoir separately.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="space-y-2">
                {macroEntries.map(([key, amount]) => (
                  <SaltRow
                    key={key}
                    name={RAW_SALTS[key].name}
                    formula={RAW_SALTS[key].formula}
                    amount={scaledGrams(amount)}
                  />
                ))}
                {microEntries.length > 0 && (
                  <div className="mt-3 border-t border-dashed border-muted-foreground/30 pt-2">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Micronutrients
                    </p>
                    {microEntries.map(([key, amount]) => (
                      <SaltRow
                        key={key}
                        name={RAW_SALTS[key].name}
                        formula={RAW_SALTS[key].formula}
                        amount={scaledGrams(amount)}
                        micro
                      />
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-4 rounded-lg border border-border bg-secondary/30 p-3">
                <p className="text-sm text-muted-foreground">
                  {tank.isMicroTank ? (
                    <>
                      <strong className="text-foreground">How to mix:</strong> Use room-temperature
                      RO water (~70 °F) if possible — it helps with dissolving. Fill the tank
                      halfway, dissolve the Iron DTPA first, then add the remaining micros one at a
                      time. Boric Acid can be slow; give it a minute if needed. Top up to{" "}
                      {stockTankSize} {unitLabel} and label it &quot;{tank.name} — Micros&quot;,
                      then drop suction line {tank.index} in.
                    </>
                  ) : (
                    <>
                      <strong className="text-foreground">How to mix:</strong> Fill the stock tank
                      about halfway with RO water, then add the salts in the order listed above.
                      Wait for each one to fully dissolve before adding the next. Top up to{" "}
                      {stockTankSize} {unitLabel} and label it &quot;{tank.name}&quot;
                      {isDoser ? ` — then drop the ${tank.name} suction line in.` : "."}
                    </>
                  )}
                </p>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </>
  )
}

function MixingSafetyBanner({
  option,
  partCount,
  separateCaLayout = false,
  separateNitrogenTankCount = 1,
}: {
  option: StockTankOption
  partCount: number
  separateCaLayout?: boolean
  separateNitrogenTankCount?: number
}) {
  if (option === "separate") {
    return (
      <div className="flex items-start gap-3 rounded-lg border-2 border-emerald-500/50 bg-emerald-500/10 p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
        <div className="space-y-1 text-sm leading-relaxed text-emerald-100">
          <p className="font-semibold">Safest setup</p>
          <p>
            Nitrogen and Calcium sit together in their own stock tank, so it&apos;s easy to taper
            at the end of flower. The rest of your recipe
            {separateNitrogenTankCount === 1
              ? " goes into 1 more stock tank"
              : ` goes into ${separateNitrogenTankCount} more stock tanks`}
            {" "}that {separateNitrogenTankCount === 1 ? "is" : "are"} safe to combine.
          </p>
        </div>
      </div>
    )
  }

  if (option === "doser") {
    return (
      <div
        role="alert"
        className="flex items-start gap-3 rounded-lg border-2 border-amber-500/50 bg-amber-500/10 p-4"
      >
        <Gauge className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
        <div className="space-y-1 text-sm leading-relaxed text-amber-100">
          <p className="font-semibold">Doser / Injector setup — check your hardware first</p>
          <p>
            {separateCaLayout
              ? `We sized ${partCount} stock tank${partCount === 1 ? "" : "s"} with Calcium Nitrate isolated in its own suction line for easy nitrogen tapering.`
              : `We sized ${partCount} stock tank${partCount === 1 ? "" : "s"} (one per part in your feed chart) for a standard doser ratio.`}{" "}
            <strong>Confirm the ratio printed on your injector</strong> matches the one we picked
            above — if it doesn&apos;t, change the ratio and the amounts will recalculate. Each
            stock tank needs its own suction line; never tee them together before the injector.
          </p>
        </div>
      </div>
    )
  }

  if (option === "ab") {
    return (
      <div
        role="alert"
        className="flex items-start gap-3 rounded-lg border-2 border-amber-500/50 bg-amber-500/10 p-4"
      >
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
        <div className="space-y-1 text-sm leading-relaxed text-amber-100">
          <p className="font-semibold">One stock tank per part</p>
          <p>
            We created {partCount} stock tank{partCount === 1 ? "" : "s"} to match the parts in
            your nutrient line.{" "}
            <strong>Don&apos;t pour your stock tanks into each other at full strength.</strong>{" "}
            Add each one to your reservoir on its own, with a good stir in between.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border-2 border-destructive/50 bg-destructive/10 p-4"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
      <p className="text-sm leading-relaxed text-destructive">
        Mix the salts in order or you will run into issues where the nutrients will clump up,
        become unavailable and potentially clog your drippers.
      </p>
    </div>
  )
}

function RecommendedRatioCard({
  report,
  currentRatio,
  recommendedRatio,
  ratioIsManual,
  onReset,
  stockTankOption,
  isDoserPreset,
}: {
  report: MultiTankSolubilityReport
  currentRatio: number
  recommendedRatio: number | null
  ratioIsManual: boolean
  onReset: () => void
  stockTankOption: StockTankOption
  isDoserPreset: boolean
}) {
  const { limitingSalt, safe } = report
  const limitingSaltName = limitingSalt ? RAW_SALTS[limitingSalt].name : null
  const isDoser = stockTankOption === "doser"
  // Doser users typically can't change their hardware ratio, so a recipe that
  // can't reach even 1:100 needs a bigger stock tank — call that out clearly.
  const doserNeedsBiggerTank = isDoser && recommendedRatio !== null && !isDoserPreset

  // Three visual states:
  //  - "danger": user typed a ratio that would push a salt past its safe limit
  //  - "warning": user typed a custom value (not at recommendation)
  //  - "ok": ratio is at (or below) the recommendation — the safe default
  const currentExceedsRecommended =
    recommendedRatio !== null && currentRatio > recommendedRatio
  const tone = !safe
    ? "danger"
    : ratioIsManual && currentExceedsRecommended
      ? "warning"
      : "ok"

  const toneClasses =
    tone === "danger"
      ? "border-destructive/60 bg-destructive/10"
      : tone === "warning"
        ? "border-amber-500/60 bg-amber-500/10"
        : "border-primary/40 bg-primary/5"

  const Icon = tone === "ok" ? Sparkles : AlertTriangle
  const iconClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "warning"
        ? "text-amber-400"
        : "text-primary"

  return (
    <Card className={`border-2 ${toneClasses}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl text-foreground">
          <Icon className={`h-5 w-5 ${iconClass}`} />
          <span>{isDoser ? "Recommended Doser Ratio" : "Recommended Dilution Ratio"}</span>
        </CardTitle>
        <CardDescription>
          {isDoser
            ? "We picked the strongest standard doser ratio that still keeps your stock tanks safely dissolved."
            : "We picked this ratio for you based on the salts in your recipe."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border-2 border-border bg-card px-4 py-3 inline-block">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {isDoser ? "Recommended doser ratio" : "Recommended ratio"}
          </p>
          <p className="font-mono text-2xl font-semibold text-foreground">
            {recommendedRatio !== null && Number.isFinite(recommendedRatio)
              ? `1 : ${recommendedRatio}`
              : "—"}
          </p>
          {isDoser && isDoserPreset && (
            <p className="mt-1 text-xs text-muted-foreground">
              Matches a standard doser preset.
            </p>
          )}
        </div>

        {limitingSaltName ? (
          <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            <p>
              <strong className="text-foreground">Why this ratio?</strong>{" "}
              {isDoser
                ? "We started from the standard doser ratios (1:200, 1:128, 1:100) and picked the strongest one that still keeps every salt safely dissolved at storage temperature."
                : "This ratio keeps your stock tanks safely dissolved — even if they get a little cool sitting on a shelf."}
            </p>
            <p>
              <strong className="text-foreground">{limitingSaltName}</strong> is the trickiest
              salt in your recipe to keep dissolved. At <span className="font-mono">1 : {recommendedRatio}</span>,
              it stays well below the point where it would start forming crystals.
            </p>
            {doserNeedsBiggerTank && (
              <p className="text-foreground">
                <strong>Heads up:</strong> your recipe is too concentrated for the standard
                doser presets (1:100, 1:128, 1:200). Use a bigger stock tank — or split the
                trickiest salt into its own tank — so you can run at a normal doser ratio.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-muted-foreground">
            Enter your guaranteed analysis and feeding rates on the previous screens to see a
            recommendation here.
          </p>
        )}

        {ratioIsManual && recommendedRatio !== null && currentRatio !== recommendedRatio && tone !== "danger" && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="flex-1 text-sm leading-relaxed text-foreground">
              You changed the ratio to <span className="font-mono">1 : {currentRatio}</span>.
              {currentExceedsRecommended
                ? " That's higher than what we recommend — your stock tanks will be more concentrated."
                : " That's lower than what we recommend — you'll just use a bit more stock per gallon."}
            </p>
            <Button onClick={onReset} variant="outline" className="gap-2">
              <Sparkles className="h-4 w-4" />
              Use recommended
            </Button>
          </div>
        )}

        {!safe && (
          <div
            role="alert"
            className="flex flex-wrap items-start gap-3 rounded-lg border-2 border-destructive/50 bg-destructive/10 p-3"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="flex-1 space-y-1 text-sm leading-relaxed text-destructive">
              <p className="font-semibold">Your ratio is too high</p>
              <p>
                At <span className="font-mono">1 : {currentRatio}</span>,{" "}
                {limitingSaltName ?? "one of the salts"} won&apos;t fully dissolve and will likely
                form crystals in your stock tank. Lower the ratio (or use a bigger stock tank)
                before mixing.
              </p>
            </div>
            <Button onClick={onReset} className="gap-2">
              <Sparkles className="h-4 w-4" />
              Use recommended
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function joinTankNames(labels: string[]): string {
  if (labels.length === 0) return ""
  if (labels.length === 1) return labels[0]
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`
}

function StockTankUsageCard({
  tankLabels,
  dilutionRatio,
  mlPerGallon,
  mlPerLiter,
  isDoser,
}: {
  tankLabels: string[]
  dilutionRatio: number
  mlPerGallon: number
  mlPerLiter: number
  isDoser: boolean
}) {
  const [mlUnit, setMlUnit] = useState<"gal" | "L">("gal")

  const amount = mlUnit === "gal" ? formatMl(mlPerGallon) : formatMl(mlPerLiter)
  const unitLabel = mlUnit === "gal" ? "gallon" : "liter"
  const tankList = joinTankNames(tankLabels)

  return (
    <Card className="border-2 border-primary/30 bg-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-xl text-foreground">
              <Droplets className="h-5 w-5 text-primary" />
              <span>How to Use These Stock Tanks</span>
            </CardTitle>
            <CardDescription>
              How much of each stock tank to add when you fill your reservoir.
            </CardDescription>
          </div>
          <div className="flex shrink-0 overflow-hidden rounded-lg border-2 border-border">
            <button
              type="button"
              onClick={() => setMlUnit("gal")}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                mlUnit === "gal"
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:bg-secondary/80"
              }`}
            >
              mL/gal
            </button>
            <button
              type="button"
              onClick={() => setMlUnit("L")}
              className={`border-l-2 border-border px-3 py-1.5 text-sm font-medium transition-colors ${
                mlUnit === "L"
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:bg-secondary/80"
              }`}
            >
              mL/L
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isDoser && (
          <div className="inline-block rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Injection ratio
            </p>
            <p className="font-mono text-lg font-semibold text-foreground">1 : {dilutionRatio}</p>
          </div>
        )}

        <p className="text-sm leading-relaxed text-foreground">
          {isDoser ? (
            <>
              Your injector draws{" "}
              <span className="font-mono font-semibold">{amount} mL</span> from each stock tank per{" "}
              <strong>{unitLabel}</strong> of water at a 1:{dilutionRatio} ratio.
            </>
          ) : (
            <>
              Add <span className="font-mono font-semibold">{amount} mL</span> of {tankList} per{" "}
              <strong>{unitLabel}</strong> of reservoir water.
            </>
          )}
        </p>

        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {tankLabels.map((label) => (
            <li
              key={label}
              className="rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm"
            >
              <p className="font-medium text-foreground">{label}</p>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                {amount} mL/{mlUnit}
              </p>
            </li>
          ))}
        </ul>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Pour each stock tank into your reservoir separately — never combine them at full strength
          before diluting.
        </p>
      </CardContent>
    </Card>
  )
}

function ShoppingItem({ name, note }: { name: string; note: string }) {
  return (
    <div className="flex items-start gap-2 rounded border border-border bg-secondary/20 p-2">
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 border-primary/50">
        <span className="sr-only">checkbox</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{name}</p>
        <p className="text-xs text-muted-foreground">{note}</p>
      </div>
    </div>
  )
}
