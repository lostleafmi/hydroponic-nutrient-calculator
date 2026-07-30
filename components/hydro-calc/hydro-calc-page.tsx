"use client"

import { useEffect, useRef, useState } from "react"
import { useAuth } from "@clerk/nextjs"
import { Loader2 } from "lucide-react"
import {
  GuaranteedAnalysisScreen,
  type PartAnalysis,
  createEmptyPartAnalysis,
} from "@/components/hydro-calc/guaranteed-analysis-screen"
import { FeedingRatesScreen, type NutrientPart, type StockTankOption } from "@/components/hydro-calc/feeding-rates-screen"
import { RecipeScreen, type RecipeInitialSettings } from "@/components/hydro-calc/recipe-screen"
import {
  convertDoseValue,
  convertStockTankSize,
  DEFAULT_STOCK_TANK_SIZE,
  defaultStockTankOption,
  DIRECT_MIX_RESERVOIR_SIZE,
  doseUnitFor,
  doseUnitVolumeUnit,
  normalizeStockTankOption,
  rebaseDoseUnit,
  type VolumeUnit,
} from "@/lib/hydro-calc/recipe-types"
import {
  hydrateSavedFeedingParts,
  hydrateSavedPartsAnalysis,
  unwrapSavedFormulation,
} from "@/lib/hydro-calc/formulation-persistence"
import { toast } from "@/hooks/use-toast"

const DASHBOARD_API_BASE =
  process.env.NEXT_PUBLIC_DASHBOARD_API_URL
    ? process.env.NEXT_PUBLIC_DASHBOARD_API_URL.replace(/\/save$/, "")
    : "https://lost-art-of-growingv2.vercel.app/api/formulations"

type Screen = "analysis" | "feeding" | "recipe"

function createInitialWizardState() {
  const partAId = `${Date.now()}-a`
  const partBId = `${Date.now()}-b`

  return {
    partsAnalysis: [
      createEmptyPartAnalysis("Part A", partAId),
      createEmptyPartAnalysis("Part B", partBId),
    ],
    parts: [
      { id: partAId, name: "Part A", dose: "", unit: "g_per_gallon" as const },
      { id: partBId, name: "Part B", dose: "", unit: "g_per_gallon" as const },
    ],
  }
}

function syncFeedingPartsFromAnalysis(
  analysisParts: PartAnalysis[],
  feedingParts: NutrientPart[],
  volumeUnit: VolumeUnit
): NutrientPart[] {
  const feedingById = new Map(feedingParts.map((part) => [part.id, part]))
  const usedFeedingIds = new Set<string>()

  return analysisParts.map((analysisPart, index) => {
    const existing = feedingById.get(analysisPart.id)
    if (existing) {
      usedFeedingIds.add(existing.id)
      return { ...existing, name: analysisPart.name }
    }

    const unmatched = feedingParts.find(
      (part) => !usedFeedingIds.has(part.id) && !analysisParts.some((ap) => ap.id === part.id)
    )
    if (unmatched) {
      usedFeedingIds.add(unmatched.id)
      return { ...unmatched, id: analysisPart.id, name: analysisPart.name }
    }

    const byIndex = feedingParts[index]
    if (byIndex && !usedFeedingIds.has(byIndex.id)) {
      usedFeedingIds.add(byIndex.id)
      return { ...byIndex, id: analysisPart.id, name: analysisPart.name }
    }

    return {
      id: analysisPart.id,
      name: analysisPart.name,
      dose: "",
      unit: doseUnitFor("g", volumeUnit),
    }
  })
}

