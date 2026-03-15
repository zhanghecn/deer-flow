import type {
  RemoteRequestEnvelope,
  RemoteSessionCreatedResponse,
  RemoteSessionRecord,
  SubmitRemoteResponseRequest,
} from "./types"

function trimServerUrl(input: string): string {
  return input.replace(/\/+$/, "")
}

export class RemoteRelayClient {
  private readonly serverUrl: string
  private sessionId: string | null
  private token: string | null

  constructor(serverUrl: string, sessionId?: string, token?: string) {
    this.serverUrl = trimServerUrl(serverUrl)
    this.sessionId = sessionId ?? null
    this.token = token ?? null
  }

  setSession(sessionId: string, token: string): void {
    this.sessionId = sessionId
    this.token = token
  }

  private headers(): HeadersInit {
    if (!this.token) return {}
    return { "x-openagents-session-token": this.token }
  }

  private requireSession(): { sessionId: string; token: string } {
    if (!this.sessionId || !this.token) {
      throw new Error("Remote session is not configured.")
    }
    return { sessionId: this.sessionId, token: this.token }
  }

  async health(): Promise<void> {
    const response = await fetch(`${this.serverUrl}/health`)
    if (!response.ok) throw new Error(`health check failed with status ${response.status}`)
  }

  async listSessions(): Promise<RemoteSessionRecord[]> {
    const response = await fetch(`${this.serverUrl}/api/remote/sessions`)
    if (!response.ok) throw new Error(`failed to list sessions: ${response.status}`)
    const payload = (await response.json()) as { sessions: RemoteSessionRecord[] }
    return payload.sessions
  }

  async registerSession(request: Record<string, unknown>): Promise<RemoteSessionCreatedResponse> {
    const response = await fetch(`${this.serverUrl}/api/remote/sessions/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    })
    if (!response.ok) throw new Error(`failed to register session: ${response.status}`)
    return (await response.json()) as RemoteSessionCreatedResponse
  }

  async connectSession(request: Record<string, unknown>): Promise<void> {
    const { sessionId } = this.requireSession()
    const response = await fetch(`${this.serverUrl}/api/remote/sessions/${sessionId}/connect`, {
      method: "POST",
      headers: {
        ...this.headers(),
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    })
    if (!response.ok) throw new Error(`failed to connect session: ${response.status}`)
  }

  async heartbeat(status: "connected" | "disconnected" = "connected"): Promise<void> {
    const { sessionId } = this.requireSession()
    const response = await fetch(`${this.serverUrl}/api/remote/sessions/${sessionId}/heartbeat`, {
      method: "POST",
      headers: {
        ...this.headers(),
        "content-type": "application/json",
      },
      body: JSON.stringify({ status }),
    })
    if (!response.ok) throw new Error(`failed to heartbeat session: ${response.status}`)
  }

  async pollRequest(waitSeconds = 20): Promise<RemoteRequestEnvelope | null> {
    const { sessionId } = this.requireSession()
    const response = await fetch(
      `${this.serverUrl}/api/remote/sessions/${sessionId}/requests/poll?wait=${waitSeconds}`,
      { headers: this.headers() },
    )
    if (response.status === 204) return null
    if (!response.ok) throw new Error(`failed to poll request: ${response.status}`)
    return (await response.json()) as RemoteRequestEnvelope
  }

  async submitResponse(requestId: string, payload: SubmitRemoteResponseRequest): Promise<void> {
    const { sessionId } = this.requireSession()
    const response = await fetch(`${this.serverUrl}/api/remote/sessions/${sessionId}/responses/${requestId}`, {
      method: "POST",
      headers: {
        ...this.headers(),
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    })
    if (!response.ok) throw new Error(`failed to submit response: ${response.status}`)
  }
}
