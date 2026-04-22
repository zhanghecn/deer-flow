import {
  getDesignBridgeIdentityFields,
  getDesignBridgeRevision,
  isDesignBridgeMode,
} from '@/utils/design-bridge'

const HOST_BRIDGE_SOURCE = 'openpencil-host-bridge'

type HostBridgeTarget = Window

type HostBridgeMessage = {
  source: typeof HOST_BRIDGE_SOURCE
  type: string
  payload: Record<string, unknown>
}

type HostBridgeSelectionNode = {
  id: string
  label?: string
}

function getBridgeTargets(): HostBridgeTarget[] {
  if (typeof window === 'undefined') {
    return []
  }

  const targets: HostBridgeTarget[] = []
  if (window.opener && !window.opener.closed) {
    targets.push(window.opener)
  }
  if (window.parent && window.parent !== window) {
    targets.push(window.parent)
  }
  return targets
}

function withBridgeIdentity(payload: Record<string, unknown>) {
  const identity = getDesignBridgeIdentityFields()
  const revision = getDesignBridgeRevision()

  return {
    ...payload,
    ...(identity?.threadId ? { threadId: identity.threadId } : {}),
    ...(identity?.sessionId ? { sessionId: identity.sessionId } : {}),
    ...(identity?.sessionGeneration !== null &&
    identity?.sessionGeneration !== undefined
      ? { sessionGeneration: identity.sessionGeneration }
      : {}),
    ...(!('revision' in payload) && revision ? { revision } : {}),
  }
}

function postHostBridgeMessage(type: string, payload: Record<string, unknown>) {
  if (!isDesignBridgeMode()) {
    return
  }

  const targets = getBridgeTargets()
  if (targets.length === 0) {
    return
  }

  const message: HostBridgeMessage = {
    source: HOST_BRIDGE_SOURCE,
    type,
    payload: withBridgeIdentity(payload),
  }

  for (const target of targets) {
    target.postMessage(message, window.location.origin)
  }
}

export function notifyDesignDocumentLoaded(payload: {
  targetPath: string
  revision: string | null
}) {
  postHostBridgeMessage('design.document.loaded', payload)
}

export function notifyDesignDocumentSaved(payload: {
  targetPath: string
  revision: string | null
}) {
  postHostBridgeMessage('design.document.saved', payload)
}

export function notifyDesignDocumentDirty(payload: {
  targetPath: string
  dirty: boolean
}) {
  postHostBridgeMessage('design.document.dirty', payload)
}

export function notifyDesignDocumentError(payload: {
  targetPath: string
  error: string
  phase?: 'load' | 'save'
}) {
  postHostBridgeMessage('design.document.error', payload)
}

export function notifyDesignRemoteConflict(payload: {
  targetPath: string
  revision: string | null
  reason?: string
}) {
  postHostBridgeMessage('design.remote.conflict', payload)
}

export function notifyDesignSessionExpired(payload: {
  targetPath: string
  revision: string | null
  error: string
}) {
  postHostBridgeMessage('design.remote.session-expired', payload)
}

export function notifyDesignSelectionChanged(payload: {
  targetPath: string
  selectedIds: string[]
  activeId: string | null
  selectedNodes?: HostBridgeSelectionNode[]
}) {
  postHostBridgeMessage('design.selection.changed', payload)
}
