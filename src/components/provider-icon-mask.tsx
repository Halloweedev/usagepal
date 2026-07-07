import { cn } from "@/lib/utils"
import { scaleProviderIconSize } from "@/lib/provider-icon-scale"

export type ProviderIconMaskProps = {
  iconUrl?: string
  pluginId?: string
  sizePx: number
  className?: string
  style?: React.CSSProperties
  fallbackClassName?: string
}

export function ProviderIconMask({
  iconUrl,
  pluginId,
  sizePx,
  className,
  style,
  fallbackClassName,
}: ProviderIconMaskProps) {
  const scaledSizePx = scaleProviderIconSize(sizePx, pluginId)

  if (iconUrl) {
    return (
      <div
        aria-hidden
        className={cn("shrink-0", className)}
        style={{
          width: `${scaledSizePx}px`,
          height: `${scaledSizePx}px`,
          WebkitMaskImage: `url(${iconUrl})`,
          WebkitMaskSize: "contain",
          WebkitMaskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          maskImage: `url(${iconUrl})`,
          maskSize: "contain",
          maskRepeat: "no-repeat",
          maskPosition: "center",
          ...style,
        }}
      />
    )
  }

  return (
    <svg
      aria-hidden
      viewBox="0 0 26 26"
      className={cn("shrink-0", fallbackClassName)}
      style={{ width: `${scaledSizePx}px`, height: `${scaledSizePx}px` }}
    >
      <circle cx="13" cy="13" r="9" fill="none" stroke="currentColor" strokeWidth="3.5" opacity={0.3} />
    </svg>
  )
}
