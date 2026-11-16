/**
 * The legal pages' text, kept apart from their presentation so the wording can
 * be reviewed on its own.
 *
 * Two things about this file are deliberate:
 *
 * 1. The text describes what the software actually does, matching the code
 *    (`src/app/api/chat/route.ts`, `src/lib/attachment.ts`, `src/lib/store.ts`).
 *    A policy that overstates the privacy is worse than none, because it is the
 *    kind of statement a regulator treats as a misrepresentation.
 *
 * 2. It is not legal advice. It is a competent starting draft that covers the
 *    usual ground for a free, no-account study tool. Entity names, a governing
 *    law and a contact address are placeholders that must be filled in, and a
 *    lawyer should read it before it is relied on.
 */

import { BRAND } from "./brand";

/** Placeholders that must be replaced before these pages are relied on. */
export const LEGAL = {
  /** Who operates the service. Replace with a real entity or your own name. */
  operator: "the Folio operator",
  /** Where disputes are governed. Replace with your jurisdiction. */
  jurisdiction: "the operator's principal place of business",
  /** How to reach the operator. Replace with a monitored address. */
  contact: "support@example.com",
  /** The date these documents last changed. */
  updated: "3 November 2026",
} as const;

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface LegalDoc {
  slug: "terms" | "privacy";
  title: string;
  summary: string;
  sections: LegalSection[];
}

export const TERMS: LegalDoc = {
  slug: "terms",
  title: "Terms of Service",
  summary: `The rules for using ${BRAND.name}. Please read them before you rely on an answer.`,
  sections: [
    {
      heading: "1. Agreeing to these terms",
      paragraphs: [
        `These terms are an agreement between you and ${LEGAL.operator} ("we", "us") for the use of ${BRAND.name} (the "Service"). By using the Service you accept them. If you do not accept them, do not use the Service.`,
        "If you are under the age at which you can enter a contract where you live, a parent or guardian must agree to these terms for you.",
      ],
    },
    {
      heading: "2. What the Service is",
      paragraphs: [
        `${BRAND.name} is a study tool. It sends the questions and material you give it to a third-party AI model and shows you the reply, which may include worked steps, graphs, or code.`,
        "The Service is a study aid, not a substitute for teaching, and not a professional adviser of any kind.",
      ],
    },
    {
      heading: "3. Academic honesty",
      paragraphs: [
        "How you use the Service is between you and your school, college or university.",
        "You are responsible for knowing and following the rules that apply to you, including any rule about AI assistance, and for the consequences of breaking them. We do not know what your institution permits and we cannot advise you on it.",
      ],
    },
    {
      heading: "4. Answers can be wrong",
      paragraphs: [
        "AI models produce answers that are confidently stated and sometimes incorrect. They can make arithmetic errors, misread a photograph, invent a source, or apply the wrong method.",
        "We do not verify any answer. You must check anything you intend to rely on, and you must not rely on the Service for anything where an error would cause harm, loss, or damage.",
        "The Service is provided \"as is\" and \"as available\", without warranties of any kind, whether express or implied, including any implied warranty of merchantability, fitness for a particular purpose, accuracy, or non-infringement, to the fullest extent the law allows.",
      ],
    },
    {
      heading: "5. Limits on our liability",
      paragraphs: [
        "To the fullest extent the law allows, we are not liable for any indirect, incidental, special, consequential or punitive damages, or for any loss of marks, grades, data, profit, opportunity or goodwill, arising out of or relating to your use of the Service, whether based in contract, tort, negligence, strict liability or otherwise, even if we were told such damage was possible.",
        "To the fullest extent the law allows, our total liability for all claims relating to the Service is limited to the greater of (a) the total amount you paid us for the Service in the twelve months before the claim, and (b) ten US dollars. Because the Service is free, this will usually be the latter.",
        "Nothing in these terms limits liability that cannot lawfully be limited, including for fraud, or for death or personal injury caused by negligence where that limitation is not permitted.",
        "Some jurisdictions do not allow certain exclusions or limitations. Where that is the case, the exclusions and limitations above apply only to the extent permitted, and nothing here affects rights you have that cannot be waived.",
      ],
    },
    {
      heading: "6. Your material, and what you may send",
      paragraphs: [
        "You keep whatever rights you have in the questions, images, documents, recordings and links you send (your \"content\"). You give us permission to process your content only as needed to run the Service for you: to send it to the model provider and return the reply.",
        "You confirm that you have the right to send your content, and that sending it does not break anyone's rights, including copyright and privacy.",
        "Do not send content you are not allowed to share, and do not use the Service to break the law, to harm anyone, to cheat in a way that breaks your institution's rules, or to attempt to disrupt or gain unauthorised access to the Service or to anyone else's systems.",
      ],
    },
    {
      heading: "7. The model provider",
      paragraphs: [
        "Answers are generated by a third-party AI model reached through NVIDIA's API. Your content is sent to that provider so it can produce the reply, and their terms and privacy practices also apply to that processing.",
        "We do not control the provider and are not responsible for their acts or omissions.",
      ],
    },
    {
      heading: "8. Availability and changes",
      paragraphs: [
        "The Service is free and may change, break, or be withdrawn at any time without notice. We do not promise any level of availability.",
        "We may change these terms. When we do, we will update the date at the top of this page. Continuing to use the Service after a change means you accept the changed terms.",
      ],
    },
    {
      heading: "9. Ending your use",
      paragraphs: [
        "You may stop using the Service at any time. There is no account to close and no data on our servers to delete; see the Privacy Policy for how to clear what is stored in your browser.",
        "We may block or withdraw access if we reasonably believe you have broken these terms.",
      ],
    },
    {
      heading: "10. General",
      paragraphs: [
        `These terms are governed by the laws of ${LEGAL.jurisdiction}, without regard to its conflict-of-law rules, and its courts have exclusive jurisdiction, except where the law gives you the right to sue where you live.`,
        "If a part of these terms is found unenforceable, the rest stays in force. Our not enforcing a term is not a waiver of it.",
        "These terms and the Privacy Policy are the whole agreement between us about the Service.",
      ],
    },
    {
      heading: "11. Contact",
      paragraphs: [`Questions about these terms can go to ${LEGAL.contact}.`],
    },
  ],
};

