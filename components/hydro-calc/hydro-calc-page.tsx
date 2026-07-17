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
  DEFAULT_INCLUDED_SALTS,
  ALL_SALTS_SELECTED,
  isSeparateNitrogenAvailable,
  type IncludedSaltsSelection,
} from "@/lib/hydro-calc/recipe-types"
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
  feedingParts: NutrientPart[]
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
      unit: "g_per_gallon" as const,
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
  const [stockTankOption, setStockTankOption] = useState<StockTankOption>("separate")
  const [includedSalts, setIncludedSalts] = useState<IncludedSaltsSelection>(DEFAULT_INCLUDED_SALTS)

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

        const data = await res.json()

        // --- Populate wizard state ---
        if (Array.isArray(data.partsAnalysis) && data.partsAnalysis.length > 0) {
          setPartsAnalysis(data.partsAnalysis)
        }
        if (Array.isArray(data.parts) && data.parts.length > 0) {
          setParts(data.parts)
        }
        if (data.stockTankOption) {
          setStockTankOption(data.stockTankOption as StockTankOption)
        }
        // Older saved formulations won't have this field — default to all-enabled so they
        // continue working without hitting the new "select at least one salt" validation.
        if (data.includedSalts && typeof data.includedSalts === "object") {
          // Strip deprecated fields (other, otherText) that may exist in old saves.
          // Migrate ironChelate → chelatedMicronutrients so pre-refactor saves carry
          // their iron selection forward as a full micro package.
          const {
            other: _other,
            otherText: _otherText,
            ironChelate,
            ...validSalts
          } = data.includedSalts as Record<string, unknown>
          const migrated: Partial<IncludedSaltsSelection> = validSalts as Partial<IncludedSaltsSelection>
          if (ironChelate === true && !("chelatedMicronutrients" in validSalts)) {
            migrated.chelatedMicronutrients = true
          }
          setIncludedSalts({ ...DEFAULT_INCLUDED_SALTS, ...migrated })
        } else {
          // Pre-salt-selection formulation — treat as all salts included
          setIncludedSalts(ALL_SALTS_SELECTED)
        }

        // --- Pre-fill recipe screen settings ---
        const settings: RecipeInitialSettings = {}
        if (data.stockTankSize) settings.stockTankSize = String(data.stockTankSize)
        if (data.stockTankUnit) settings.stockTankUnit = data.stockTankUnit
        if (data.concentrationRatio) settings.concentrationRatio = String(data.concentrationRatio)
        if (data.doserLayout) settings.doserLayout = data.doserLayout
        if (data.keepMicrosSeparate != null) settings.keepMicrosSeparate = data.keepMicrosSeparate
        if (data.targetEc != null) settings.targetEcInput = String(data.targetEc)
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

  useEffect(() => {
    if (!isSeparateNitrogenAvailable(parts.length) && stockTankOption === "separate") {
      setStockTankOption("doser")
    }
  }, [parts.length, stockTankOption])

  const handlePartsAnalysisChange = (nextPartsAnalysis: PartAnalysis[]) => {
    setPartsAnalysis(nextPartsAnalysis)
    setParts((currentParts) => syncFeedingPartsFromAnalysis(nextPartsAnalysis, currentParts))
  }

  const handlePartsChange = (nextParts: NutrientPart[]) => {
    setParts(nextParts)
    setPartsAnalysis((currentAnalysis) => syncAnalysisPartsFromFeeding(nextParts, currentAnalysis))
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
            includedSalts={includedSalts}
            onIncludedSaltsChange={setIncludedSalts}
            onNext={() => goToScreen("feeding")}
          />
        )}
        {currentScreen === "feeding" && (
          <FeedingRatesScreen
            parts={parts}
            onPartsChange={handlePartsChange}
            stockTankOption={stockTankOption}
            onStockTankOptionChange={setStockTankOption}
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
            includedSalts={includedSalts}
            initialSettings={recipeInitialSettings}
            onBack={() => goToScreen("feeding")}
          />
        )}
      </div>
    </main>
  )
}
