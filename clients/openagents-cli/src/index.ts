#!/usr/bin/env bun

import { error } from "./logger"
import { runCommand } from "./cli"

runCommand().catch((err) => {
  error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
