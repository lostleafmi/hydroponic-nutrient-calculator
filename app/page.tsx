"use client"

import { useEffect, useState } from "react"
import {
  GuaranteedAnalysisScreen,
  type PartAnalysis,
  createEmptyPartAnalysis,
} from "@/components/hydro-calc/guaranteed-analysis-screen"
import { FeedingRatesScreen, type NutrientPart, type StockTankOption } from "@/components/hydro-calc/feeding-rates-screen"
import { RecipeScreen } from "@/components/hydro-calc/recipe-screen"
import { isSeparateNitrogenAvailable } from "@/lib/hydro-calc/recipe-calculator"

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

export default function HydroCalcPage() {
  const [initialState] = useState(createInitialWizardState)
  const [currentScreen, setCurrentScreen] = useState<Screen>("analysis")
  const [partsAnalysis, setPartsAnalysis] = useState<PartAnalysis[]>(initialState.partsAnalysis)
  const [parts, setParts] = useState<NutrientPart[]>(initialState.parts)
  const [stockTankOption, setStockTankOption] = useState<StockTankOption>("separate")

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
            onStockTankOptionChange={setStockTankOption}
            onBack={() => goToScreen("analysis")}
            onNext={() => goToScreen("recipe")}
          />
        )}
        {currentScreen === "recipe" && (
          <RecipeScreen
            partsAnalysis={partsAnalysis}
            parts={parts}
            stockTankOption={stockTankOption}
            onBack={() => goToScreen("feeding")}
          />
        )}
      </div>
    </main>
  )
}
