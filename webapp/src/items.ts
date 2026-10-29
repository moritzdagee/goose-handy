// What the chat log shows, one entry per bubble, tool call, plan or question.
import type { PlanEntry } from "@agentclientprotocol/sdk";
import type { ToolCallStatus } from "@desktop/components/ToolCallStatusIndicator";

export type PermOption = { optionId: string; name: string; kind: string };

export type Item =
  | { kind: "msg"; id: number; role: "user" | "agent" | "thought"; text: string }
  | { kind: "system"; id: number; text: string }
  | {
      kind: "tool";
      id: number;
      toolCallId: string;
      title: string;
      status: ToolCallStatus;
      output: string;
    }
  | { kind: "plan"; id: number; entries: PlanEntry[] }
  | {
      kind: "perm";
      id: number;
      title: string;
      options: PermOption[];
      chosen: string | null;
      resolve: (optionId: string | null) => void;
    };
