import { api } from "./client";

export interface NovaEnvironment {
  id: string;
  userId: string;
  railwayServiceId: string | null;
  railwayServiceName: string | null;
  railwayUrl: string | null;
  status: string;
  channels?: string[];
  whatsappNumber: string | null;
  telegramId: string | null;
  slackWorkspace: string | null;
  discordGuild: string | null;
  gmailEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NovaCosts {
  today: number;
  month: number;
  messageCount: number;
}

export interface NovaChatMessage {
  id?: string;
  chat_jid?: string;
  content: string;
  text?: string;
  timestamp: string | number;
  is_from_me?: boolean;
  is_bot_message?: boolean;
  channel?: string;
}

export const novaApi = {
  getStatus: () =>
    api.get<{ environment: NovaEnvironment | null }>("/nova/status"),

  getChannels: () =>
    api.get<{ channels: string[] }>("/nova/channels"),

  sendMessage: (message: string) =>
    api.post<{ response: string }>("/nova/chat", { message }),

  getHistory: (limit = 100) =>
    api.get<{ messages: NovaChatMessage[] }>(`/nova/history?limit=${limit}`),

  getLiveMessages: (since: string) =>
    api.get<{ messages: NovaChatMessage[] }>(
      `/nova/live-messages?since=${encodeURIComponent(since)}`,
    ),

  getCosts: () => api.get<{ costs: NovaCosts }>("/nova/costs"),

  getNotifications: () =>
    api.get<{ notifications: Array<{ message: string }> }>("/nova/notifications"),
};
