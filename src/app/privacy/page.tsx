import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { BRAND } from "@/lib/brand";
import { PRIVACY } from "@/lib/legal";

export const metadata: Metadata = {
  title: `Privacy Policy · ${BRAND.name}`,
  description: PRIVACY.summary,
};

export default function PrivacyRoute() {
  return <LegalPage doc={PRIVACY} />;
}
