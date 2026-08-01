"use client"

/**
 * The Direct Mix recipe as a bag of dry powder instead of a reservoir dose.
 *
 * Presentation only: every gram shown here is the solver's own Direct Mix
 * amount, rescaled to fill a bag (see `lib/hydro-calc/dry-batch.ts`). Nothing
 * on this screen can change an elemental target or a salt amount, which is why
 * it's offered as an alternate view of the direct-mix list rather than as
 * another tank layout.
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  AlertTriangle,
  ArrowLeft,
  Blend,
  Package,
  Scale,
  ShieldAlert,
  Sparkles,
} from "lucide-react"
import {
  DRY_BATCH_SIZES_LB,
  formatBagGrams,
  formatUseRateGrams,
  type DryBag,
  type DryBatchSizeLb,
  type DryBulkBatch,
} from "@/lib/hydro-calc/dry-batch"
import type { VolumeUnit } from "@/lib/hydro-calc/recipe-types"

/**
 * The one thing this whole screen has to say before anything else. Kept as a
 * constant because it's repeated as step 1 of the tutorial, and the two must
 * not drift apart.
 */
export const DRY_BATCH_DISCLAIMER =
  "Please consider mixing stock tanks instead of using this method, mixing into stock tanks " +
  "ensures certainty that all of the macro and micronutrients will be dosed at the correct " +
  'amounts. To switch to this method go back to the "Feeding rates" tab by clicking "Feeding ' +
  'rates" at the top or bottom of this screen and select "Separate nitrogen for tapering before ' +
  'harvest" or "Combine into A+B tanks".'

/**
 * The entry point, shown at the top of the Direct Mix formulation. Opens the
 * size choice; once a size is picked the batch view below replaces the
 * per-reservoir salt list, and this card becomes the way back.
 */
