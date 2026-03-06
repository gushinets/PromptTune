export type Message =
  | { type: "IMPROVE_REQUEST"; payload: { text: string; site?: string; page_url?: string } }
  | { type: "IMPROVE_RESULT"; payload: { improved_text: string; request_id: string } }
  | { type: "PASTE_TEXT"; payload: { text: string } }
  | { type: "OPEN_AND_PASTE"; payload: { url: string; text: string } }
  | { type: "IMPROVE_ACTIVE_FIELD" };