export const PRIVACY: LegalDoc = {
  slug: "privacy",
  title: "Privacy Policy",
  summary: `What ${BRAND.name} does with what you give it, in plain terms.`,
  sections: [
    {
      heading: "The short version",
      bullets: [
        "No account, no sign-up, no cookie banner, and no advertising or analytics trackers.",
        "Your chat history is stored in your own browser and is never uploaded to us.",
        "What you send is forwarded to the AI model provider so it can answer, and that is the only reason it leaves your device.",
        "Images have their metadata stripped before they are sent.",
      ],
    },
    {
      heading: "1. Who we are",
      paragraphs: [
        `This Service is operated by ${LEGAL.operator}. For privacy questions, write to ${LEGAL.contact}.`,
      ],
    },
    {
      heading: "2. What is stored, and where",
      paragraphs: [
        "The Service keeps your conversations in your browser's IndexedDB storage, on your device, under a local database name. They are there so the app can show your history when you come back.",
        "This history is not sent to us, and we cannot see it. Clearing your browser's site data removes it. Uninstalling or resetting the browser removes it. Nothing recovers it, because we never had a copy.",
        "The Service does not use cookies, advertising, or third-party analytics.",
      ],
    },
    {
      heading: "3. What is sent, and to whom",
      paragraphs: [
        "When you ask a question, the Service sends the following from our server to a third-party AI model reached through NVIDIA's API: your question, the recent turns of the conversation needed to answer it, and any image, document text, or audio clip you attached.",
        "This is necessary to produce the answer. The provider processes it under their own terms and privacy policy. We do not control how the provider retains or uses it.",
        "Our server does not keep a copy of your questions or the answers. It passes them through and returns the reply.",
      ],
    },
    {
      heading: "4. Metadata in images",
      paragraphs: [
        "When you attach a photo, the Service re-encodes it through a canvas before sending. Only decoded pixels pass through that step, so EXIF, GPS coordinates, camera details, timestamps and other embedded metadata are dropped and never leave your device.",
        "This is deliberate: a photo of homework often carries the location where it was taken.",
      ],
    },
    {
      heading: "5. Links, searches and videos",
      paragraphs: [
        "If you link a web page, the Service fetches that page from our server and sends its readable text to the model. The page's operator will see a request from our server, as they would for any visit.",
        "If your question needs current information, the Service may run a web search through a search provider or Wikipedia and send the results to the model.",
        "If you link a video, the Service fetches the video's public metadata and a few still frames. It does not download the audio or a transcript.",
      ],
    },
    {
      heading: "6. Screen sharing and study mode",
      paragraphs: [
        "Study mode reads what you choose to share only while you are sharing it, and only to answer your questions. Frames are sent to the model as images, in the same way an attached photo is.",
        "If you turn on audio, a short clip is sent with your next question. It is not transcribed or stored by us.",
        "You can stop sharing at any time using the browser's own sharing control, which ends the capture immediately.",
      ],
    },
    {
      heading: "7. Legal bases, if you are in the EEA or UK",
      paragraphs: [
        "Where the GDPR applies, we rely on your consent for sending your content to the model provider, which you give by choosing to ask a question, and on our legitimate interest in operating and securing the Service.",
        "The model provider may process your content outside your country, including in the United States.",
      ],
    },
    {
      heading: "8. Your rights",
      paragraphs: [
        "Depending on where you live, you may have rights to access, correct, delete, or port your personal data, to object to or restrict its processing, and to complain to a supervisory authority.",
        "In practice, most of this is in your hands: because history lives only in your browser, clearing the site data deletes it, and we hold nothing to disclose, correct or delete.",
        "Where your content has already been sent to the model provider, requests about their copy should go to them.",
      ],
    },
    {
      heading: "9. Children",
      paragraphs: [
        "The Service is a study tool and may be used by students. It is not directed at children under 13, and we do not knowingly collect personal data from them. There is no account, so we hold no personal data about any user.",
        "If you are a parent or guardian and have a concern, write to us at the address above.",
      ],
    },
    {
      heading: "10. Security",
      paragraphs: [
        "Your content is sent over an encrypted connection. The API key that reaches the model provider is held on the server and is never sent to your browser.",
        "No system is perfectly secure, and we cannot promise that the Service will never be breached. Do not send anything you would not be comfortable having processed by a third-party AI provider.",
      ],
    },
    {
      heading: "11. Changes",
      paragraphs: [
        `If this policy changes, the date at the top of this page changes with it. This version is dated ${LEGAL.updated}.`,
      ],
    },
    {
      heading: "12. Contact",
      paragraphs: [`Privacy questions and requests can go to ${LEGAL.contact}.`],
    },
  ],
};

export const DOCS: LegalDoc[] = [TERMS, PRIVACY];

export function findDoc(slug: string): LegalDoc | undefined {
  return DOCS.find((doc) => doc.slug === slug);
}
