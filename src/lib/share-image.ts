import { toBlob } from "html-to-image"
import { writeImage } from "@tauri-apps/plugin-clipboard-manager"

const DEFAULT_PIXEL_RATIO = 4

/**
 * Rasterizes `node` to a PNG and writes it to the system clipboard as a raw
 * image (no data URL, no filesystem round-trip). `pixelRatio` controls export
 * resolution independent of the node's on-screen size.
 */
export async function copyCardImage(
  node: HTMLElement,
  options: { pixelRatio?: number } = {}
): Promise<void> {
  const blob = await toBlob(node, { pixelRatio: options.pixelRatio ?? DEFAULT_PIXEL_RATIO })
  if (!blob) {
    throw new Error("Failed to render share card to an image.")
  }
  const buffer = await blob.arrayBuffer()
  await writeImage(new Uint8Array(buffer))
}
