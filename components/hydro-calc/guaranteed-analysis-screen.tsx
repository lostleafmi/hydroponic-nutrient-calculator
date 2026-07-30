"use client"

import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ImageLightbox } from "@/components/hydro-calc/image-lightbox"
import { HelpCircle, ArrowRight, Upload, Camera, Check, Plus, Trash2, ImageIcon, X, FlaskConical, AlertCircle, AlertTriangle, ZoomIn } from "lucide-react"
import {
  DEFAULT_INCLUDED_SALTS,
  parsePositive,
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
  /**
   * Optional user-specified Calcium Chloride dose for this part, in grams of
   * CaCl₂·2H₂O per US gallon of working (reservoir) feed. Only meaningful
   * when `includedSalts.calciumChloride` is checked. When left blank, the
   * solver falls back to its own sensible default share of the Calcium
   * target instead of leaving Calcium Chloride at zero.
   */
  calciumChlorideGramsPerGallon?: string
  /**
   * The "% Urea Nitrogen" value listed on this part's label — required
   * (unlike Calcium Chloride's optional dose above) when
   * `includedSalts.urea` is checked, since there's no sensible fallback:
   * Urea's Nitrogen contribution can't be inferred from anything else on
   * the label. See `ureaNitrogenPpmForPart`.
   */
  ureaNitrogenPercent?: string
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
  // Tracks parts where Urea is checked but its required "% Urea Nitrogen"
  // field is blank/invalid — unlike Calcium Chloride's optional dose, there's
  // no sensible fallback for Urea's Nitrogen contribution, so this blocks
  // "Continue to Feeding Rates" the same way `saltErrorPartIds` does.
  const [ureaErrorPartIds, setUreaErrorPartIds] = useState<Set<string>>(new Set())

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

    // Unchecking Urea means its % field is no longer required, so any
    // outstanding error for this part no longer applies.
    if (saltId === "urea" && !checked) {
      setUreaErrorPartIds((prev) => {
        if (!prev.has(partId)) return prev
        const next = new Set(prev)
        next.delete(partId)
        return next
      })
    }
  }

  const updateUreaNitrogenPercent = (partId: string, value: string) => {
    updatePart(partId, { ureaNitrogenPercent: value })
    if (parsePositive(value) > 0) {
      setUreaErrorPartIds((prev) => {
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
    const partsMissingUreaPercent = partsAnalysis.filter(
      (part) => part.includedSalts.urea && parsePositive(part.ureaNitrogenPercent) <= 0
    )
    if (partsMissingSalts.length > 0 || partsMissingUreaPercent.length > 0) {
      setSaltErrorPartIds(new Set(partsMissingSalts.map((p) => p.id)))
      setUreaErrorPartIds(new Set(partsMissingUreaPercent.map((p) => p.id)))
      return
    }
    setSaltErrorPartIds(new Set())
    setUreaErrorPartIds(new Set())
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
              Take a picture or screenshot of the guaranteed analysis section of the label on your
              bag/bottle. All you will need are the nutrient percentages and the &quot;Derived
              from&quot; section, if your picture is of the entire label it will be harder to read
              and reference the numbers with this tool, use the zoom feature if needed. Use the
              picture to input all of the corresponding nutrient percentages manually and then
              refer to the &quot;Derived from&quot; section of your picture to check all of the
              Salts &amp; Inputs in each part.
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
              hasUreaError={ureaErrorPartIds.has(part.id)}
              onUpdate={(updates) => updatePart(part.id, updates)}
              onRemove={() => removePart(part.id)}
              onFileUpload={(file) => handleFileUpload(part.id, file)}
              onRemovePhoto={() => removePhoto(part.id)}
              onToggleSalt={(saltId, checked) => toggleSalt(part.id, saltId, checked)}
              onUreaNitrogenPercentChange={(value) => updateUreaNitrogenPercent(part.id, value)}
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
  inputId,
  label,
  elementsLabel,
  sublabel,
  centerSublabel,
  checked,
  onCheckedChange,
  children,
  fullWidth,
}: {
  /**
   * Fully-qualified, DOM-unique id for this checkbox — must be unique across
   * the WHOLE page, not just within one part. Every part renders the same
   * set of salt options, so a caller-supplied id scoped only by salt key
   * (e.g. "salt-calciumNitrate") collides across parts: the browser then
   * routes label clicks/focus to the FIRST element with that id, which is
   * why checking a salt in Part B was toggling Part A's checkbox instead.
   */
  inputId: string
  label: string
  /** Short elemental shorthand shown as its own centered line under `label` (e.g. "Fe, Mn, Zn, B, Cu, Mo"). */
  elementsLabel?: string
  /** A literal `"\n"` renders as an intentional, non-wrapping line break (see `SaltCheckboxOption.sublabel`). */
  sublabel: string
  /** Center `label`/`elementsLabel`/`sublabel` even when there's no `elementsLabel` forcing it. */
  centerSublabel?: boolean
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** Extra content (e.g. an optional amount field) shown below the label, only while checked. */
  children?: React.ReactNode
  /** Spans both columns of the parent grid, putting this option on its own full-width row. */
  fullWidth?: boolean
}) {
  // Options with an `elementsLabel` pack three lines of text into one card
  // (name, element shorthand, full ingredient list) — center all three so
  // they read as one tidy block instead of a ragged left-aligned paragraph.
  // `centerSublabel` opts a plain label+sublabel option into the same
  // treatment (e.g. a short two-line disclaimer reads better centered).
  const centered = Boolean(elementsLabel) || Boolean(centerSublabel)

  // A literal "\n" in `sublabel` marks deliberate line breaks (e.g. so a
  // short phrase always stays on its own line instead of wrapping wherever
  // happens to fit at the current width) — render each as its own
  // non-wrapping line. Sublabels without a "\n" keep wrapping normally.
  const sublabelLines = sublabel.split("\n")

  return (
    <div
      // `flex flex-col justify-center` centers the checkbox+label row (and
      // the optional children below it) in the middle of the card. Grid
      // items stretch to fill their row's height by default, so a card
      // sitting next to a taller sibling ends up taller than its own
      // content — without this, that content just sits at the top with
      // dead space below it, since a plain block div doesn't center its
      // children.
      className={`flex flex-col justify-center rounded-lg border-2 p-3 transition-colors ${
        fullWidth ? "sm:col-span-2" : ""
      } ${checked ? "border-primary/40 bg-primary/5" : "border-border bg-secondary/20"}`}
    >
      <div className="flex items-center gap-3">
        <Checkbox
          id={inputId}
          checked={checked}
          onCheckedChange={(next) => onCheckedChange(next === true)}
          className="shrink-0"
        />
        {/* `text-pretty` avoids ragged, single-word wrapped lines on the
            longer salt names/sublabels. */}
        <Label
          htmlFor={inputId}
          className={`flex flex-1 cursor-pointer flex-col justify-center gap-1 ${
            centered ? "items-center text-center" : ""
          }`}
        >
          <span className="text-pretty font-medium leading-snug text-foreground">{label}</span>
          {elementsLabel && (
            <span className="text-pretty font-mono text-xs font-semibold leading-snug text-foreground/80">
              {elementsLabel}
            </span>
          )}
          {sublabel && (
            <span className="text-pretty text-xs leading-snug text-muted-foreground">
              {sublabelLines.length > 1
                ? sublabelLines.map((line, i) => (
                    <span key={i} className="block whitespace-nowrap">
                      {line}
                    </span>
                  ))
                : sublabel}
            </span>
          )}
        </Label>
      </div>
      {checked && children && <div className="mt-2 pl-8">{children}</div>}
    </div>
  )
}

function PartAnalysisCard({
  part,
  index,
  canRemove,
  hasSaltError,
  hasUreaError,
  onUpdate,
  onRemove,
  onFileUpload,
  onRemovePhoto,
  onToggleSalt,
  onUreaNitrogenPercentChange,
}: {
  part: PartAnalysis
  index: number
  canRemove: boolean
  hasSaltError: boolean
  hasUreaError: boolean
  onUpdate: (updates: Partial<PartAnalysis>) => void
  onRemove: () => void
  onFileUpload: (file: File) => void
  onRemovePhoto: () => void
  onToggleSalt: (saltId: keyof IncludedSaltsSelection, checked: boolean) => void
  onUreaNitrogenPercentChange: (value: string) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)

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
          <div
            className={`rounded-lg border-2 border-dashed border-border bg-secondary/20 p-4 flex flex-col items-center justify-center text-center ${
              part.photoUrl ? "" : "min-h-[300px]"
            }`}
          >
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
                <button
                  type="button"
                  onClick={() => setLightboxOpen(true)}
                  aria-label={`View full-size photo of ${part.name} label`}
                  className="group relative block w-full cursor-zoom-in overflow-hidden rounded-lg border border-border bg-background outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {/*
                   * No fixed height here on purpose — sizing the box to a
                   * constant like h-64 forces every photo into that box via
                   * object-contain, which shrinks portrait-orientation label
                   * photos (the common case when photographing a bottle) down
                   * to a tiny, hard-to-read strip. `h-auto` + `max-h-[70vh]`
                   * instead lets the box grow to the image's own natural
                   * aspect ratio — full column width, height whatever that
                   * implies — so the label's numbers render as large as
                   * possible, only capped so a very tall photo can't take
                   * over the whole page. Zoom is still available for
                   * fine detail via the lightbox below.
                   */}
                  <img
                    src={part.photoUrl}
                    alt={`Label for ${part.name}`}
                    className="block h-auto max-h-[70vh] w-full object-contain"
                  />
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">
                    <span className="flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white">
                      <ZoomIn className="h-3.5 w-3.5" />
                      Tap to zoom
                    </span>
                  </div>
                </button>
                <ImageLightbox
                  src={part.photoUrl}
                  alt={`Label for ${part.name}`}
                  open={lightboxOpen}
                  onOpenChange={setLightboxOpen}
                />
                <p className="text-sm text-muted-foreground">
                  Photo uploaded. Use it as a reference while entering values manually. Tap the photo to zoom in and read small text.
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
                inputId={`salt-${part.id}-${option.id}`}
                label={option.label}
                elementsLabel={option.elementsLabel}
                sublabel={option.sublabel}
                centerSublabel={option.centerSublabel}
                checked={part.includedSalts[option.id]}
                onCheckedChange={(checked) => onToggleSalt(option.id, checked)}
                fullWidth={option.id === "chelatedMicronutrients"}
              >
                {option.id === "calciumChloride" && (
                  <div className="flex items-center gap-2">
                    <Label
                      htmlFor={`salt-${part.id}-${option.id}-amount`}
                      className="text-xs text-muted-foreground"
                    >
                      Amount (optional)
                    </Label>
                    <Input
                      id={`salt-${part.id}-${option.id}-amount`}
                      type="number"
                      step="0.01"
                      min="0"
                      value={part.calciumChlorideGramsPerGallon ?? ""}
                      onChange={(e) => onUpdate({ calciumChlorideGramsPerGallon: e.target.value })}
                      placeholder="0.0"
                      className="h-7 w-20 border-2 border-border bg-background text-right font-mono text-xs"
                    />
                    <span className="text-xs text-muted-foreground">g/gal</span>
                  </div>
                )}
                {option.id === "urea" && (
                  <div>
                    <div className="flex items-center gap-2">
                      <Label
                        htmlFor={`salt-${part.id}-${option.id}-percent`}
                        className="text-xs text-muted-foreground"
                      >
                        % Urea Nitrogen (required)
                      </Label>
                      <Input
                        id={`salt-${part.id}-${option.id}-percent`}
                        type="number"
                        step="0.01"
                        min="0"
                        required
                        value={part.ureaNitrogenPercent ?? ""}
                        onChange={(e) => onUreaNitrogenPercentChange(e.target.value)}
                        placeholder="0.0"
                        aria-invalid={hasUreaError}
                        className={`h-7 w-20 border-2 bg-background text-right font-mono text-xs ${
                          hasUreaError ? "border-destructive" : "border-border"
                        }`}
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                    {hasUreaError && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                        <AlertCircle className="h-3 w-3 shrink-0" />
                        Enter the % Urea Nitrogen from the label to continue.
                      </p>
                    )}
                  </div>
                )}
              </SaltCheckboxRow>
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
