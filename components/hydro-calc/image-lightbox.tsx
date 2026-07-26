"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch"
import { X, ZoomIn } from "lucide-react"

interface ImageLightboxProps {
  src?: string
  alt: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Full-screen, pinch-to-zoom/pan image viewer for reading small print (e.g.
 * a fertilizer label's Guaranteed Analysis) on any device. Built on
 * react-zoom-pan-pinch so two-finger pinch/pan on mobile and wheel/drag on
 * desktop behave consistently across iOS Safari, Android Chrome, and desktop
 * browsers (native double-finger browser zoom is unreliable to control and
 * reset once a modal is involved).
 */
export function ImageLightbox({ src, alt, open, onOpenChange }: ImageLightboxProps) {
  const [mounted, setMounted] = useState(false)
  const [showHint, setShowHint] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return

    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    setShowHint(true)
    const hintTimer = setTimeout(() => setShowHint(false), 2800)

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false)
    }
    window.addEventListener("keydown", handleKeyDown)

    return () => {
      document.body.style.overflow = originalOverflow
      window.removeEventListener("keydown", handleKeyDown)
      clearTimeout(hintTimer)
    }
  }, [open, onOpenChange])

  if (!mounted || !open || !src) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col overflow-hidden overscroll-none bg-black/95 backdrop-blur-sm animate-in fade-in-0 duration-200"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      {/* Close button — large, easy to tap, top-right */}
      <button
        type="button"
        onClick={() => onOpenChange(false)}
        aria-label="Close image viewer"
        className="absolute right-3 top-3 z-[110] flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white shadow-lg backdrop-blur-sm transition hover:bg-white/20 active:scale-95 sm:right-6 sm:top-6"
      >
        <X className="h-6 w-6" />
      </button>

      {/* First-open hint */}
      <div
        className={`pointer-events-none absolute left-1/2 top-4 z-[110] -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-center text-sm font-medium text-white shadow-lg backdrop-blur-sm transition-opacity duration-500 sm:top-6 ${
          showHint ? "opacity-100" : "opacity-0"
        }`}
      >
        <span className="inline-flex items-center gap-1.5">
          <ZoomIn className="h-3.5 w-3.5" />
          Pinch or scroll to zoom, drag to pan
        </span>
      </div>

      <TransformWrapper
        initialScale={1}
        minScale={1}
        maxScale={5}
        centerOnInit
        centerZoomedOut
        doubleClick={{ mode: "toggle", step: 2.5 }}
        wheel={{ step: 0.15 }}
        pinch={{ step: 5 }}
        panning={{ velocityDisabled: true }}
      >
        <TransformComponent
          wrapperStyle={{ width: "100%", height: "100%" }}
          contentStyle={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <img
            src={src}
            alt={alt}
            className="max-h-[100dvh] max-w-[100vw] select-none object-contain animate-in zoom-in-95 duration-200"
            draggable={false}
          />
        </TransformComponent>
      </TransformWrapper>
    </div>,
    document.body,
  )
}
