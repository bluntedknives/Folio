import Link from "next/link";
import { BRAND } from "@/lib/brand";

export default function NotFound() {
  return (
    <main className="legal-shell">
      <div className="legal-page">
        <h1>Nothing here</h1>
        <p className="legal-summary">
          That page does not exist. {BRAND.name} is a single screen, so the way back is short.
        </p>
        <footer className="legal-foot">
          <Link href="/">Back to {BRAND.name}</Link>
        </footer>
      </div>
    </main>
  );
}
