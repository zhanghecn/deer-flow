-- Add mcp_servers column to agents table
-- Each agent can reference a subset of globally-defined MCP servers by name

ALTER TABLE agents ADD COLUMN IF NOT EXISTS mcp_servers TEXT[] DEFAULT '{}';
