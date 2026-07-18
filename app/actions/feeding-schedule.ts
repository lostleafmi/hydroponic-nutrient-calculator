"use server"

/**
 * Server Action boundary for persisting Feeding Scheduler entries.
 *
 * This used to write the *entire* entries array to Clerk `publicMetadata`
 * on every save. That doesn't scale: each entry can embed a full per-tank
 * salt + mixing-instruction breakdown, so a handful of saved recipes is
 * enough to exceed Clerk's 8KB `publicMetadata` cap
 * (`form_param_exceeds_allowed_size`).
 *
 * Entries now live in the main site's Supabase-backed store instead — the
 * same approach used for formulations in `app/actions/formulations.ts`.
 * `userId` still comes from the verified Clerk session via `auth()`, and the
 * session token is forwarded so the main site can independently verify the
 * caller. `lib/hydro-calc/feeding-scheduler.ts` calls into these actions and
 * falls back to localStorage when the caller isn't signed in (or the
 * request fails for any reason), unchanged.
 */

import { auth } from "@clerk/nextjs/server"
import type { FeedingScheduleEntry } from "@/lib/hydro-calc/feeding-scheduler"

const MAIN_SITE_URL = process.env.MAIN_SITE_URL ?? "https://your-main-site.com"
const FEEDING_SCHEDULE_ENDPOINT = `${MAIN_SITE_URL.replace(/\/$/, "")}/api/feeding-schedule`

export type FeedingScheduleActionResult =
  | { ok: true; entries: FeedingScheduleEntry[] }
  | { ok: false; reason: "unauthenticated" | "error" }

/**
 * Response shape is provisional — the main site's endpoint may end up
 * returning something slightly different once we test against it. Adjust
 * the parsing below rather than the exported action signatures.
 */
type FeedingScheduleApiResponse = { entries?: FeedingScheduleEntry[] }

async function callFeedingScheduleApi(
  path: string,
  init: RequestInit,
  token: string | null
): Promise<FeedingScheduleApiResponse> {
  const res = await fetch(`${FEEDING_SCHEDULE_ENDPOINT}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: "no-store",
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => "")
    throw new Error(errBody || `Main site responded with ${res.status}`)
  }

  return (await res.json().catch(() => ({}))) as FeedingScheduleApiResponse
}

export async function getFeedingScheduleEntriesAction(): Promise<FeedingScheduleActionResult> {
  const { userId, getToken } = await auth()
  if (!userId) return { ok: false, reason: "unauthenticated" }

  try {
    const token = await getToken()
    const data = await callFeedingScheduleApi(
      `?userId=${encodeURIComponent(userId)}`,
      { method: "GET" },
      token
    )
    return { ok: true, entries: data.entries ?? [] }
  } catch (err) {
    console.error("Failed to load feeding schedule entries from main site:", err)
    return { ok: false, reason: "error" }
  }
}

export async function addFeedingScheduleEntryAction(
  entry: FeedingScheduleEntry
): Promise<FeedingScheduleActionResult> {
  const { userId, getToken } = await auth()
  if (!userId) return { ok: false, reason: "unauthenticated" }

  try {
    const token = await getToken()
    const data = await callFeedingScheduleApi(
      "",
      { method: "POST", body: JSON.stringify({ userId, entry }) },
      token
    )
    return { ok: true, entries: data.entries ?? [entry] }
  } catch (err) {
    console.error("Failed to save feeding schedule entry to main site:", err)
    return { ok: false, reason: "error" }
  }
}

export async function deleteFeedingScheduleEntryAction(
  id: string
): Promise<FeedingScheduleActionResult> {
  const { userId, getToken } = await auth()
  if (!userId) return { ok: false, reason: "unauthenticated" }

  try {
    const token = await getToken()
    const data = await callFeedingScheduleApi(
      `/${encodeURIComponent(id)}`,
      { method: "DELETE", body: JSON.stringify({ userId }) },
      token
    )
    return { ok: true, entries: data.entries ?? [] }
  } catch (err) {
    console.error("Failed to delete feeding schedule entry from main site:", err)
    return { ok: false, reason: "error" }
  }
}
