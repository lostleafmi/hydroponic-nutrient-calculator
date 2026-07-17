"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  HelpCircle,
  ArrowLeft,
  ArrowRight,
  Plus,
  Trash2,
  Beaker,
  FlaskConical,
  Droplets,
  AlertTriangle,
  ShieldCheck,
  Gauge,
} from "lucide-react"

export interface NutrientPart {
  id: string
  name: string
  dose: string
  unit: "ml_per_gallon" | "g_per_gallon"
}

import { isSeparateNitrogenAvailable } from "@/lib/hydro-calc/recipe-calculator"

export type StockTankOption = "separate" | "doser" | "ab" | "direct"

interface FeedingRatesScreenProps {
  parts: NutrientPart[]
  onPartsChange: (parts: NutrientPart[]) => void
  stockTankOption: StockTankOption
  onStockTankOptionChange: (option: StockTankOption) => void
  onBack: () => void
  onNext: () => void
}

export function FeedingRatesScreen({ 
  parts,
  onPartsChange,
  stockTankOption,
  onStockTankOptionChange,
  onBack,
  onNext
}: FeedingRatesScreenProps) {
  const canUseSeparateNitrogen = isSeparateNitrogenAvailable(parts.length)

  const addPart = () => {
    const newPart: NutrientPart = {
      id: Date.now().toString(),
      name: `Part ${String.fromCharCode(65 + parts.length)}`,
      dose: "",
      unit: "g_per_gallon"
    }
    onPartsChange([...parts, newPart])
  }

  const removePart = (id: string) => {
    if (parts.length > 1) {
      onPartsChange(parts.filter(p => p.id !== id))
    }
  }

  const updatePart = (id: string, updates: Partial<NutrientPart>) => {
    onPartsChange(parts.map(p => p.id === id ? { ...p, ...updates } : p))
  }

  return (
    <div className="space-y-6">
      {/* Nutrient Parts Section */}
      <Card className="border-2 border-border bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl text-foreground">
            <Beaker className="h-5 w-5 text-primary" />
            <span>Enter dosage rates from your feed chart</span>
          </CardTitle>
          <CardDescription>
            Look at your nutrient label or feed chart and type in how much of each part you use per
            gallon for the growth stage you&apos;re in. The unit starts at g/gal (good for dry powders).
            Flip the switch on the right to ml/gal if your nutrients come as a liquid.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Parts List */}
          <div className="space-y-4">
            {parts.map((part, index) => (
              <PartEntry
                key={part.id}
                part={part}
                index={index}
                onUpdate={(updates) => updatePart(part.id, updates)}
                onRemove={() => removePart(part.id)}
                canRemove={parts.length > 1}
              />
            ))}
          </div>

          {/* Add Part Button */}
          <Button
            variant="outline"
            onClick={addPart}
            className="w-full gap-2 border-dashed border-2 border-border hover:border-primary hover:bg-primary/5"
          >
            <Plus className="h-4 w-4" />
            Add Another Part
          </Button>

        </CardContent>
      </Card>

      {/* Stock Tank Options */}
      <Card className="border-2 border-border bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl text-foreground">
            <FlaskConical className="h-5 w-5 text-primary" />
            <span>How do you want to mix your stock tanks?</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-4 w-4 cursor-help text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                A stock tank is a strong, pre-mixed solution you keep on hand and dilute into your
                reservoir when it&apos;s time to feed. Pick a setup and we&apos;ll show you exactly what to mix.
              </TooltipContent>
            </Tooltip>
          </CardTitle>
          <CardDescription>
            Pick the setup that fits your grow. Each one comes with its own step-by-step mixing
            instructions on the next screen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup
            value={stockTankOption}
            onValueChange={(value) => onStockTankOptionChange(value as StockTankOption)}
            className="space-y-3"
          >
            {canUseSeparateNitrogen && (
              <StockTankOptionCard
                value="separate"
                title="Separate Nitrogen for tapering before harvest"
                description="Isolate Nitrogen so you can taper it at the end of flowering for better smoothness and flavor. Best for hand mixing into your reservoir or batch tank."
                icon={<Droplets className="h-5 w-5" />}
                selected={stockTankOption === "separate"}
                recommended
                safetyLabel="Safest"
                safetyTone="safe"
              />
            )}
            <StockTankOptionCard
              value="doser"
              title="Doser / Injector Optimized"
              description={`Made for dosers and injectors. You get one stock tank per part in your feed chart (${parts.length} tank${parts.length === 1 ? "" : "s"}).`}
              icon={<Gauge className="h-5 w-5" />}
              selected={stockTankOption === "doser"}
              recommended={!canUseSeparateNitrogen}
            />
            <StockTankOptionCard
              value="ab"
              title="Combine into A + B Tanks"
              description={`One stock tank per part in your nutrient line (${parts.length} tank${parts.length === 1 ? "" : "s"}) — matches how most multi-part feeds are used.`}
              icon={<FlaskConical className="h-5 w-5" />}
              selected={stockTankOption === "ab"}
            />
            <StockTankOptionCard
              value="direct"
              title="Mix Directly into Reservoir"
              description="No stock tanks. You add each salt straight into the reservoir, one at a time, stirring until it fully dissolves before adding the next. Simplest for small batches you mix fresh each time."
              icon={<Beaker className="h-5 w-5" />}
              selected={stockTankOption === "direct"}
              safetyLabel="Most careful order needed"
              safetyTone="danger"
            />
          </RadioGroup>

          {!canUseSeparateNitrogen && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              With {parts.length} parts in your nutrient line, we create one stock tank per part
              to match your original feed. Separate Nitrogen tapering is only available for
              3-part feeds or fewer.
            </p>
          )}

        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Analysis
        </Button>
        <Button onClick={onNext} className="gap-2">
          Calculate Recipe
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

