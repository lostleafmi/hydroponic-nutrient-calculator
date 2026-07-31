"use client"

/**
 * The Direct Mix recipe as a bag of dry powder instead of a reservoir dose.
 *
 * Presentation only: every gram shown here is the solver's own Direct Mix
 * amount, rescaled by one factor and filed into a bag (see
 * `lib/hydro-calc/dry-batch.ts`). Nothing on this screen can change an
 * elemental target or a salt amount, which is why it's offered as an alternate
 * view of the direct-mix list rather than as another tank layout.
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
  DRY_BATCH_USE_RATE_LITERS,
  formatBagGrams,
  formatBagOunces,
  formatBagPercent,
  formatBagPounds,
  formatUseRateGrams,
  type DryBag,
  type DryBatchSizeLb,
  type DryBulkBatch,
} from "@/lib/hydro-calc/dry-batch"
import { RAW_SALTS } from "@/lib/hydro-calc/recipe-types"

/**
 * The one thing this whole screen has to say before anything else. Kept as a
 * constant because it's repeated in shortened form as step 1 of the tutorial,
 * and the two must not drift apart.
 */
export const DRY_BATCH_DISCLAIMER =
  "Mixing dry inputs into stock tanks is the preferred method over this, dosing from stock " +
  "tanks ensures certainty that all of the macro and micronutrients will be dosed at the " +
  "correct amounts."

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
                  : `Mixing a ${sizeLb} lb dry batch`}
              </p>
              <p className="text-sm text-muted-foreground">
                {sizeLb === null
                  ? "Same recipe, scaled up and split into bags that are safe to store together, so you can blend it once and scoop from it later."
                  : "Showing the bagged dry blend below instead of the per-reservoir salt list."}
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
            <DialogTitle>How big a batch?</DialogTitle>
            <DialogDescription>
              This is the total dry weight of all bags added together — the recipe&apos;s ratios
              stay exactly as solved either way.
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
                <p className="text-lg font-semibold text-foreground">{size} lb</p>
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

export function DryBulkBatchCard({ batch }: { batch: DryBulkBatch }) {
  const microBag = batch.bags.find((bag) => bag.holdsMicronutrients) ?? null
  const calciumBag = batch.bags.find((bag) => bag.role === "calcium") ?? null

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

      <Card className="border-2 border-border bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl text-foreground">
            <Package className="h-5 w-5 text-primary" />
            <span>
              {batch.sizeLb} lb Dry Batch — {batch.bags.length}{" "}
              {batch.bags.length === 1 ? "bag" : "bags"}
            </span>
          </CardTitle>
          <CardDescription>
            {batch.splitBasis === "per-part"
              ? "One bag per part of your original analysis, with every calcium salt pulled into a bag of its own."
              : "Split into a base bag and a calcium bag, because calcium can never be pre-blended with phosphorus or magnesium."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryTile
              label="Total dry weight"
              value={`${batch.sizeLb} lb`}
              sub={`${batch.totalGrams.toFixed(0)} g across all bags`}
            />
            <SummaryTile
              label="Bags to keep separate"
              value={String(batch.bags.length)}
              sub={
                calciumBag
                  ? `Bag ${calciumBag.letter} is calcium — never pre-blend it with the rest`
                  : "No calcium salt in this recipe"
              }
            />
            <SummaryTile
              label="Treats about"
              value={`${Math.round(batch.treatsGallons).toLocaleString()} gal`}
              sub={`${Math.round(batch.treatsLiters).toLocaleString()} L of irrigation water at this feed strength`}
            />
          </div>

          {batch.notes.map((note) => (
            <p
              key={note}
              className="rounded border border-border bg-secondary/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
            >
              {note}
            </p>
          ))}
        </CardContent>
      </Card>

      {batch.bags.map((bag) => {
        const style =
          bag.role === "calcium"
            ? CALCIUM_BAG_STYLE
            : BASE_BAG_STYLES[baseIndex++ % BASE_BAG_STYLES.length]
        return <DryBagCard key={bag.letter} bag={bag} style={style} />
      })}

      <DryBatchInstructions batch={batch} microBag={microBag} calciumBag={calciumBag} />
    </div>
  )
}

function SummaryTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="font-mono text-lg font-semibold text-foreground">{value}</p>
      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{sub}</p>
    </div>
  )
}

