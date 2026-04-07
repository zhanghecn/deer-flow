export type RemoteOperation =
  | "execute"
  | "ls_info"
  | "read"
  | "grep_raw"
  | "glob_info"
  | "write"
  | "edit"
  | "upload_files"
  | "download_files"

export interface RemoteSessionRecord {
  session_id: string
  status: "registered" | "connected" | "disconnected"
  created_at: string
  updated_at: string
  client_name?: string | null
  cli_version?: string | null
  platform?: string | null
  hostname?: string | null
  workspace_root?: string | null
  runtime_root?: string | null
  last_heartbeat_at?: string | null
}

export interface RemoteRequestEnvelope {
  request_id: string
  session_id: string
  operation: RemoteOperation
  created_at: string
  response_timeout_seconds: number
  payload: Record<string, unknown>
}

export interface SubmitRemoteResponseRequest {
  success: boolean
  payload: Record<string, unknown>
  error?: string
}

export interface RemoteSessionCreatedResponse {
  session_id: string
  client_token: string
  created_at: string
}

export interface PathMap {
  workspaceRoot: string
  runtimeRoot: string
  uploadsRoot: string
  outputsRoot: string
  tmpRoot: string
  agentsRoot: string
  authoringRoot: string
  userDataRoot: string
}

export interface RuntimeContext {
  pathMap: PathMap
}
