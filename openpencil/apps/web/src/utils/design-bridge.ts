import type { PenDocument } from '@/types/pen'

const DEFAULT_DOCUMENT_ENDPOINT = '/api/design/document'
const DESIGN_BRIDGE_CHANNEL_PREFIX = 'openagents-design'

export type DesignBridgeRemoteMessageType =
  | 'design.remote.revision-available'
  | 'design.remote.conflict'
  | 'design.remote.session-expired'

export interface DesignBridgeIdentityFields {
  threadId: string | null
  sessionId: string | null
  sessionGeneration: number | null
}

export interface DesignBridgeSession extends DesignBridgeIdentityFields {
  token: string
  targetPath: string
  documentEndpoint: string
  channelName: string | null
}

export interface DesignBridgeDocumentPayload {
  target_path: string
  revision: string
  document: PenDocument
}

export interface DesignBridgeSavePayload {
  target_path: string
  revision: string
  saved: boolean
}

export class DesignBridgeRequestError extends Error {
  statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'DesignBridgeRequestError'
    this.statusCode = statusCode
  }
}

export interface DesignBridgeRemoteMessage extends DesignBridgeIdentityFields {
  type: DesignBridgeRemoteMessageType
  targetPath: string
  revision: string | null
  emittedAt: string | null
}

let cachedSession: DesignBridgeSession | null | undefined
let currentRevision: string | null = null

function normalizeBridgeString(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized || null
}

