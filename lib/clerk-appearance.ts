import { dark } from '@clerk/themes'

// Deliberately unannotated: the installed Clerk packages don't publish the
// `Appearance` type under any public entry point, so this is checked against
// `ClerkProvider`'s own `appearance` prop where it's passed in `app/layout.tsx`.
export const clerkAppearance = {
  baseTheme: dark,
  variables: {
    colorPrimary: '#10b981',
    colorBackground: '#0a0a0a',
    colorInputBackground: '#1f2937',
    colorText: '#e5e7eb',
    colorTextSecondary: '#9ca3af',
    colorInputText: '#e5e7eb',
    colorNeutral: '#374151',
    borderRadius: '0.5rem',
  },
}