function DryBagCard({
  bag,
  style,
}: {
  bag: DryBag
  style: { border: string; header: string; icon: string }
}) {
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
          <span className="font-mono text-base font-semibold">
            {formatBagPounds(bag.totalPounds)} ({formatBagGrams(bag.totalGrams)})
          </span>
        </CardTitle>
        <CardDescription>
          {bag.role === "calcium"
            ? "Calcium salts only. This bag stays sealed and separate — it never gets pre-blended with, or dissolved alongside, the phosphorus and magnesium in the other bags."
            : bag.partName
              ? `The non-calcium salts your ${bag.partName} declared.`
              : "Everything that isn't a calcium source — potassium, phosphate, sulfate and magnesium salts."}
          {bag.holdsMicronutrients &&
            " Your whole micronutrient package is in here too, so it only has to be premixed once."}
        </CardDescription>
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
              <div className="text-right">
                <p className="font-mono font-semibold text-foreground">
                  {formatBagGrams(salt.grams)}
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    / {formatBagOunces(salt.ounces)}
                  </span>
                </p>
                <p className="font-mono text-xs text-muted-foreground">
                  {formatBagPercent(salt.percentOfBag)} of bag
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Blend className={`h-4 w-4 ${style.icon}`} />
            How much of Bag {bag.letter} to use
          </p>
          <p className="mt-1 font-mono text-sm text-foreground">
            {formatUseRateGrams(bag.gramsPerGallonOfWater)} per gallon
            <span className="text-muted-foreground"> · </span>
            {formatUseRateGrams(bag.gramsPerBatchUseRateLiters)} per {DRY_BATCH_USE_RATE_LITERS} L
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Of irrigation water, and unchanged by the batch size you picked — it&apos;s the same
            feed strength the per-reservoir recipe mixes to.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function DryBatchInstructions({
  batch,
  microBag,
  calciumBag,
}: {
  batch: DryBulkBatch
  microBag: DryBag | null
  calciumBag: DryBag | null
}) {
  const carrierName = microBag?.microCarrier ? RAW_SALTS[microBag.microCarrier].name : null
  const baseBagLetters = batch.bags
    .filter((bag) => bag.role === "base")
    .map((bag) => `Bag ${bag.letter}`)

  return (
    <Card className="border-2 border-border bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl text-foreground">
          <Sparkles className="h-5 w-5 text-primary" />
          <span>How to Blend These Bags</span>
        </CardTitle>
        <CardDescription>
          Work through these in order. Steps 3 and 5 are the two that actually decide whether the
          blend feeds evenly and safely.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="space-y-4">
          <Step n={1} title="Consider stock tanks first">
            <p>
              Dry blending is the fallback, not the goal. Dosing from stock tanks is the only way
              to be certain every macro and micronutrient lands at the amount this recipe solved
              for — a dry blend can only ever be as even as your mixing was.
            </p>
          </Step>

          <Step n={2} title="Weigh every salt accurately">
            <p>
              Macros to 0.1 g, micronutrients to 0.01 g if your scale resolves it. Weigh out of any
              draft or airflow — a fan is enough to move a 0.2 g micro reading. Zero the scale on
              your container before each salt.
            </p>
          </Step>

          <Step n={3} title="Premix the micronutrients — don't skip this">
            <p>
              The micros are a fraction of a percent of{" "}
              {microBag ? `Bag ${microBag.letter}` : "the bag"}, so tipping them straight into a
              full bucket leaves them in clumps and streaks. A scoop from the top of that bucket
              would then carry several times the iron a scoop from the bottom does.
            </p>
            <p>
              {carrierName && microBag?.microCarrierIsMacro ? (
                <>
                  Instead: set aside about a cup of the{" "}
                  <span className="font-semibold text-foreground">{carrierName}</span> already in
                  Bag {microBag.letter}. Mix all of the micros into that cup until the color is
                  completely uniform, then blend that premix into the rest of the bag.
                </>
              ) : carrierName ? (
                <>
                  Bag {microBag?.letter} is the micro package itself — there&apos;s no macro salt in
                  it to disperse them into, because every macro in this recipe is a calcium salt.
                  Premix one tier down instead: mix the smallest micros into the{" "}
                  <span className="font-semibold text-foreground">{carrierName}</span>, which is the
                  bulk of that bag, and only then combine the rest.
                </>
              ) : (
                <>
                  Instead: set aside about a cup of the largest macronutrient salt in that same bag
                  — potassium nitrate or MKP, whichever it holds. Mix all of the micros into that
                  cup until the color is completely uniform, then blend that premix into the rest
                  of the bag.
                </>
              )}
            </p>
            <p>
              Never premix micros into a salt from a different bag. Doing that moves weight across
              bags and breaks the split the safety rules depend on.
            </p>
          </Step>

          <Step n={4} title="Mix each bag in its own clean, dry bucket">
            <p>
              Add that bag&apos;s salts to a clean, completely dry bucket — a trace of moisture
              cakes the blend. Seal the lid, then roll and tumble the bucket end over end for
              several minutes, or stir it through with a clean dry tool.
            </p>
            <p>
              Let it rest a few minutes and repeat: the fines settle downward on the first pass, so
              a second round is usually what makes the blend actually uniform. It&apos;s ready when
              scoops from the top and the bottom look identical.
            </p>
          </Step>

          <Step n={5} title="Never combine calcium with phosphorus or magnesium in concentrate">
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg border-2 border-destructive/70 bg-destructive/10 p-3"
            >
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div className="space-y-1.5 text-sm font-semibold leading-relaxed text-destructive">
                <p>
                  Never mix calcium together with phosphorus or magnesium in concentrate form —
                  and that includes these dry pre-blends, which become a concentrate the instant
                  they meet water. Never dissolve them together in a small volume of water either.
                </p>
                <p>
                  {calciumBag
                    ? `Bag ${calciumBag.letter} and ${
                        baseBagLetters.length > 1
                          ? baseBagLetters.join(", ")
                          : (baseBagLetters[0] ?? "the base bag")
                      } stay separate`
                    : "The bags stay separate"}{" "}
                  until they&apos;re diluted into the full volume of irrigation water — added one
                  after the other, stirring between each, never poured together first and never
                  pre-dissolved in the same jug.
                </p>
              </div>
            </div>
          </Step>

          <Step n={6} title="Store it airtight, dry and labeled">
            <p>
              Airtight container, out of humidity and sunlight. Label each one with the bag name
              (e.g. &ldquo;Bag {batch.bags[0]?.letter ?? "A"} — {batch.bags[0]?.title ?? "Base"}
              &rdquo;), the date you blended it, and its use rate in grams per gallon straight off
              the card above. An unlabeled bucket of white powder is indistinguishable from every
              other bucket of white powder six months later.
            </p>
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
