"use client"

import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { HelpCircle, ArrowRight, Upload, Camera, Check, Plus, Trash2, ImageIcon, X, FlaskConical, AlertCircle, AlertTriangle } from "lucide-react"
import {
  DEFAULT_INCLUDED_SALTS,
  SALT_CHECKBOX_OPTIONS,
  type IncludedSaltsSelection,
} from "@/lib/hydro-calc/recipe-types"

// Analysis for a single part/bottle
export interface PartAnalysis {
  id: string
  name: string
  nitrogen: string
  phosphate: string
  potash: string
  calcium: string
  magnesium: string
  sulfur: string
  iron: string
  manganese: string
  zinc: string
  boron: string
  copper: string
  molybdenum: string
  photoUrl?: string
  photoName?: string
  /** Which raw salts/inputs the user says are present in THIS part specifically. */
  includedSalts: IncludedSaltsSelection
}

// Combined analysis from all parts (for backwards compatibility)
export interface NutrientAnalysis {
  nitrogen: string
  phosphate: string
  potash: string
  calcium: string
  magnesium: string
  sulfur: string
  iron: string
  manganese: string
  zinc: string
  boron: string
  copper: string
  molybdenum: string
}

interface GuaranteedAnalysisScreenProps {
  partsAnalysis: PartAnalysis[]
  onPartsAnalysisChange: (parts: PartAnalysis[]) => void
  onNext: () => void
}

export const createEmptyPartAnalysis = (name: string, id?: string): PartAnalysis => ({
  id: id ?? Date.now().toString() + Math.random().toString(36).substr(2, 9),
  name,
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
})

export function GuaranteedAnalysisScreen({ 
  partsAnalysis, 
  onPartsAnalysisChange, 
  onNext 
}: GuaranteedAnalysisScreenProps) {
  const [saltErrorPartIds, setSaltErrorPartIds] = useState<Set<string>>(new Set())

  const addPart = () => {
    const partLetter = String.fromCharCode(65 + partsAnalysis.length)
    const newPart = createEmptyPartAnalysis(`Part ${partLetter}`)
    onPartsAnalysisChange([...partsAnalysis, newPart])
  }

  const removePart = (id: string) => {
    if (partsAnalysis.length > 1) {
      const removed = partsAnalysis.find(p => p.id === id)
      if (removed?.photoUrl) URL.revokeObjectURL(removed.photoUrl)
      onPartsAnalysisChange(partsAnalysis.filter(p => p.id !== id))
    }
  }

  const updatePart = (id: string, updates: Partial<PartAnalysis>) => {
    onPartsAnalysisChange(partsAnalysis.map(p => p.id === id ? { ...p, ...updates } : p))
  }

  const handleFileUpload = (partId: string, file: File) => {
    if (!file) return
    const previous = partsAnalysis.find(p => p.id === partId)
    if (previous?.photoUrl) URL.revokeObjectURL(previous.photoUrl)
    updatePart(partId, {
      photoUrl: URL.createObjectURL(file),
      photoName: file.name,
    })
  }

  const removePhoto = (partId: string) => {
    const part = partsAnalysis.find(p => p.id === partId)
    if (part?.photoUrl) URL.revokeObjectURL(part.photoUrl)
    updatePart(partId, { photoUrl: undefined, photoName: undefined })
  }

  const toggleSalt = (partId: string, saltId: keyof IncludedSaltsSelection, checked: boolean) => {
    const part = partsAnalysis.find((p) => p.id === partId)
    if (!part) return
    const updatedSalts = { ...part.includedSalts, [saltId]: checked }
    updatePart(partId, { includedSalts: updatedSalts })

    if (checked) {
      setSaltErrorPartIds((prev) => {
        if (!prev.has(partId)) return prev
        const next = new Set(prev)
        next.delete(partId)
        return next
      })
    }
  }

  const handleNext = () => {
    const partsMissingSalts = partsAnalysis.filter(
      (part) => !SALT_CHECKBOX_OPTIONS.some((opt) => part.includedSalts[opt.id])
    )
    if (partsMissingSalts.length > 0) {
      setSaltErrorPartIds(new Set(partsMissingSalts.map((p) => p.id)))
      return
    }
    setSaltErrorPartIds(new Set())
    onNext()
  }

  return (
    <div className="space-y-6">
      {/* Main Card */}
      <Card className="border-2 border-border bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl text-foreground">
            <span>Your Product&apos;s Guaranteed Analysis</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-4 w-4 cursor-help text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                The Guaranteed Analysis is required by law on all fertilizer labels. It tells you exactly what nutrients are in the product.
              </TooltipContent>
            </Tooltip>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Directions */}
          <div className="rounded-lg border border-border bg-secondary/30 p-4">
            <h4 className="mb-1 font-semibold text-foreground">Directions</h4>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Input your product&apos;s nutrient percentages from the guaranteed analysis on the label.
              Take a picture or a screenshot of the guaranteed analysis on your label and upload it
              for reference while you input the values from the label into the corresponding fields.
            </p>
          </div>

          {/* Accuracy disclaimer */}
          <div className="flex items-start gap-3 rounded-lg border-2 border-destructive/70 bg-destructive/10 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <p className="text-sm font-bold leading-snug text-destructive">
              IT IS EXTREMELY IMPORTANT THAT YOU DOUBLE CHECK THESE NUMBERS TO ENSURE THEY ARE
              CORRECT, PUTTING INCORRECT NUMBERS IN THESE FIELDS CAN BE DETRIMENTAL TO YOUR MIX
              AND YOUR PLANTS HEALTH.
            </p>
          </div>

          {/* Parts List */}
          {partsAnalysis.map((part, index) => (
            <PartAnalysisCard
              key={part.id}
              part={part}
              index={index}
              canRemove={partsAnalysis.length > 1}
              hasSaltError={saltErrorPartIds.has(part.id)}
              onUpdate={(updates) => updatePart(part.id, updates)}
              onRemove={() => removePart(part.id)}
              onFileUpload={(file) => handleFileUpload(part.id, file)}
              onRemovePhoto={() => removePhoto(part.id)}
              onToggleSalt={(saltId, checked) => toggleSalt(part.id, saltId, checked)}
            />
          ))}

          {/* Add Part Button */}
          <Button
            variant="outline"
            onClick={addPart}
            className="w-full gap-2 border-dashed border-2 border-border hover:border-primary hover:bg-primary/5"
          >
            <Plus className="h-4 w-4" />
            Add Another Part
          </Button>

          <p className="text-sm text-muted-foreground">
            If your nutrient line is a 3 part simply click the &quot;+ Add another part&quot; button to add the third part and then enter the values.
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-col items-end gap-2">
        {saltErrorPartIds.size > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>
              Please select at least one salt/input for every part that is present in your
              product.
            </span>
          </div>
        )}
        <Button onClick={handleNext} className="gap-2">
          Continue to Feeding Rates
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

