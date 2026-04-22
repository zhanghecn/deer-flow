import { useEffect } from 'react'
import { zoomToFitContent } from '@/canvas/skia-engine-ref'
import { useDocumentStore } from '@/stores/document-store'
import {
  fetchDesignBridgeDocument,
  getDesignBridgeChannelName,
  getDesignBridgeFileName,
  getDesignBridgeRevision,
  getDesignBridgeSession,
  isDesignBridgeSessionExpiredError,
  isCurrentDesignBridgeRevision,
  isDesignBridgeMode,
  isDesignBridgeRemoteMessageForSession,
  normalizeDesignBridgeRemoteMessage,
  setDesignBridgeRevision,
} from '@/utils/design-bridge'
import {
  notifyDesignDocumentError,
  notifyDesignDocumentLoaded,
  notifyDesignDocumentSaved,
  notifyDesignRemoteConflict,
  notifyDesignSessionExpired,
} from '@/utils/host-bridge'

const DESIGN_BRIDGE_POLL_MS = 2000

type DesignBridgeDocumentPayload = Awaited<
  ReturnType<typeof fetchDesignBridgeDocument>
>

function applyBridgeDocument(
  payload: DesignBridgeDocumentPayload,
  options: {
    fitOnLoad?: boolean
    syncEvent?: 'loaded' | 'saved'
  } = {},
) {
  const { fitOnLoad = false, syncEvent = 'loaded' } = options

  useDocumentStore.getState().loadDocument(
    payload.document,
    getDesignBridgeFileName(payload.target_path),
    null,
    payload.target_path,
  )
  setDesignBridgeRevision(payload.revision)
  if (syncEvent === 'saved') {
    notifyDesignDocumentSaved({
      targetPath: payload.target_path,
      revision: payload.revision,
    })
  } else {
    notifyDesignDocumentLoaded({
      targetPath: payload.target_path,
      revision: payload.revision,
    })
  }

  if (fitOnLoad) {
    requestAnimationFrame(() => zoomToFitContent())
  }
}

export function useDesignBridgeDocument() {
  useEffect(() => {
    if (!isDesignBridgeMode()) return

    let cancelled = false
    let lastConflictRevision: string | null = null
    const session = getDesignBridgeSession()
    const channelName = getDesignBridgeChannelName()
    const canUseBroadcastChannel =
      typeof BroadcastChannel !== 'undefined' && Boolean(channelName)

    const emitConflict = (payload: {
      targetPath: string
      revision: string | null
      reason: string
    }) => {
      if (payload.revision && payload.revision === lastConflictRevision) {
        return
      }
      lastConflictRevision = payload.revision
      notifyDesignRemoteConflict(payload)
    }

    const loadRemoteDocument = async (
      options: {
        fitOnLoad?: boolean
        source: 'initial-load' | 'broadcast' | 'poll' | 'resume'
      },
    ) => {
      const payload = await fetchDesignBridgeDocument()
      if (cancelled) return

      if (
        options.source !== 'initial-load' &&
        payload.revision === getDesignBridgeRevision()
      ) {
        return
      }

      if (
        options.source !== 'initial-load' &&
        useDocumentStore.getState().isDirty
      ) {
        // Remote updates must never overwrite local unsaved edits. Emit an
        // explicit conflict so Deer Flow can surface a stale/reload-needed
        // state instead of silently dropping either side's changes.
        emitConflict({
          targetPath: payload.target_path,
          revision: payload.revision,
          reason: 'Remote revision arrived while the local document has unsaved changes.',
        })
        return
      }

      lastConflictRevision = null
      applyBridgeDocument(payload, {
        fitOnLoad: options.fitOnLoad,
        syncEvent: options.source === 'initial-load' ? 'loaded' : 'saved',
      })
    }

    const refreshRemoteDocument = (source: 'broadcast' | 'poll' | 'resume') => {
      void loadRemoteDocument({ source }).catch((err) => {
        if (cancelled) return

        if (isDesignBridgeSessionExpiredError(err)) {
          notifyDesignSessionExpired({
            targetPath: session?.targetPath ?? 'unknown',
            revision: getDesignBridgeRevision(),
            error:
              err instanceof Error
                ? err.message
                : 'The Deer Flow design session expired. Reopen the design board to continue syncing.',
          })
          return
        }

        if (source === 'broadcast' || source === 'resume') {
          console.error('[design-bridge] Failed to refresh remote document:', err)
        }
      })
    }

    loadRemoteDocument({
      fitOnLoad: true,
      source: 'initial-load',
    }).catch((err) => {
      console.error('[design-bridge] Failed to load document:', err)
      const targetPath = session?.targetPath
      if (isDesignBridgeSessionExpiredError(err)) {
        notifyDesignSessionExpired({
          targetPath: targetPath ?? 'unknown',
          revision: getDesignBridgeRevision(),
          error:
            err instanceof Error
              ? err.message
              : 'The Deer Flow design session expired. Reopen the design board to continue syncing.',
        })
        return
      }
      notifyDesignDocumentError({
        targetPath: targetPath ?? 'unknown',
        error:
          err instanceof Error
            ? err.message
            : 'Failed to load bridge document',
        phase: 'load',
      })
    })

    let channel: BroadcastChannel | null = null
    if (canUseBroadcastChannel && channelName) {
      channel = new BroadcastChannel(channelName)
      channel.addEventListener('message', (event: MessageEvent<unknown>) => {
        if (cancelled) {
          return
        }

        const message = normalizeDesignBridgeRemoteMessage(event.data)
        if (!message || !isDesignBridgeRemoteMessageForSession(message, session)) {
          return
        }

        switch (message.type) {
          case 'design.remote.revision-available': {
            if (isCurrentDesignBridgeRevision(message.revision)) {
              return
            }
            refreshRemoteDocument('broadcast')
            return
          }
          case 'design.remote.conflict': {
            emitConflict({
              targetPath: message.targetPath,
              revision: message.revision,
              reason:
                'Deer Flow reported that a newer remote revision conflicts with the current tab state.',
            })
            return
          }
          case 'design.remote.session-expired': {
            notifyDesignSessionExpired({
              targetPath: message.targetPath,
              revision: message.revision,
              error: 'The Deer Flow design session expired. Reopen the design board to continue syncing.',
            })
            return
          }
        }
      })
    }

    const pollTimer = !canUseBroadcastChannel
      ? window.setInterval(() => {
          refreshRemoteDocument('poll')
        }, DESIGN_BRIDGE_POLL_MS)
      : null

    const handleResume = () => {
      if (cancelled) {
        return
      }
      if (document.visibilityState === 'visible') {
        refreshRemoteDocument('resume')
      }
    }

    window.addEventListener('pageshow', handleResume)
    document.addEventListener('visibilitychange', handleResume)

    return () => {
      cancelled = true
      if (pollTimer !== null) {
        window.clearInterval(pollTimer)
      }
      channel?.close()
      window.removeEventListener('pageshow', handleResume)
      document.removeEventListener('visibilitychange', handleResume)
    }
  }, [])
}
