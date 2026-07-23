/**
 * Client-safe data layer for the Feeding Scheduler.
 *
 * `FeedingScheduleEntry` mirrors the type of the same name defined on the
 * main site, so entries written here can be read back by that site without
 * any transformation.
 *
 * Persistence strategy:
 *  - Signed-in users: entries live in the main site's Supabase-backed store,
 *    read/written through the Server Action in `app/actions/feeding-schedule.ts`
 *    (which resolves the Clerk session server-side via `auth()` and calls
 *    the main site's API — entries are no longer written to Clerk
 *    `publicMetadata`, since the full tank breakdown per entry quickly
 *    exceeds Clerk's 8KB metadata limit).
 *  - Signed-out users (or if the main-site round-trip fails for any reason):
 *    entries fall back to localStorage so the feature still works offline /
 *    without an account.
 *
 * Callers (e.g. `recipe-screen.tsx`) don't need to know which backend is in
 * play — `addFeedingScheduleEntry`, `getFeedingScheduleEntries`, and
 * `deleteFeedingScheduleEntry` handle the routing/fallback internally.
 */

import {
  addFeedingScheduleEntryAction,
  deleteFeedingScheduleEntryAction,
  getFeedingScheduleEntriesAction,
} from "@/app/actions/feeding-schedule"
import type { FormulationDirectAddCalciumCarbonate, FormulationTank } from "./formulation-export"

export type FeedingStage = "Vegetative" | "Flowering"

export const STAGE_WEEK_COUNT: Record<FeedingStage, number> = {
  Vegetative: 8,
  Flowering: 10,
}

/**
 * Matches the `FeedingScheduleEntry` type defined on the main site.
 *
 * The Feeding Scheduler's import parser reads `tanks`/`usageRates`/
 * `defaultStockTankSize`/`targetEC`/`dilutionRatio` to render real tank
 * cards — without them it falls back to a dummy "starter tank". These
 * fields are optional here only for backward compatibility with entries
 * saved before this data was captured.
 */
export interface FeedingScheduleEntry {
  id: string
  recipeName: string
  /** Links back to a saved formulation on the main site/dashboard, if any */
  formulationId?: string
  stage: FeedingStage
  /** Sorted, de-duplicated week numbers (1-indexed) within the stage's range */
  weeks: number[]
  notes?: string
  createdAt: string
  /** Estimated reservoir EC (mS/cm) this recipe was tuned to */
  targetEC?: number
  /** Stock tank dilution/injector ratio (the "N" in 1:N) */
  dilutionRatio?: number
  /** Default stock tank size, in gallons */
  defaultStockTankSize?: number
  /** mL of each stock tank to use per gallon of reservoir water, keyed by tank id */
  usageRates?: Record<string, number>
  /** Full per-tank ingredient + mixing breakdown */
  tanks?: FormulationTank[]
  /**
   * Calcium Carbonate never lands in a stock tank (see `calculateStockTankRecipe`
   * on the calculator side) — when the recipe uses it, this is the dosing rate
   * to add directly to the reservoir/batch tank, which the Usage Rates tab's
   * "Dry Inputs" section reads. Omitted entirely when the recipe doesn't use it.
   */
  directAddCalciumCarbonate?: FormulationDirectAddCalciumCarbonate
}

const STORAGE_KEY = "hydro-calc:feeding-schedule-entries"

function normalizeWeeks(weeks: number[]): number[] {
  return Array.from(new Set(weeks)).sort((a, b) => a - b)
}

function readLocalStore(): FeedingScheduleEntry[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeLocalStore(entries: FeedingScheduleEntry[]) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Storage can fail (quota, privacy mode, etc.) — scheduler is best-effort for now.
  }
}

/** Fetches every saved entry, preferring the main site's store when the user is signed in. */
export async function getFeedingScheduleEntries(): Promise<FeedingScheduleEntry[]> {
  try {
    const result = await getFeedingScheduleEntriesAction()
    if (result.ok) return result.entries
  } catch (err) {
    console.error("Failed to load feeding schedule entries from main site:", err)
  }

  return readLocalStore()
}

export async function addFeedingScheduleEntry(
  input: Omit<FeedingScheduleEntry, "id" | "createdAt">
): Promise<FeedingScheduleEntry> {
  const entry: FeedingScheduleEntry = {
    ...input,
    weeks: normalizeWeeks(input.weeks),
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }

  let savedToMainSite = false
  try {
    const result = await addFeedingScheduleEntryAction(entry)
    savedToMainSite = result.ok
  } catch (err) {
    console.error("Failed to save feeding schedule entry to main site:", err)
  }

  // Not signed in, or the main-site round-trip failed — keep the entry
  // locally so it isn't lost.
  if (!savedToMainSite) {
    const entries = readLocalStore()
    entries.push(entry)
    writeLocalStore(entries)
  }

  return entry
}

export async function deleteFeedingScheduleEntry(id: string): Promise<void> {
  let deletedFromMainSite = false
  try {
    const result = await deleteFeedingScheduleEntryAction(id)
    deletedFromMainSite = result.ok
  } catch (err) {
    console.error("Failed to delete feeding schedule entry from main site:", err)
  }

  if (!deletedFromMainSite) {
    writeLocalStore(readLocalStore().filter((entry) => entry.id !== id))
  }
}

/** Formats a sorted week list as compact ranges, e.g. [1,2,3,5] -> "Weeks 1-3, 5" */
export function formatWeekRanges(weeks: number[]): string {
  if (weeks.length === 0) return "No weeks selected"

  const sorted = normalizeWeeks(weeks)
  const ranges: string[] = []
  let start = sorted[0]
  let prev = sorted[0]

  for (let i = 1; i <= sorted.length; i++) {
    const current = sorted[i]
    if (current === prev + 1) {
      prev = current
      continue
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`)
    if (current !== undefined) {
      start = current
      prev = current
    }
  }

  const label = ranges.length === 1 && !ranges[0].includes("-") ? "Week" : "Weeks"
  return `${label} ${ranges.join(", ")}`
}
