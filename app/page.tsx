import { auth, currentUser } from '@clerk/nextjs/server'
import { CalculatorPaywall } from '@/components/hydro-calc/calculator-paywall'
import { HydroCalcPage } from '@/components/hydro-calc/hydro-calc-page'
import { hasCalculatorSubscription } from '@/lib/subscription'

export default async function Page() {
  const { userId } = await auth()

  if (!userId) {
    return <CalculatorPaywall isSignedIn={false} />
  }

  const user = await currentUser()
  const hasAccess = hasCalculatorSubscription(user?.publicMetadata)

  if (!hasAccess) {
    return <CalculatorPaywall isSignedIn={true} />
  }

  return <HydroCalcPage />
}
