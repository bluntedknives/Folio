export type Role = "user" | "assistant" | "system";

/** What the attachment actually is, which decides how it is sent and drawn. */
export type AttachmentKind = "image" | "document" | "audio";

export interface Attachment {
  kind: AttachmentKind;
  /** Display name, from the file or generated for a paste. */
  name: string;
  /**
   * Payload as a data URL. Images are re-encoded so metadata is dropped;
   * documents and audio are passed through untouched.
   */
  dataUrl: string;
  /** Images only. */
  width?: number;
  height?: number;
  /** Documents only: extracted plain text, so the model knows what is in there. */
  text?: string;
  /** Documents only: how many pages were rendered. */
  pages?: number;
  /** Bytes of `dataUrl`. */
  bytes: number;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  /** Chain-of-thought streamed by reasoning models, shown in a collapsible panel. */
  reasoning?: string;
  attachments?: Attachment[];
  createdAt: number;
  /** Set when the request failed so the bubble can render an error state. */
  error?: string;
  model?: string;
  /** Web results this answer was grounded in, when search ran for the turn. */
  sources?: Source[];
}

export interface Source {
  title: string;
  url: string;
  snippet: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface ModelInfo {
  id: string;
  label: string;
  blurb: string;
  vision: boolean;
  /** Accepts recorded audio. */
  audio: boolean;
  reasoning: boolean;
  /** Where this model sits in the auto-routing order. */
  tier: "quick" | "fast" | "deep" | "vision";
}

/** A content part in the wire format. */
export type WirePart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "input_audio"; input_audio: { data: string; format: string } };

/** Wire format sent to the API route. */
export interface WireMessage {
  role: Role;
  content: string;
  parts?: WirePart[];
}
