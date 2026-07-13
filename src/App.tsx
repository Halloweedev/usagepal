import { MainApp } from "@/components/app/main-app"
import { OnboardingApp } from "@/components/onboarding/onboarding-app"
import { WhatsNewApp } from "@/components/whats-new/whats-new-app"

function App() {
  const hash = window.location.hash
  if (hash === "#/setup") return <OnboardingApp />
  if (hash === "#/whats-new") return <WhatsNewApp />
  return <MainApp />
}

export { App }
