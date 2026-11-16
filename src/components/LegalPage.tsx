import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { LEGAL, type LegalDoc } from "@/lib/legal";
import { FolioMark } from "@/components/icons";

/**
 * Renders a legal document.
 *
 * These pages are the one place in the app that scrolls, because the text has
 * to be complete to mean anything. They share the app's colours and type so a
 * student who follows a link from the sidebar does not feel handed off to
 * another site, and they carry no scripts, so they cost nothing to serve.
 */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  const other = doc.slug === "terms" ? { href: "/privacy", label: "Privacy Policy" } : { href: "/terms", label: "Terms of Service" };

  return (
    <main className="legal-shell">
      <div className="legal-page">
        <header className="legal-head">
          <Link href="/" className="legal-back">
            <FolioMark className="h-4 w-4" />
            <span>{BRAND.wordmark}</span>
          </Link>
          <h1>{doc.title}</h1>
          <p className="legal-summary">{doc.summary}</p>
          <p className="legal-updated">Last updated {LEGAL.updated}</p>
        </header>

        {doc.sections.map((section) => (
          <section key={section.heading} className="legal-section">
            <h2>{section.heading}</h2>
            {section.paragraphs?.map((text) => (
              <p key={text}>{text}</p>
            ))}
            {section.bullets && (
              <ul>
                {section.bullets.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            )}
          </section>
        ))}

        <footer className="legal-foot">
          <Link href={other.href}>{other.label}</Link>
          <span aria-hidden>·</span>
          <Link href="/">{BRAND.name}</Link>
        </footer>
      </div>
    </main>
  );
}
