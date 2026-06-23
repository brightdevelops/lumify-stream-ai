import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// ---- Mock supabase client ----
const rpcMock = vi.fn();
const removeChannelMock = vi.fn();

type Handler = (payload: { new: any }) => void;
const channelHandlers: Record<string, Handler[]> = {};

function makeChannel(_name: string) {
  const ch: any = {
    on: (_evt: string, _cfg: any, cb: Handler) => {
      // store all handlers under a single key per channel instance
      const key = _cfg?.filter ?? "list";
      (channelHandlers[key] ||= []).push(cb);
      return ch;
    },
    subscribe: () => ch,
  };
  return ch;
}

// Builder for .from("support_messages").select().eq().order() => thenable
function makeMessagesSelectChain(rows: any[]) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => Promise.resolve({ data: rows, error: null }),
  };
  return chain;
}

const insertMock = vi.fn(() => Promise.resolve({ error: null }));

vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      rpc: (...args: any[]) => rpcMock(...args),
      channel: (name: string) => makeChannel(name),
      removeChannel: (...args: any[]) => removeChannelMock(...args),
      from: (table: string) => {
        if (table === "support_messages") {
          return {
            // for the load query
            select: () => ({
              eq: () => ({
                order: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
            insert: (args: any) => insertMock(args),
          };
        }
        return makeMessagesSelectChain([]);
      },
    },
  };
});

// TanStack Router's createFileRoute requires a registered route tree; bypass it
vi.mock("@tanstack/react-router", async () => {
  return {
    createFileRoute: () => () => ({}),
  };
});

import { SupportInbox } from "@/routes/inventor.support";

const conv = {
  id: "conv-1",
  user_id: "user-1",
  user_email: "alice@example.com",
  full_name: "Alice",
  type: "chat",
  subject: null,
  last_message_at: new Date().toISOString(),
  last_message_preview: "hi",
  unread_for_admin: 3,
  credit_balance: 10,
  created_at: new Date().toISOString(),
};

beforeEach(() => {
  rpcMock.mockReset();
  insertMock.mockClear();
  removeChannelMock.mockClear();
  for (const k of Object.keys(channelHandlers)) delete channelHandlers[k];

  rpcMock.mockImplementation((name: string) => {
    if (name === "admin_list_support_conversations") {
      return Promise.resolve({ data: [conv], error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
});

describe("Inventor SupportInbox unread clearing", () => {
  it("marks a conversation read when the admin opens it", async () => {
    render(<SupportInbox />);
    const item = await screen.findByText("alice@example.com");
    fireEvent.click(item);

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith("admin_mark_conversation_read", {
        p_conversation_id: "conv-1",
      });
    });
  });

  it("marks read again when a new user message arrives while viewing", async () => {
    render(<SupportInbox />);
    fireEvent.click(await screen.findByText("alice@example.com"));

    // Wait for the initial mark-read from selecting
    await waitFor(() => {
      const calls = rpcMock.mock.calls.filter((c) => c[0] === "admin_mark_conversation_read");
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });
    const initial = rpcMock.mock.calls.filter((c) => c[0] === "admin_mark_conversation_read").length;

    // Simulate realtime INSERT from the user on this thread
    const handlers = channelHandlers["conversation_id=eq.conv-1"] ?? [];
    expect(handlers.length).toBeGreaterThan(0);
    act(() => {
      handlers.forEach((h) =>
        h({
          new: {
            id: "m-new",
            message: "another question",
            sender: "user",
            created_at: new Date().toISOString(),
          },
        })
      );
    });

    await waitFor(() => {
      const after = rpcMock.mock.calls.filter((c) => c[0] === "admin_mark_conversation_read").length;
      expect(after).toBeGreaterThan(initial);
    });
  });

  it("marks read after the admin sends a reply", async () => {
    render(<SupportInbox />);
    fireEvent.click(await screen.findByText("alice@example.com"));

    const input = await screen.findByPlaceholderText("Reply to user…");
    fireEvent.change(input, { target: { value: "thanks for reaching out" } });

    const sendBtn = input.parentElement!.querySelector('button[type="submit"]')!;
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(insertMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      const calls = rpcMock.mock.calls.filter((c) => c[0] === "admin_mark_conversation_read");
      // one from selection + one from reply
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