export function DryBulkBatchEntry({
  sizeLb,
  isPickerOpen,
  onPickerOpenChange,
  onPickSize,
  onExit,
}: {
  /** The active batch size, or null when the normal direct-mix view is showing. */
  sizeLb: DryBatchSizeLb | null
  isPickerOpen: boolean
  onPickerOpenChange: (open: boolean) => void
  onPickSize: (sizeLb: DryBatchSizeLb) => void
  onExit: () => void
}) {
  return (
    <>
      <Card className="border-2 border-primary/40 bg-primary/5">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
          <div className="flex items-start gap-3">
            <Package className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="font-semibold text-foreground">
                {sizeLb === null
                  ? "Want to weigh out a bulk dry blend instead?"
                  : `Mixing ${sizeLb} lb bags`}
              </p>
              <p className="text-sm text-muted-foreground">
                {sizeLb === null
                  ? "Same recipe, split into bags that are safe to store together and scaled so each one weighs 10 or 25 lb, so you can blend it once and scoop from it later."
                  : `Showing the bagged dry blend below — ${sizeLb} lb per bag — instead of the per-reservoir salt list.`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {sizeLb !== null && (
              <div className="flex overflow-hidden rounded-lg border-2 border-border">
                {DRY_BATCH_SIZES_LB.map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => onPickSize(size)}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                      size !== DRY_BATCH_SIZES_LB[0] ? "border-l-2 border-border" : ""
                    } ${
                      sizeLb === size
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground hover:bg-secondary/80"
                    }`}
                  >
                    {size} lb
                  </button>
                ))}
              </div>
            )}
            {sizeLb === null ? (
              <Button onClick={() => onPickerOpenChange(true)} className="gap-2">
                <Scale className="h-4 w-4" />
                Mix a 10 or 25 lb batch
              </Button>
            ) : (
              <Button variant="outline" onClick={onExit} className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back to per-reservoir recipe
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={isPickerOpen} onOpenChange={onPickerOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>How big a bag?</DialogTitle>
            <DialogDescription>
              This is the weight of each individual bag, not of all of them added together — the
              recipe&apos;s ratios stay exactly as solved either way.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            {DRY_BATCH_SIZES_LB.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => onPickSize(size)}
                className="rounded-lg border-2 border-border bg-secondary/40 p-4 text-left transition-colors hover:border-primary/60 hover:bg-primary/5"
              >
                <p className="text-lg font-semibold text-foreground">{size} lb per bag</p>
                <p className="text-xs text-muted-foreground">
                  {size === 10
                    ? "A season for a small room — fits a single bucket per bag."
                    : "Bulk. Plan on a bag or bucket per part and somewhere dry to keep them."}
                </p>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

const BASE_BAG_STYLES = [
  { border: "border-primary/50", header: "bg-primary/5", icon: "text-primary" },
  { border: "border-accent/50", header: "bg-accent/5", icon: "text-accent" },
  {
    border: "border-muted-foreground/40",
    header: "bg-muted/40",
    icon: "text-muted-foreground",
  },
] as const

const CALCIUM_BAG_STYLE = {
  border: "border-sky-500/50",
  header: "bg-sky-500/10",
  icon: "text-sky-400",
} as const

export function DryBulkBatchCard({
  batch,
  useRateUnit,
  onUseRateUnitChange,
}: {
  batch: DryBulkBatch
  /**
   * Whether every bag quotes its use rate per gallon or per liter. Owned a
   * level up so it stays in step with the rest of the screen's unit toggles,
   * and so all the bags move together rather than one card at a time.
   */
  useRateUnit: VolumeUnit
  onUseRateUnitChange: (unit: VolumeUnit) => void
}) {
  let baseIndex = 0

  return (
    <div className="space-y-6">
      <div
        role="alert"
        className="flex items-start gap-3 rounded-lg border-2 border-amber-500/70 bg-amber-500/10 p-4"
      >
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
        <p className="text-sm font-bold leading-relaxed text-amber-100">{DRY_BATCH_DISCLAIMER}</p>
      </div>

      {batch.notes.map((note) => (
        <p
          key={note}
          className="rounded border border-border bg-secondary/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
        >
          {note}
        </p>
      ))}

      {batch.bags.map((bag) => {
        const style =
          bag.role === "calcium"
            ? CALCIUM_BAG_STYLE
            : BASE_BAG_STYLES[baseIndex++ % BASE_BAG_STYLES.length]
        return (
          <DryBagCard
            key={bag.letter}
            bag={bag}
            sizeLb={batch.sizeLb}
            style={style}
            useRateUnit={useRateUnit}
            onUseRateUnitChange={onUseRateUnitChange}
          />
        )
      })}

      <DryBatchInstructions />
    </div>
  )
}

function DryBagCard({
  bag,
  sizeLb,
  style,
  useRateUnit,
  onUseRateUnitChange,
}: {
  bag: DryBag
  sizeLb: DryBulkBatch["sizeLb"]
  style: { border: string; header: string; icon: string }
  useRateUnit: VolumeUnit
  onUseRateUnitChange: (unit: VolumeUnit) => void
}) {
  const description =
    bag.role === "calcium"
      ? "Do not ever mix dry calcium salts with phosphorous or magnesium"
      : bag.partName
        ? `The non-calcium salts your ${bag.partName} declared.`
        : null

  return (
    <Card className={`border-2 ${style.border} bg-card`}>
      <CardHeader className={style.header}>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-lg text-foreground">
          <span className="flex items-center gap-2">
            <Package className={`h-5 w-5 ${style.icon}`} />
            <span>
              Bag {bag.letter} — {bag.title}
            </span>
          </span>
          <span className="font-mono text-base font-semibold">{sizeLb} lb</span>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="pt-4">
        <div className="space-y-1.5">
          {bag.salts.map((salt) => (
            <div
              key={salt.key}
              className={`flex flex-wrap items-center justify-between gap-2 rounded px-3 py-2 ${
                salt.isMicro ? "bg-muted/30" : "bg-secondary/50"
              }`}
            >
              <div>
                <p
                  className={`font-medium text-foreground ${salt.isMicro ? "text-sm" : ""}`}
                >
                  {salt.name}
                </p>
                <p className="font-mono text-xs text-muted-foreground">{salt.formula}</p>
              </div>
              <p className="font-mono font-semibold text-foreground">
                {formatBagGrams(salt.grams)}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Blend className={`h-4 w-4 ${style.icon}`} />
              How much of Bag {bag.letter} to use
            </p>
            <div className="flex shrink-0 overflow-hidden rounded-lg border-2 border-border">
              <button
                type="button"
                onClick={() => onUseRateUnitChange("gallons")}
                aria-pressed={useRateUnit === "gallons"}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  useRateUnit === "gallons"
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:bg-secondary/80"
                }`}
              >
                Gallons
              </button>
              <button
                type="button"
                onClick={() => onUseRateUnitChange("liters")}
                aria-pressed={useRateUnit === "liters"}
                className={`border-l-2 border-border px-3 py-1 text-xs font-medium transition-colors ${
                  useRateUnit === "liters"
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:bg-secondary/80"
                }`}
              >
                Liters
              </button>
            </div>
          </div>
          <p className="mt-1 font-mono text-sm text-foreground">
            {useRateUnit === "liters"
              ? `${formatUseRateGrams(bag.gramsPerLiterOfWater)} per liter`
              : `${formatUseRateGrams(bag.gramsPerGallonOfWater)} per gallon`}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Automatically scales to the estimated EC or target EC if adjusted.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function DryBatchInstructions() {
  return (
    <Card className="border-2 border-border bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl text-foreground">
          <Sparkles className="h-5 w-5 text-primary" />
          <span>How to Blend These Bags</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="space-y-4">
          <Step n={1} title="Consider stock tanks first">
            <p>{DRY_BATCH_DISCLAIMER}</p>
          </Step>

          <Step n={2} title="Weigh every salt accurately">
            <p>
              Use a precise scale that measures to .01, ensure that you are weighing on a level
              surface in a room without any air movement as this can affect the scales accuracy.
              Gallon size bags work well for weighing out batches of salts.
            </p>
          </Step>

          <Step n={3} title="Premix the micronutrients — don't skip this">
            <p>
              Your micronutrients need to be blended in evenly through the dry mix to ensure
              correct dosing, the best way to do this is to mix them into one of your larger weight
              salts that also goes into the same part, mixing them together in a bag before adding
              them in with everything else is an easy way to ensure this.
            </p>
          </Step>

          <Step n={4} title="Mix each bag in its own clean, dry bucket">
            <p>
              Ensure the bucket you are adding your salts into to blend them together is clean and
              completely dry, moisture will cake up the blend. Seal the lid and then roll and
              tumble the bucket end over end for several minutes, you can also stir it through with
              a clean dry tool but I would still recommend rolling and tumbling as well to ensure
              is mixed well. Allow the bucket to rest so the fine salts settle downward and then
              mix it again to ensure everything is fully mixed. Scoops from the top to the bottom
              should look identical.
            </p>
          </Step>

          <Step n={5} title="Never combine calcium with phosphorus or magnesium in concentrate">
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg border-2 border-destructive/70 bg-destructive/10 p-3"
            >
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <p className="text-sm font-semibold leading-relaxed text-destructive">
                Never mix calcium with phosphorous or magnesium in concentrate form (In this dry
                mix or in stock tank concentrate). They need to stay separate until you are adding
                them to a batch tank or they will clump up and the nutrients will become
                unavailable to the plants.
              </p>
            </div>
          </Step>

          <Step n={6} title="Store it airtight, dry and labeled">
            <p>Label each part and store it out of high humidity and light</p>
          </Step>
        </ol>
      </CardContent>
    </Card>
  )
}

function Step({
  n,
  title,
  children,
}: {
  n: number
  title: string
  children: React.ReactNode
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-sm font-semibold text-primary">
        {n}
      </span>
      <div className="space-y-1.5">
        <p className="font-semibold text-foreground">{title}</p>
        <div className="space-y-1.5 text-sm leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </li>
  )
}
