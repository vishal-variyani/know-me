export interface ChatSendPayload {
  message: string;
}

export interface ChatChunkPayload {
  token: string;
}

export interface ChatCompletePayload {
  conversationId: string;
}

export interface ChatErrorPayload {
  message: string;
}
