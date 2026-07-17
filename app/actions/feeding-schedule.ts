"use server"

/**
 * Server Action boundary for persisting Feeding Scheduler entries to Clerk.
 *
 * `publicMetadata` can only be written from the Backend API, so this is the
 * only sanctioned way for the browser to save/read/delete scheduler entries
 * for a signed-in user. `lib/hydro-calc/feeding-scheduler.ts` calls into
 * these actions and falls back to localStorage when the caller isn't signed
 * in (or the request fails for any reason).
 */

import { clerkClient, currentUser } from "@clerk/nextjs/server"
import type { FeedingScheduleEntry } from "@/lib/hydro-calc/feeding-scheduler"

const METADATA_KEY = "feedingSchedules"

export type FeedingScheduleActionResult =
  | { ok: true; entries: FeedingScheduleEntry[] }
  | { ok: false; reason: "unauthenticated" | "error" }

function readEntriesFromMetadata(publicMetadata: unknown): FeedingScheduleEntry[] {
  if (!publicMetadata || typeof publicMetadata !== "object") return []
  const raw = (publicMetadata as Record<string, unknown>)[METADATA_KEY]
  return Array.isArray(raw) ? (raw as FeedingScheduleEntry[]) : []
}

async function writeEntriesToMetadata(userId: string, entries: FeedingScheduleEntry[]): Promise<void> {
  const client = await clerkClient()
  await client.users.updateUserMetadata(userId, {
    publicMetadata: { [METADATA_KEY]: entries },
  })
}

export async function getFeedingScheduleEntriesAction(): Promise<FeedingScheduleActionResult> {
  const user = await currentUser()
  if (!user) return { ok: false, reason: "unauthenticated" }

  try {
    return { ok: true, entries: readEntriesFromMetadata(user.publicMetadata) }
  } catch (err) {
    console.error("Failed to read feeding schedule entries from Clerk:", err)
    return { ok: false, reason: "error" }
  }
}

export async function addFeedingScheduleEntryAction(
  entry: FeedingScheduleEntry
): Promise<FeedingScheduleActionResult> {
  const user = await currentUser()
  if (!user) return { ok: false, reason: "unauthenticated" }

  try {
    const entries = [...readEntriesFromMetadata(user.publicMetadata), entry]
    await writeEntriesToMetadata(user.id, entries)
    return { ok: true, entries }
  } catch (err) {
    console.error("Failed to save feeding schedule entry to Clerk:", err)
    return { ok: false, reason: "error" }
  }
}

export async function deleteFeedingScheduleEntryAction(
  id: string
): Promise<FeedingScheduleActionResult> {
  const user = await currentUser()
  if (!user) return { ok: false, reason: "unauthenticated" }

  try {
    const entries = readEntriesFromMetadata(user.publicMetadata).filter((entry) => entry.id !== id)
    await writeEntriesToMetadata(user.id, entries)
    return { ok: true, entries }
  } catch (err) {
    console.error("Failed to delete feeding schedule entry from Clerk:", err)
    return { ok: false, reason: "error" }
  }
}
