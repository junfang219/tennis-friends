import { notFound } from "next/navigation";
import RegistrationOnboarding from "@/components/groups/RegistrationOnboarding";

export default function OnboardingPreviewPage() {
  if (process.env.NODE_ENV !== "development" || process.env.TEAM_ONBOARDING_REVIEW !== "1") notFound();
  return <RegistrationOnboarding />;
}