function syncAnalysisPartsFromFeeding(
  feedingParts: NutrientPart[],
  analysisParts: PartAnalysis[]
): PartAnalysis[] {
  const analysisById = new Map(analysisParts.map((part) => [part.id, part]))
  const usedAnalysisIds = new Set<string>()

  return feedingParts.map((feedingPart, index) => {
    const existing = analysisById.get(feedingPart.id)
    if (existing) {
      usedAnalysisIds.add(existing.id)
      return { ...existing, name: feedingPart.name }
    }

    const unmatched = analysisParts.find(
      (part) => !usedAnalysisIds.has(part.id) && !feedingParts.some((fp) => fp.id === part.id)
    )
    if (unmatched) {
      usedAnalysisIds.add(unmatched.id)
      return { ...unmatched, id: feedingPart.id, name: feedingPart.name }
    }

    const byIndex = analysisParts[index]
    if (byIndex && !usedAnalysisIds.has(byIndex.id)) {
      usedAnalysisIds.add(byIndex.id)
      return { ...byIndex, id: feedingPart.id, name: feedingPart.name }
    }

    return createEmptyPartAnalysis(feedingPart.name, feedingPart.id)
  })
}

export function HydroCalcPage({ loadFormulationId }: { loadFormulationId?: string }) {
  const { getToken } = useAuth()
  const [initialState] = useState(createInitialWizardState)
  const [currentScreen, setCurrentScreen] = useState<Screen>("analysis")
  const [partsAnalysis, setPartsAnalysis] = useState<PartAnalysis[]>(initialState.partsAnalysis)
  const [parts, setParts] = useState<NutrientPart[]>(initialState.parts)
  const [stockTankOption, setStockTankOption] = useState<StockTankOption>(() =>
    defaultStockTankOption(initialState.parts.length)
  )

  /**
   * The grower's volume preference, in three places that are allowed to
   * disagree.
   *
   * `volumeUnit` is what the Feeding Rates card is set to, and it's the source
   * of truth only at the moment it changes: flipping it re-quotes every feed
   * rate and pushes the same unit onto the two below (see
   * `handleVolumeUnitChange`). After that the stock tank size unit and the mL
   * usage rate unit are the grower's to move on the recipe screen, and moving
   * them never flips the feed chart back.
   */
  const [volumeUnit, setVolumeUnit] = useState<VolumeUnit>("gallons")
  const [stockTankSize, setStockTankSize] = useState(DEFAULT_STOCK_TANK_SIZE.gallons)
  const [stockTankUnit, setStockTankUnit] = useState<VolumeUnit>("gallons")
  const [usageRateUnit, setUsageRateUnit] = useState<VolumeUnit>("gallons")

  // Tracks which recipeInitialSettings generation is in use — incrementing forces
  // RecipeScreen to remount so its useState picks up the new initial values.
  const [recipeKey, setRecipeKey] = useState(0)
  const [recipeInitialSettings, setRecipeInitialSettings] = useState<RecipeInitialSettings>({})

  const [isLoadingFormulation, setIsLoadingFormulation] = useState(!!loadFormulationId)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Prevent double-fetch in StrictMode
  const hasFetched = useRef(false)

  useEffect(() => {
    if (!loadFormulationId || hasFetched.current) return
    hasFetched.current = true

    const load = async () => {
      setIsLoadingFormulation(true)
      setLoadError(null)
      try {
        const token = await getToken()
        const res = await fetch(`${DASHBOARD_API_BASE}/${loadFormulationId}`, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        })

        if (!res.ok) {
          const errText = await res.text().catch(() => "")
          throw new Error(errText || `Server responded with ${res.status}`)
        }

        // Tolerates the fetch handing back either the formulation itself or a
        // stored row wrapping it.
        const saved = unwrapSavedFormulation(await res.json())

        // --- Populate wizard state ---
        // Each part's salts come from that part alone — see
        // `hydrateSavedPartsAnalysis` for what a save without them falls back to.
        const savedPartsAnalysis = hydrateSavedPartsAnalysis(saved)
        if (savedPartsAnalysis) {
          setPartsAnalysis(savedPartsAnalysis)
        }
        const savedParts = hydrateSavedFeedingParts(saved)
        if (savedParts) {
          setParts(savedParts)
          // The saved rates carry their own basis, so the toggles come back
          // reading the unit the formulation was actually entered in.
          const savedVolumeUnit = doseUnitVolumeUnit(savedParts[0].unit)
          setVolumeUnit(savedVolumeUnit)
          setUsageRateUnit(savedVolumeUnit)
          setStockTankUnit(savedVolumeUnit)
        }
        // Older saved formulations still carry the pre-rename "ab" value for
        // the per-part layout — see `normalizeStockTankOption`.
        const savedStockTankOption = normalizeStockTankOption(saved.stockTankOption)
        if (savedStockTankOption) {
          setStockTankOption(savedStockTankOption)
        }

        // --- Pre-fill recipe screen settings ---
        // The tank size and its unit live on this page (the Feeding Rates unit
        // toggle writes to them), so they're restored directly rather than
        // through the remounted recipe screen's initial settings.
        if (saved.stockTankSize) setStockTankSize(String(saved.stockTankSize))
        if (saved.stockTankUnit === "gallons" || saved.stockTankUnit === "liters") {
          setStockTankUnit(saved.stockTankUnit)
        }
        const settings: RecipeInitialSettings = {}
        if (saved.concentrationRatio) settings.concentrationRatio = String(saved.concentrationRatio)
        if (saved.doserLayout === "per-part" || saved.doserLayout === "separate-ca") {
          settings.doserLayout = saved.doserLayout
        }
        if (saved.targetEc != null) settings.targetEcInput = String(saved.targetEc)
        setRecipeInitialSettings(settings)
        setRecipeKey((k) => k + 1)

        // Clean the URL so a refresh doesn't re-trigger the load
        window.history.replaceState({}, "", window.location.pathname)

        toast({
          title: "Formulation loaded",
          description: "Your saved formulation has been pre-filled into the calculator.",
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not load formulation."
        setLoadError(message)
        toast({
          title: "Failed to load formulation",
          description: message,
          variant: "destructive",
        })
      } finally {
        setIsLoadingFormulation(false)
      }
    }

    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadFormulationId])

  const handlePartsAnalysisChange = (nextPartsAnalysis: PartAnalysis[]) => {
    setPartsAnalysis(nextPartsAnalysis)
    setParts((currentParts) =>
      syncFeedingPartsFromAnalysis(nextPartsAnalysis, currentParts, volumeUnit)
    )
  }

  const handlePartsChange = (nextParts: NutrientPart[]) => {
    setParts(nextParts)
    setPartsAnalysis((currentAnalysis) => syncAnalysisPartsFromFeeding(nextParts, currentAnalysis))
  }

  /**
   * Flipping the Feeding Rates card's unit re-quotes every number already
   * typed rather than reinterpreting it, so the actual dose the grower gets
   * doesn't jump — 4 g/gal becomes 10.567 g/10 L, the same feed either way. The
   * stock tank size and mL usage rate follow to the new unit too (the tank
   * size converted the same way, unless it's still the untouched default —
   * see `convertStockTankSize`), which is what the note on that card tells the
   * grower just happened.
   */
  const handleVolumeUnitChange = (nextUnit: VolumeUnit) => {
    if (nextUnit === volumeUnit) return
    setVolumeUnit(nextUnit)
    setParts((currentParts) =>
      currentParts.map((part) => {
        const nextDoseUnit = rebaseDoseUnit(part.unit, nextUnit)
        return {
          ...part,
          dose: convertDoseValue(part.dose, part.unit, nextDoseUnit),
          unit: nextDoseUnit,
        }
      })
    )
    setStockTankSize((currentSize) => convertStockTankSize(currentSize, stockTankUnit, nextUnit))
    setStockTankUnit(nextUnit)
    setUsageRateUnit(nextUnit)
  }

  const handleStockTankOptionChange = (option: StockTankOption) => {
    setStockTankOption(option)
    // In direct-mix mode the size field is the reservoir being fed, not a stock
    // tank, so it starts from one batch's worth of feed — the round size of
    // whichever unit is currently in play, not a conversion of the other's.
    if (option === "direct") {
      setStockTankSize(DIRECT_MIX_RESERVOIR_SIZE[stockTankUnit])
    }
  }

  const goToScreen = (screen: Screen) => {
    if (screen === "analysis") {
      handlePartsChange(parts)
    } else if (screen === "feeding" || screen === "recipe") {
      handlePartsAnalysisChange(partsAnalysis)
    }
    setCurrentScreen(screen)
  }

  const screens: Screen[] = ["analysis", "feeding", "recipe"]
  const screenLabels = {
    analysis: "Guaranteed Analysis",
    feeding: "Feeding Rates",
    recipe: "Recipe & Shopping List",
  }

  if (isLoadingFormulation) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-lg font-medium text-foreground">Loading your formulation…</p>
          <p className="text-sm text-muted-foreground">Fetching saved data from your Dashboard</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="mb-8 text-center">
          <div className="mb-2 flex items-center justify-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/30 bg-primary/10">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6 text-primary"
              >
                <path d="M12 2v10" />
                <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
                <circle cx="12" cy="12" r="4" />
              </svg>
            </div>
            <h1 className="font-sans text-3xl font-bold tracking-tight text-foreground">
              HydroCalc
            </h1>
          </div>
          <p className="text-muted-foreground">
            Nutrient Replication Calculator
          </p>
        </header>

        {/* Load-error banner (non-blocking — calculator still usable) */}
        {loadError && (
          <div className="mb-6 flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <span className="font-semibold">Could not load formulation:</span>
            <span>{loadError}</span>
          </div>
        )}

        {/* Step Indicator */}
        <div className="mb-8 flex flex-wrap items-center justify-center gap-2 sm:gap-4">
          {screens.map((screen, index) => (
            <div key={screen} className="flex items-center gap-2 sm:gap-4">
              <button
                onClick={() => goToScreen(screen)}
                className={`flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition-all sm:px-4 ${
                  currentScreen === screen
                    ? "border-primary/50 bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                    : "border-border bg-secondary text-secondary-foreground hover:border-primary/30 hover:bg-secondary/80"
                }`}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-background/20 text-xs font-bold sm:h-6 sm:w-6">
                  {index + 1}
                </span>
                <span className="hidden sm:inline">{screenLabels[screen]}</span>
                <span className="sm:hidden">
                  {screen === "analysis" ? "Analysis" : screen === "feeding" ? "Rates" : "Recipe"}
                </span>
              </button>
              {index < screens.length - 1 && (
                <div className="hidden h-px w-4 bg-border sm:block sm:w-8" />
              )}
            </div>
          ))}
        </div>

        {/* Screen Content */}
        {currentScreen === "analysis" && (
          <GuaranteedAnalysisScreen
            partsAnalysis={partsAnalysis}
            onPartsAnalysisChange={handlePartsAnalysisChange}
            onNext={() => goToScreen("feeding")}
          />
        )}
        {currentScreen === "feeding" && (
          <FeedingRatesScreen
            parts={parts}
            onPartsChange={handlePartsChange}
            stockTankOption={stockTankOption}
            onStockTankOptionChange={handleStockTankOptionChange}
            volumeUnit={volumeUnit}
            onVolumeUnitChange={handleVolumeUnitChange}
            onBack={() => goToScreen("analysis")}
            onNext={() => goToScreen("recipe")}
          />
        )}
        {currentScreen === "recipe" && (
          <RecipeScreen
            key={recipeKey}
            partsAnalysis={partsAnalysis}
            parts={parts}
            stockTankOption={stockTankOption}
            volumeUnit={volumeUnit}
            stockTankSize={stockTankSize}
            onStockTankSizeChange={setStockTankSize}
            stockTankUnit={stockTankUnit}
            onStockTankUnitChange={setStockTankUnit}
            usageRateUnit={usageRateUnit}
            onUsageRateUnitChange={setUsageRateUnit}
            initialSettings={recipeInitialSettings}
            onBack={() => goToScreen("feeding")}
          />
        )}
      </div>
    </main>
  )
}
