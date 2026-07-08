import { MainApp } from "@/components/app/main-app"
import { OnboardingApp } from "@/components/onboarding/onboarding-app"

function App() {
  if (window.location.hash === "#/setup") return <OnboardingApp />
  return <MainApp />
}

export { App }