function normalizeSessionGeneration(value: string | null | undefined): number | null {
  const normalized = normalizeBridgeString(value)
  if (!normalized) {
    return null
  }

  const parsed = Number.parseInt(normalized, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function buildDesignBridgeChannelName(
  identity: Pick<DesignBridgeIdentityFields, 'threadId'> & {
    targetPath: string | null
  },
): string | null {
  const threadId = normalizeBridgeString(identity.threadId)
  const targetPath = normalizeBridgeString(identity.targetPath)
  if (!threadId || !targetPath) {
    return null
  }

  // The channel is scoped to the Deer Flow thread plus the canonical design
  // artifact path so unrelated tabs never share document events by accident.
  return `${DESIGN_BRIDGE_CHANNEL_PREFIX}:${encodeURIComponent(threadId)}:${encodeURIComponent(targetPath)}`
}

export function getDesignBridgeSession(): DesignBridgeSession | null {
  if (cachedSession !== undefined) {
    return cachedSession
  }
  if (typeof window === 'undefined') {
    cachedSession = null
    return cachedSession
  }

  const params = new URLSearchParams(window.location.search)
  const token = normalizeBridgeString(params.get('design_token')) ?? ''
  if (!token) {
    cachedSession = null
    return cachedSession
  }

  const targetPath =
    normalizeBridgeString(params.get('design_target_path')) ??
    '/mnt/user-data/authoring/designs/main/canvas.op'
  const threadId = normalizeBridgeString(params.get('design_thread_id'))
  const sessionId = normalizeBridgeString(params.get('design_session_id'))
  const sessionGeneration = normalizeSessionGeneration(
    params.get('design_session_generation'),
  )

  cachedSession = {
    token,
    targetPath,
    documentEndpoint:
      normalizeBridgeString(params.get('design_document_url')) ??
      DEFAULT_DOCUMENT_ENDPOINT,
    threadId,
    sessionId,
    sessionGeneration,
    channelName: buildDesignBridgeChannelName({
      threadId,
      targetPath,
    }),
  }
  currentRevision ||= normalizeBridgeString(params.get('design_revision'))
  return cachedSession
}

export function isDesignBridgeMode(): boolean {
  return getDesignBridgeSession() !== null
}

export function getDesignBridgeRevision(): string | null {
  return currentRevision
}

export function setDesignBridgeRevision(revision: string | null): void {
  currentRevision = normalizeBridgeString(revision)
}

export function getDesignBridgeTargetPath(): string | null {
  return getDesignBridgeSession()?.targetPath ?? null
}

export function getDesignBridgeIdentityFields(): DesignBridgeIdentityFields | null {
  const session = getDesignBridgeSession()
  if (!session) {
    return null
  }

  return {
    threadId: session.threadId,
    sessionId: session.sessionId,
    sessionGeneration: session.sessionGeneration,
  }
}

export function getDesignBridgeChannelName(): string | null {
  return getDesignBridgeSession()?.channelName ?? null
}

export function normalizeDesignBridgeRemoteMessage(
  payload: unknown,
): DesignBridgeRemoteMessage | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const record = payload as Record<string, unknown>
  const type = normalizeBridgeString(
    typeof record.type === 'string' ? record.type : null,
  )
  const targetPath = normalizeBridgeString(
    typeof record.targetPath === 'string' ? record.targetPath : null,
  )

  if (
    !type ||
    !targetPath ||
    ![
      'design.remote.revision-available',
      'design.remote.conflict',
      'design.remote.session-expired',
    ].includes(type)
  ) {
    return null
  }

  return {
    type: type as DesignBridgeRemoteMessageType,
    targetPath,
    revision: normalizeBridgeString(
      typeof record.revision === 'string' ? record.revision : null,
    ),
    threadId: normalizeBridgeString(
      typeof record.threadId === 'string' ? record.threadId : null,
    ),
    sessionId: normalizeBridgeString(
      typeof record.sessionId === 'string' ? record.sessionId : null,
    ),
    sessionGeneration:
      typeof record.sessionGeneration === 'number'
        ? Math.trunc(record.sessionGeneration)
        : normalizeSessionGeneration(
            typeof record.sessionGeneration === 'string'
              ? record.sessionGeneration
              : null,
          ),
    emittedAt: normalizeBridgeString(
      typeof record.emittedAt === 'string' ? record.emittedAt : null,
    ),
  }
}

export function isDesignBridgeRemoteMessageForSession(
  message: DesignBridgeRemoteMessage,
  session: DesignBridgeSession | null = getDesignBridgeSession(),
): boolean {
  if (!session) {
    return false
  }
  if (message.targetPath !== session.targetPath) {
    return false
  }

  // Bridge identity fields are optional during rollout, but once Deer Flow
  // provides them we require an exact match so older tabs cannot consume a
  // newer session's remote updates.
  if (session.threadId && message.threadId && message.threadId !== session.threadId) {
    return false
  }
  if (
    session.sessionGeneration !== null &&
    message.sessionGeneration !== null &&
    message.sessionGeneration !== session.sessionGeneration
  ) {
    return false
  }
  if (session.sessionId && message.sessionId && message.sessionId !== session.sessionId) {
    return false
  }

  return true
}

export function isCurrentDesignBridgeRevision(revision: string | null): boolean {
  const normalizedRevision = normalizeBridgeString(revision)
  return Boolean(normalizedRevision) && normalizedRevision === currentRevision
}

export function isDesignBridgeSessionExpiredError(error: unknown): boolean {
  return (
    error instanceof DesignBridgeRequestError &&
    (error.statusCode === 401 || error.statusCode === 403)
  )
}

export function getDesignBridgeFileName(targetPath: string): string {
  const segments = targetPath.split('/').filter(Boolean)
  return segments.at(-1) || 'canvas.op'
}

export async function fetchDesignBridgeDocument(): Promise<DesignBridgeDocumentPayload> {
  const session = getDesignBridgeSession()
  if (!session) throw new Error('Design bridge session is not active')

  const res = await fetch(session.documentEndpoint, {
    headers: {
      Authorization: `Bearer ${session.token}`,
    },
  })
  if (!res.ok) {
    const detail = await readBridgeError(res)
    throw new DesignBridgeRequestError(
      detail ?? `Failed to load design document: ${res.status}`,
      res.status,
    )
  }

  const payload = (await res.json()) as DesignBridgeDocumentPayload
  return payload
}

export async function saveDesignBridgeDocument(
  document: PenDocument,
): Promise<DesignBridgeSavePayload> {
  const session = getDesignBridgeSession()
  if (!session) throw new Error('Design bridge session is not active')

  const res = await fetch(session.documentEndpoint, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      document,
      revision: getDesignBridgeRevision(),
    }),
  })
  if (!res.ok) {
    const detail = await readBridgeError(res)
    throw new DesignBridgeRequestError(
      detail ?? `Failed to save design document: ${res.status}`,
      res.status,
    )
  }

  const payload = (await res.json()) as DesignBridgeSavePayload
  setDesignBridgeRevision(payload.revision)
  return payload
}

async function readBridgeError(res: Response): Promise<string | null> {
  try {
    const payload = (await res.json()) as { error?: string }
    return payload.error?.trim() || null
  } catch {
    return null
  }
}

export function resetDesignBridgeStateForTests(): void {
  cachedSession = undefined
  currentRevision = null
}