function PartEntry({
  part,
  index,
  onUpdate,
  onRemove,
  canRemove
}: {
  part: NutrientPart
  index: number
  onUpdate: (updates: Partial<NutrientPart>) => void
  onRemove: () => void
  canRemove: boolean
}) {
  return (
    <div className="rounded-lg border-2 border-border bg-secondary/20 p-4">
      <div className="flex flex-wrap items-start gap-4">
        {/* Part Number Badge */}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
          {index + 1}
        </div>

        {/* Part Name Input */}
        <div className="min-w-[140px] flex-1">
          <Label htmlFor={`name-${part.id}`} className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Part Name
          </Label>
          <Input
            id={`name-${part.id}`}
            value={part.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            placeholder="e.g., Part A, Base, Grow"
            className="border-2 border-border bg-card"
          />
        </div>

        {/* Dose Input */}
        <div className="min-w-[100px] w-28">
          <Label htmlFor={`dose-${part.id}`} className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Dose
          </Label>
          <Input
            id={`dose-${part.id}`}
            type="number"
            step="0.1"
            min="0"
            value={part.dose}
            onChange={(e) => onUpdate({ dose: e.target.value })}
            placeholder="0.0"
            className="border-2 border-border bg-card"
          />
        </div>

        {/* Unit Toggle - ml/gal vs g/gal */}
        <div className="min-w-[160px]">
          <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Unit
          </Label>
          <div className="flex items-center gap-2 rounded-lg border-2 border-border bg-card p-2">
            <span className={`text-xs transition-colors ${part.unit === "ml_per_gallon" ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
              ml/gal
            </span>
            <Switch
              checked={part.unit === "g_per_gallon"}
              onCheckedChange={(checked) => 
                onUpdate({ unit: checked ? "g_per_gallon" : "ml_per_gallon" })
              }
            />
            <span className={`text-xs transition-colors ${part.unit === "g_per_gallon" ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
              g/gal
            </span>
          </div>
        </div>

        {/* Remove Button */}
        <div className="self-end">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onRemove}
                disabled={!canRemove}
                className="h-10 w-10 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
              >
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">Remove part</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {canRemove ? "Remove this part" : "At least one part is required"}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

type SafetyTone = "safe" | "caution" | "danger"

const SAFETY_TONE_CLASSES: Record<SafetyTone, string> = {
  safe: "bg-emerald-500/15 text-emerald-300",
  caution: "bg-amber-500/15 text-amber-300",
  danger: "bg-destructive/15 text-destructive",
}

const SAFETY_TONE_ICON: Record<SafetyTone, React.ReactNode> = {
  safe: <ShieldCheck className="h-3.5 w-3.5" />,
  caution: <AlertTriangle className="h-3.5 w-3.5" />,
  danger: <AlertTriangle className="h-3.5 w-3.5" />,
}

function StockTankOptionCard({
  value,
  title,
  description,
  icon,
  recommended = false,
  selected = false,
  safetyLabel,
  safetyTone = "safe",
}: {
  value: string
  title: string
  description: string
  icon: React.ReactNode
  recommended?: boolean
  selected?: boolean
  safetyLabel?: string
  safetyTone?: SafetyTone
}) {
  const isRecommended = recommended
  const borderClass = selected
    ? isRecommended
      ? "border-primary ring-2 ring-primary/30 bg-primary/10"
      : "border-primary bg-primary/5"
    : isRecommended
      ? "border-primary/60 bg-primary/5 hover:border-primary"
      : "border-border bg-secondary/20 hover:border-primary/50"

  return (
    <div className="flex items-start gap-3">
      <RadioGroupItem value={value} id={value} className="mt-1" />
      <Label
        htmlFor={value}
        className={`flex flex-1 cursor-pointer flex-col rounded-lg border-2 p-4 transition-all ${borderClass}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className={`${selected ? "text-primary" : "text-muted-foreground"}`}>
            {icon}
          </span>
          <span className="font-semibold text-foreground">{title}</span>
          {isRecommended && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
              Recommended
            </span>
          )}
          {safetyLabel && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${SAFETY_TONE_CLASSES[safetyTone]}`}
            >
              {SAFETY_TONE_ICON[safetyTone]}
              {safetyLabel}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </Label>
    </div>
  )
}
