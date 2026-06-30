import Link from 'next/link'
import { Lock, Sprout } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LOST_ART_PRICING_URL } from '@/lib/subscription'

interface CalculatorPaywallProps {
  isSignedIn: boolean
}

export function CalculatorPaywall({ isSignedIn }: CalculatorPaywallProps) {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen max-w-lg items-center px-4 py-8 sm:px-6">
        <Card className="w-full border-2 border-border bg-card shadow-lg shadow-black/20">
          <CardHeader className="space-y-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
              <Lock className="h-7 w-7 text-primary" />
            </div>
            <div className="space-y-2">
              <CardTitle className="text-2xl text-foreground">
                Subscriber Access Required
              </CardTitle>
              <CardDescription className="text-base leading-relaxed text-muted-foreground">
                HydroCalc is available exclusively to paid subscribers of{' '}
                <span className="font-medium text-foreground">Lost Art of Growing</span>.
                Upgrade your membership to replicate nutrient formulas, build stock tank recipes,
                and generate shopping lists.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-border bg-secondary/40 p-4">
              <div className="flex items-start gap-3">
                <Sprout className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {isSignedIn
                    ? 'Your account is signed in, but this calculator is not included in your current plan. Subscribe or upgrade to unlock full access.'
                    : 'Sign in with your Lost Art of Growing account, or subscribe to get calculator access.'}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild className="flex-1">
                <a href={LOST_ART_PRICING_URL} target="_blank" rel="noopener noreferrer">
                  View Pricing Plans
                </a>
              </Button>
              {!isSignedIn && (
                <Button asChild variant="outline" className="flex-1">
                  <Link href="/sign-in">Sign In</Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
