export type ShareCardTheme = "dark" | "light"

export type ThemeStyle = {
  frame: string
  bg: string
  text: string
  subtext: string
  track: string
  border: string
}

export const THEME_STYLES: Record<ShareCardTheme, ThemeStyle> = {
  dark: {
    frame: "bg-neutral-900",
    bg: "bg-neutral-950",
    text: "text-white",
    subtext: "text-white/60",
    track: "bg-white/10",
    border: "border-white/10",
  },
  light: {
    frame: "bg-neutral-100",
    bg: "bg-white",
    text: "text-neutral-900",
    subtext: "text-neutral-500",
    track: "bg-black/10",
    border: "border-black/10",
  },
}
