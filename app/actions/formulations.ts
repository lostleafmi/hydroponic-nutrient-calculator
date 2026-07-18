"use server"

/**
 * Server Action boundary for saving a formulation to the main site's
 * dashboard (Supabase-backed). Runs server-side so the signed-in user's ID
 * comes straight from Clerk's verified session via `auth()` — the browser
 * never gets a chance to spoof it — and the main site can additionally
 * verify the forwarded session token itself if it wants to.
 */

import { auth } from "@clerk/nextjs/server"

const MAIN_SITE_URL = process.env.MAIN_SITE_URL ?? "https://your-main-site.com"
const SAVE_FORMULATION_ENDPOINT = `${MAIN_SITE_URL.replace(/\/$/, "")}/api/formulations/save`

/**
 * Loose shape for now — this is whatever `recipe-screen.tsx` builds today
 * (name, nutrient targets, tanks, dilution ratio, etc). The main site's
 * Supabase-backed endpoint may expect a different shape once we test
 * against it; adjust the `body` below rather than this input type.
 */
export type FormulationSaveInput = Record<string, unknown>

export type SaveFormulationActionResult =
  | { ok: true; formulationId?: string }
  | { ok: false; reason: "unauthenticated" | "error"; message: string }

export async function saveFormulationToDashboardAction(
  formulation: FormulationSaveInput
): Promise<SaveFormulationActionResult> {
  const { userId, getToken } = await auth()

  if (!userId) {
    return {
      ok: false,
      reason: "unauthenticated",
      message: "You need to be signed in to save a formulation.",
    }
  }

  try {
    // Forwarded so the main site can independently verify this request came
    // from a real Clerk session, in addition to trusting `userId` below.
    const token = await getToken()

    const res = await fetch(SAVE_FORMULATION_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ userId, formulation }),
      cache: "no-store",
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => "")
      return {
        ok: false,
        reason: "error",
        message: errBody || `Main site responded with ${res.status}`,
      }
    }

    const data = (await res.json().catch(() => null)) as { id?: string; formulationId?: string } | null
    return { ok: true, formulationId: data?.id ?? data?.formulationId }
  } catch (err) {
    console.error("Failed to save formulation to main site dashboard:", err)
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "Couldn't reach the main site. Please try again.",
    }
  }
}
