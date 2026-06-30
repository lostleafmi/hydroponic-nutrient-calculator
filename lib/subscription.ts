export type SubscriptionPublicMetadata = {
  hasCalculatorAccess?: boolean
  hasFullAccess?: boolean
}

export const LOST_ART_PRICING_URL =
  process.env.NEXT_PUBLIC_PRICING_URL ?? 'https://your-main-site.com/pricing'

export function hasCalculatorSubscription(
  publicMetadata: SubscriptionPublicMetadata | null | undefined
): boolean {
  if (!publicMetadata) return false

  return (
    publicMetadata.hasCalculatorAccess === true ||
    publicMetadata.hasFullAccess === true
  )
}
