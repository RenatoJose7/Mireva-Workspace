import { z } from "zod";

export const agentStateSchema = z.enum([
  "AVAILABLE", "WORKING", "RESEARCHING", "TESTING", "WAITING_APPROVAL", "BLOCKED", "DISCONNECTED",
]);
export type AgentState = z.infer<typeof agentStateSchema>;

export const taskStatusSchema = z.enum([
  "BACKLOG", "READY", "CLAIMED", "RUNNING", "REVIEW", "DONE", "FAILED", "BLOCKED", "CANCELLED", "WAITING_APPROVAL",
]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const roomSchema = z.object({
  id: z.string(), code: z.string(), name: z.string(), ownerId: z.string(), createdAt: z.string(),
});
export type Room = z.infer<typeof roomSchema>;

export const participantSchema = z.object({
  id: z.string(), roomId: z.string(), name: z.string(), agent: z.string(), state: agentStateSchema,
  joinedAt: z.string(), lastSeenAt: z.string(),
});
export type Participant = z.infer<typeof participantSchema>;

export const eventKindSchema = z.enum(["PARTICIPANT_JOINED", "PRESENCE", "MESSAGE", "TASK_CREATED", "TASK_UPDATED", "DECISION_REQUESTED"]);
export type EventKind = z.infer<typeof eventKindSchema>;
export const eventSchema = z.object({
  id: z.string(), roomId: z.string(), sequence: z.number().int().positive(), kind: eventKindSchema,
  participantId: z.string().nullable(), payload: z.record(z.string(), z.unknown()), createdAt: z.string(),
});
export type RoomEvent = z.infer<typeof eventSchema>;

export const taskSchema = z.object({
  id: z.string(), roomId: z.string(), title: z.string().min(1), description: z.string(), status: taskStatusSchema,
  dependencies: z.array(z.string()), assignedParticipantId: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(),
});
export type Task = z.infer<typeof taskSchema>;

export const createRoomSchema = z.object({ name: z.string().min(1).max(100), ownerName: z.string().min(1).max(80) });
export const joinRoomSchema = z.object({ name: z.string().min(1).max(80), agent: z.string().min(1).max(80) });
export const postEventSchema = z.object({ kind: eventKindSchema, payload: z.record(z.string(), z.unknown()).default({}) });
export const createTaskSchema = z.object({ title: z.string().min(1), description: z.string().default(""), dependencies: z.array(z.string()).default([]) });

export interface HubSnapshot { room: Room; participants: Participant[]; tasks: Task[]; lastSequence: number }
