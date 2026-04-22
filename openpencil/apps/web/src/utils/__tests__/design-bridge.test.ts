// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import {
  buildDesignBridgeChannelName,
  DesignBridgeRequestError,
  getDesignBridgeChannelName,
  getDesignBridgeRevision,
  getDesignBridgeSession,
  isDesignBridgeSessionExpiredError,
  isCurrentDesignBridgeRevision,
  isDesignBridgeRemoteMessageForSession,
  normalizeDesignBridgeRemoteMessage,
  resetDesignBridgeStateForTests,
  setDesignBridgeRevision,
} from '@/utils/design-bridge'

const TARGET_PATH = '/mnt/user-data/outputs/designs/canvas.op'

describe('design bridge helpers', () => {
  beforeEach(() => {
    resetDesignBridgeStateForTests()
    window.history.replaceState({}, '', '/editor')
  })

  it('parses Deer Flow bridge identity from the launch URL', () => {
    window.history.replaceState(
      {},
      '',
      `/editor?design_token=token-1&design_target_path=${encodeURIComponent(TARGET_PATH)}&design_thread_id=thread-7&design_session_id=session-9&design_session_generation=3&design_revision=rev-5`,
    )

    expect(getDesignBridgeSession()).toEqual({
      token: 'token-1',
      targetPath: TARGET_PATH,
      documentEndpoint: '/api/design/document',
      threadId: 'thread-7',
      sessionId: 'session-9',
      sessionGeneration: 3,
      channelName: buildDesignBridgeChannelName({
        threadId: 'thread-7',
        targetPath: TARGET_PATH,
      }),
    })
    expect(getDesignBridgeChannelName()).toBe(
      'openagents-design:thread-7:%2Fmnt%2Fuser-data%2Foutputs%2Fdesigns%2Fcanvas.op',
    )
    expect(getDesignBridgeRevision()).toBe('rev-5')
  })

  it('normalizes remote broadcast payloads and accepts matching session identity', () => {
    window.history.replaceState(
      {},
      '',
      `/editor?design_token=token-1&design_target_path=${encodeURIComponent(TARGET_PATH)}&design_thread_id=thread-7&design_session_id=session-9&design_session_generation=3`,
    )

    const message = normalizeDesignBridgeRemoteMessage({
      type: 'design.remote.revision-available',
      threadId: 'thread-7',
      targetPath: TARGET_PATH,
      revision: 'rev-6',
      sessionId: 'session-9',
      sessionGeneration: 3,
      emittedAt: '2026-04-13T13:00:00.000Z',
    })

    expect(message).toEqual({
      type: 'design.remote.revision-available',
      threadId: 'thread-7',
      targetPath: TARGET_PATH,
      revision: 'rev-6',
      sessionId: 'session-9',
      sessionGeneration: 3,
      emittedAt: '2026-04-13T13:00:00.000Z',
    })
    expect(isDesignBridgeRemoteMessageForSession(message!, getDesignBridgeSession())).toBe(true)
  })

  it('rejects stale remote events from another bridge session', () => {
    window.history.replaceState(
      {},
      '',
      `/editor?design_token=token-1&design_target_path=${encodeURIComponent(TARGET_PATH)}&design_thread_id=thread-7&design_session_id=session-9&design_session_generation=3`,
    )

    const otherSessionMessage = normalizeDesignBridgeRemoteMessage({
      type: 'design.remote.revision-available',
      threadId: 'thread-7',
      targetPath: TARGET_PATH,
      revision: 'rev-6',
      sessionId: 'session-10',
      sessionGeneration: 4,
    })

    expect(
      isDesignBridgeRemoteMessageForSession(
        otherSessionMessage!,
        getDesignBridgeSession(),
      ),
    ).toBe(false)
  })

  it('tracks the current bridge revision for no-op remote events', () => {
    setDesignBridgeRevision('rev-8')

    expect(isCurrentDesignBridgeRevision('rev-8')).toBe(true)
    expect(isCurrentDesignBridgeRevision('rev-9')).toBe(false)
    expect(isCurrentDesignBridgeRevision(null)).toBe(false)
  })

  it('classifies 401/403 bridge request failures as session expiry', () => {
    expect(
      isDesignBridgeSessionExpiredError(
        new DesignBridgeRequestError('expired', 401),
      ),
    ).toBe(true)
    expect(
      isDesignBridgeSessionExpiredError(
        new DesignBridgeRequestError('forbidden', 403),
      ),
    ).toBe(true)
    expect(
      isDesignBridgeSessionExpiredError(
        new DesignBridgeRequestError('server error', 500),
      ),
    ).toBe(false)
  })
})