function SaltCheckboxRow({
  id,
  label,
  sublabel,
  checked,
  onCheckedChange,
}: {
  id: string
  label: string
  sublabel: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const inputId = `salt-${id}`
  return (
    <div
      className={`flex items-start gap-3 rounded-lg border-2 p-3 transition-colors ${
        checked ? "border-primary/40 bg-primary/5" : "border-border bg-secondary/20"
      }`}
    >
      <Checkbox
        id={inputId}
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        className="mt-0.5"
      />
      <Label htmlFor={inputId} className="flex flex-1 cursor-pointer flex-col gap-0.5">
        <span className="font-medium text-foreground">{label}</span>
        {sublabel && <span className="text-xs text-muted-foreground">{sublabel}</span>}
      </Label>
    </div>
  )
}

function PartAnalysisCard({
  part,
  index,
  canRemove,
  hasSaltError,
  onUpdate,
  onRemove,
  onFileUpload,
  onRemovePhoto,
  onToggleSalt,
}: {
  part: PartAnalysis
  index: number
  canRemove: boolean
  hasSaltError: boolean
  onUpdate: (updates: Partial<PartAnalysis>) => void
  onRemove: () => void
  onFileUpload: (file: File) => void
  onRemovePhoto: () => void
  onToggleSalt: (saltId: keyof IncludedSaltsSelection, checked: boolean) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      onFileUpload(file)
    }
    // Reset so re-selecting the same file still fires onChange
    e.target.value = ""
  }

  return (
    <div className="rounded-lg border-2 border-border bg-card overflow-hidden">
      {/* Part Header */}
      <div className="flex items-center justify-between bg-secondary/50 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
            {index + 1}
          </div>
          <Input
            value={part.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            placeholder="Part name"
            className="w-40 border-2 border-border bg-background font-semibold"
          />
        </div>
        <div className="flex items-center gap-2">
          {/* Photo Upload Status */}
          {part.photoUrl && (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-300">
              <ImageIcon className="h-4 w-4" />
              <span className="hidden sm:inline max-w-24 truncate">{part.photoName}</span>
              <button 
                onClick={onRemovePhoto}
                className="hover:text-emerald-100"
                aria-label="Remove photo"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {canRemove && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onRemove}
                  className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="sr-only">Remove part</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Remove this part</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Two columns: Manual Entry & Photo Upload */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Manual Entry Section */}
          <div className="rounded-lg border-2 border-border bg-background p-4">
            <div className="mb-3 flex items-center gap-2">
              <Check className="h-4 w-4 text-primary" />
              <h4 className="font-semibold text-foreground text-sm">Enter Manually</h4>
            </div>
            
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                NPK
              </p>
              <NutrientInput
                label="Total Nitrogen"
                fullLabel="N"
                value={part.nitrogen}
                onChange={(v) => onUpdate({ nitrogen: v })}
                tooltip="Nitrogen promotes vegetative growth and leaf development."
                highlight
              />
              <NutrientInput
                label="Available Phosphate"
                fullLabel="P₂O₅"
                value={part.phosphate}
                onChange={(v) => onUpdate({ phosphate: v })}
                tooltip="Phosphorus supports root development and flowering."
              />
              <NutrientInput
                label="Soluble Potash"
                fullLabel="K₂O"
                value={part.potash}
                onChange={(v) => onUpdate({ potash: v })}
                tooltip="Potassium regulates water uptake and plant health."
                highlight
              />
              
              <div className="border-t border-dashed border-muted-foreground/30 pt-2 mt-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Secondary
                </p>
              </div>
              
              <NutrientInput
                label="Calcium"
                fullLabel="Ca"
                value={part.calcium}
                onChange={(v) => onUpdate({ calcium: v })}
                tooltip="Calcium strengthens cell walls."
              />
              <NutrientInput
                label="Magnesium"
                fullLabel="Mg"
                value={part.magnesium}
                onChange={(v) => onUpdate({ magnesium: v })}
                tooltip="Magnesium is essential for photosynthesis."
              />
              <NutrientInput
                label="Sulfur"
                fullLabel="S"
                value={part.sulfur}
                onChange={(v) => onUpdate({ sulfur: v })}
                tooltip="Sulfur is essential for protein synthesis."
              />

              <div className="border-t border-dashed border-muted-foreground/30 pt-2 mt-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Micronutrients
                </p>
              </div>

              <NutrientInput
                label="Iron"
                fullLabel="Fe"
                value={part.iron}
                onChange={(v) => onUpdate({ iron: v })}
                tooltip="Iron is crucial for chlorophyll synthesis."
              />
              <NutrientInput
                label="Manganese"
                fullLabel="Mn"
                value={part.manganese}
                onChange={(v) => onUpdate({ manganese: v })}
                tooltip="Manganese assists in photosynthesis."
              />
              <NutrientInput
                label="Zinc"
                fullLabel="Zn"
                value={part.zinc}
                onChange={(v) => onUpdate({ zinc: v })}
                tooltip="Zinc is important for enzyme activation."
              />
              <NutrientInput
                label="Boron"
                fullLabel="B"
                value={part.boron}
                onChange={(v) => onUpdate({ boron: v })}
                tooltip="Boron aids in cell wall formation."
              />
              <NutrientInput
                label="Copper"
                fullLabel="Cu"
                value={part.copper}
                onChange={(v) => onUpdate({ copper: v })}
                tooltip="Copper is involved in photosynthesis."
              />
              <NutrientInput
                label="Molybdenum"
                fullLabel="Mo"
                value={part.molybdenum}
                onChange={(v) => onUpdate({ molybdenum: v })}
                tooltip="Molybdenum is essential for nitrogen fixation."
              />
            </div>
          </div>

          {/* Photo Upload Section */}
          <div className="rounded-lg border-2 border-dashed border-border bg-secondary/20 p-4 flex flex-col items-center justify-center text-center min-h-[300px]">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />
            {part.photoUrl ? (
              <div className="space-y-3 w-full">
                <div className="relative flex h-64 items-center justify-center rounded-lg overflow-hidden border border-border bg-background">
                  <img 
                    src={part.photoUrl} 
                    alt={`Label for ${part.name}`}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  Photo uploaded. Use it as a reference while entering values manually.
                </p>
                <div className="flex items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    className="gap-2"
                  >
                    <Upload className="h-4 w-4" />
                    Replace
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onRemovePhoto}
                    className="gap-2"
                  >
                    <X className="h-4 w-4" />
                    Remove Photo
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary mb-3">
                  <Camera className="h-6 w-6 text-muted-foreground" />
                </div>
                <h4 className="font-semibold text-foreground">Upload Label Photo</h4>
                <p className="mt-1 text-sm text-muted-foreground max-w-[200px]">
                  Take a photo of this part&apos;s guaranteed analysis label
                </p>
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="gap-2 mt-3"
                >
                  <Upload className="h-4 w-4" />
                  Choose Photo
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Salts & Inputs Included in this part */}
        <div
          className={`rounded-lg border-2 p-4 transition-colors ${
            hasSaltError ? "border-destructive/60 bg-destructive/5" : "border-border bg-background"
          }`}
        >
          <div className="mb-3 flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary" />
            <h4 className="font-semibold text-foreground text-sm">
              Salts &amp; Inputs Included in {part.name || `Part ${index + 1}`}
            </h4>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-4 w-4 cursor-help text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Only check the salts that are actually listed on THIS part&apos;s guaranteed
                analysis or &quot;derived from&quot; section. This tells the solver which raw
                salts it&apos;s allowed to use when replicating this specific part — so it never
                mixes salts that your nutrient line keeps in different bottles.
              </TooltipContent>
            </Tooltip>
          </div>

          <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
            Look at the &quot;Derived from&quot; section of this part&apos;s label and check off
            only the ingredients listed there.
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            {SALT_CHECKBOX_OPTIONS.map((option) => (
              <SaltCheckboxRow
                key={option.id}
                id={option.id}
                label={option.label}
                sublabel={option.sublabel}
                checked={part.includedSalts[option.id]}
                onCheckedChange={(checked) => onToggleSalt(option.id, checked)}
              />
            ))}
          </div>

          {hasSaltError && (
            <p className="mt-3 flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Select at least one salt/input that is present in this part.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function NutrientInput({ 
  label, 
  fullLabel,
  value,
  onChange,
  tooltip,
  highlight = false,
  compact = false
}: { 
  label: string
  fullLabel: string
  value: string
  onChange: (value: string) => void
  tooltip: string
  highlight?: boolean
  compact?: boolean
}) {
  return (
    <div className={`flex items-center justify-between gap-2 rounded px-2 py-1 ${
      highlight ? "bg-primary/10" : ""
    }`}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`flex cursor-help items-center gap-1.5 text-foreground ${compact ? "text-xs font-mono" : "text-sm"}`}>
            <span className="font-medium">{label}</span>
            {!compact && <span className="font-mono text-muted-foreground text-xs">({fullLabel})</span>}
            <HelpCircle className="h-3 w-3 text-muted-foreground" />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          {tooltip}
        </TooltipContent>
      </Tooltip>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          step="0.001"
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.0"
          className={`text-right border-2 border-border bg-background font-mono ${compact ? "w-16 h-7 text-xs" : "w-20 h-8 text-sm"}`}
        />
        <span className={`text-muted-foreground font-mono ${compact ? "text-xs" : "text-sm"}`}>%</span>
      </div>
    </div>
  )
}

// Helper function to combine all parts into a single analysis (summing percentages)
export function combinePartsAnalysis(parts: PartAnalysis[]): NutrientAnalysis {
  const combined: NutrientAnalysis = {
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
  }

  // For each nutrient, we'll track which parts have values
  // The combination logic will be handled in the recipe calculation
  // For now, just return the first non-empty value for each nutrient
  const keys = Object.keys(combined) as Array<keyof NutrientAnalysis>
  
  for (const key of keys) {
    const values = parts
      .map(p => parseFloat(p[key] || "0"))
      .filter(v => !isNaN(v) && v > 0)
    
    if (values.length > 0) {
      // Store the sum of all parts for this nutrient
      combined[key] = values.reduce((a, b) => a + b, 0).toString()
    }
  }

  return combined
}
