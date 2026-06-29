import { useAppLicenseStore } from "@/stores/app-license-store"

/**
 * Reactive entitlement gate. Returns true when the active license includes the
 * given feature. This is the seam any future supporter-only feature reads from.
 */
export function useEntitlement(name: string): boolean {
  return useAppLicenseStore((state) => state.entitlements[name] ?? false)
}
