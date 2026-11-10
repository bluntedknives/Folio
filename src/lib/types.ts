export type Role = "user" | "assistant" | "system";

export interface Attachment {
  /** Scrubbed data URL. The original file never leaves the browser. */
  dataUrl: string;
  /** Sanitised display name, never the original file name. */
  label: string;
  width: number;
  height: number;
  /** Bytes of the scrubbed image. */
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
  reasoning: boolean;
  /** Where this model sits in the auto-routing order. */
  tier: "quick" | "fast" | "deep" | "vision";
}

/** Wire format sent to the API route. */
export interface WireMessage {
  role: Role;
  content: string;
  images?: string[];
}
