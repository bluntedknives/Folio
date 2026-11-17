export type Role = "user" | "assistant" | "system";

/** What the attachment actually is, which decides how it is sent and drawn. */
export type AttachmentKind = "image" | "document" | "audio" | "video";

export interface Attachment {
  kind: AttachmentKind;
  /** Display name, from the file or generated for a paste. */
  name: string;
  /**
   * Payload as a data URL. Images are re-encoded so metadata is dropped;
   * videos have their container metadata blanked in place; documents and audio
   * are passed through untouched.
   */
  dataUrl: string;
  /** Images and videos. */
  width?: number;
  height?: number;
  /** Documents only: extracted plain text, so the model knows what is in there. */
  text?: string;
  /** Documents only: how many pages were rendered. */
  pages?: number;
  /** Videos only: length in seconds, 0 when it could not be read. */
  duration?: number;
  /**
   * Videos only: whether the container declares a sound track. Only the omni
   * model hears it, so this decides which model the turn goes to.
   */
  hasAudio?: boolean;
  /** Videos only: a single frame as a JPEG data URL, used as the thumbnail. */
  poster?: string;
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
  /**
   * The domain the result actually lives on, `www.` stripped and lowercased.
   * Resolved on the server from the final URL, so the client never has to
   * parse one and cannot show a host the link does not go to.
   */
  host?: string;
  /** Friendly site name for display, e.g. "Wikipedia". Falls back to `host`. */
  site?: string;
}

/**
 * What could be read about a YouTube video. There is deliberately no
 * transcript: the captions endpoint refuses datacenter IPs, so claiming one
 * would be a lie. `frames` are stills the model actually looked at, and the
 * answer has to say that the audio was not heard.
 */
export interface VideoContext {
  id: string;
  url: string;
  title: string;
  channel: string;
  /** "51:22" as YouTube displays it, or "" when the page did not expose it. */
  duration: string;
  /** Human date, e.g. "Dec 27, 2020". */
  published: string;
  description: string;
  /** Data URLs of the stills sent to the model. */
  frames: string[];
}

/**
 * What could be read from a web page. The text is the page's own readable
 * content, stripped of navigation and scripts, and it may be truncated. It is
 * not a summary, and the answer has to cite it rather than invent beyond it.
 */
export interface PageContext {
  url: string;
  title: string;
  /** Publisher, from the site name or the host. */
  site: string;
  /** Human date, when the page declared one. */
  published: string;
  text: string;
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
  /** Accepts a video clip. */
  video: boolean;
  reasoning: boolean;
  /** Where this model sits in the auto-routing order. */
  tier: "quick" | "fast" | "deep" | "vision";
}

/** A content part in the wire format. */
export type WirePart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "input_audio"; input_audio: { data: string; format: string } }
  | { type: "video_url"; video_url: { url: string } };

/** Wire format sent to the API route. */
export interface WireMessage {
  role: Role;
  content: string;
  parts?: WirePart[];
}
