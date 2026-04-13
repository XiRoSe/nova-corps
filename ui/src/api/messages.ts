import { api } from "./client";

export interface NovaMessage {
  id: string;
  company_id: string;
  sender_type: "agent" | "owner";
  sender_agent_id: string | null;
  sender_name: string;
  recipient_type: "owner" | "agent";
  subject: string | null;
  body: string;
  tag: string | null;
  is_read: boolean;
  related_issue_id: string | null;
  related_issue_identifier: string | null;
  created_at: string;
  updated_at: string;
}

export const messagesApi = {
  list: (companyId: string, opts?: { unread?: boolean; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.unread) params.set("unread", "true");
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return api.get<NovaMessage[]>(`/companies/${companyId}/messages${qs ? `?${qs}` : ""}`);
  },

  send: (companyId: string, message: {
    senderType: string;
    senderName: string;
    body: string;
    senderAgentId?: string;
    subject?: string;
    tag?: string;
    recipientType?: string;
  }) => api.post<NovaMessage>(`/companies/${companyId}/messages`, message),

  markRead: (messageId: string) =>
    api.patch<{ ok: true }>(`/messages/${messageId}/read`, {}),

  reply: (messageId: string, body: string) =>
    api.post<NovaMessage>(`/messages/${messageId}/reply`, { body }),

  unreadCount: (companyId: string) =>
    api.get<{ count: number }>(`/companies/${companyId}/messages/unread-count`),
};
