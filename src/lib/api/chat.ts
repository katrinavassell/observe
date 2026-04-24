import { request } from "./base";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatAction {
  type: string;
  [key: string]: unknown;
}

export async function sendChatMessage(messages: ChatMessage[]): Promise<{
  message: string;
  action: ChatAction | null;
  usage: { prompt_tokens: number; completion_tokens: number };
}> {
  return request("/chat", {
    method: "POST",
    body: JSON.stringify({ messages }),
  });
}

export async function executeChatAction(
  action: ChatAction,
): Promise<{ success: boolean; message: string }> {
  return request("/chat/execute", {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}
