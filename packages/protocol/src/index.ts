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
  capabilities: z.array(z.string()).default([]), joinedAt: z.string(), lastSeenAt: z.string(),
});
export type Participant = z.infer<typeof participantSchema>;

export const eventKindSchema = z.enum(["PARTICIPANT_JOINED", "PRESENCE", "MESSAGE", "TASK_CREATED", "TASK_UPDATED", "DECISION_REQUESTED", "ORCHESTRATOR_REQUEST", "ORCHESTRATOR_RESPONSE", "PLAN_CREATED"]);
export type EventKind = z.infer<typeof eventKindSchema>;
export const eventSchema = z.object({
  id: z.string(), roomId: z.string(), sequence: z.number().int().positive(), kind: eventKindSchema,
  participantId: z.string().nullable(), payload: z.record(z.string(), z.unknown()), createdAt: z.string(),
});
export type RoomEvent = z.infer<typeof eventSchema>;

export const taskSchema = z.object({
  id: z.string(), roomId: z.string(), title: z.string().min(1), description: z.string(), status: taskStatusSchema,
  dependencies: z.array(z.string()), assignedParticipantId: z.string().nullable(), priority: z.number().int().min(0).max(100),
  requiredCapabilities: z.array(z.string()), acceptanceCriteria: z.array(z.string()), result: z.string().nullable(),
  attempts: z.number().int().nonnegative(), maxAttempts: z.number().int().positive(), createdAt: z.string(), updatedAt: z.string(),
});
export type Task = z.infer<typeof taskSchema>;

export const plannedTaskSchema = z.object({ title: z.string().min(1), description: z.string().default(""), dependencies: z.array(z.number().int().nonnegative()).default([]), priority: z.number().int().min(0).max(100).default(50), acceptanceCriteria: z.array(z.string()).default([]) });
export const planStatusSchema = z.enum(["DRAFT", "APPROVED", "REJECTED"]);
export const planSchema = z.object({ id: z.string(), roomId: z.string(), request: z.string(), summary: z.string(), status: planStatusSchema, tasks: z.array(plannedTaskSchema), generatedTaskIds: z.array(z.string()), createdAt: z.string(), updatedAt: z.string() });
export type OrchestrationPlanRecord = z.infer<typeof planSchema>;

export const createRoomSchema = z.object({ name: z.string().min(1).max(100), ownerName: z.string().min(1).max(80) });
export const joinRoomSchema = z.object({ name: z.string().min(1).max(80), agent: z.string().min(1).max(80), capabilities: z.array(z.string()).default([]) });
export const postEventSchema = z.object({ kind: eventKindSchema, payload: z.record(z.string(), z.unknown()).default({}) });
export const createTaskSchema = z.object({
  title: z.string().min(1), description: z.string().default(""), dependencies: z.array(z.string()).default([]),
  priority: z.number().int().min(0).max(100).default(50), requiredCapabilities: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]), maxAttempts: z.number().int().positive().max(10).default(3),
});
export const claimTaskSchema = z.object({ participantId: z.string().uuid() });
export const updateTaskSchema = z.object({ participantId: z.string().uuid(), status: taskStatusSchema, result: z.string().max(20_000).optional() });
export const reviewTaskSchema = z.object({ ownerId: z.string().uuid(), status: z.enum(["DONE", "WAITING_APPROVAL"]), result: z.string().max(20_000).optional() });

export const createPlanSchema = z.object({ participantId: z.string().uuid(), request: z.string().min(1).max(20_000), summary: z.string().min(1).max(20_000), tasks: z.array(plannedTaskSchema).min(1).max(30) });
export const decidePlanSchema = z.object({ ownerId: z.string().uuid(), status: z.enum(["APPROVED", "REJECTED"]) });
export const dispatchTasksSchema = z.object({ ownerId: z.string().uuid() });
export interface HubSnapshot { room: Room; participants: Participant[]; tasks: Task[]; plans: OrchestrationPlanRecord[]; lastSequence: number }
