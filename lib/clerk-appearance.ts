import { dark } from '@clerk/themes'
import type { Appearance } from '@clerk/types'

export const clerkAppearance: Appearance = {
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
