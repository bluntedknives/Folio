import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { BRAND } from "@/lib/brand";
import { TERMS } from "@/lib/legal";

export const metadata: Metadata = {
  title: `Terms of Service · ${BRAND.name}`,
  description: TERMS.summary,
};

export default function TermsRoute() {
  return <LegalPage doc={TERMS} />;
}
