import { beforeEach, describe, expect, it } from "vitest";

import {
  buildAuthoringThreadStorageKey,
  getOrCreateAuthoringThreadId,
  readStoredAuthoringThreadId,
} from "./thread-storage";

describe("authoring thread storage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("reuses the sticky thread for the same authoring target", () => {
    const target = {
      kind: "agent" as const,
      name: "bms-kb-assistant",
      agentStatus: "dev" as const,
    };

    const firstThreadId = getOrCreateAuthoringThreadId(target);
    const secondThreadId = getOrCreateAuthoringThreadId(target);

    expect(secondThreadId).toBe(firstThreadId);
  });

  it("reads the sticky thread for only the selected authoring target", () => {
    const devAgent = {
      kind: "agent" as const,
      name: "bms-kb-assistant",
      agentStatus: "dev" as const,
    };
    const prodAgent = {
      kind: "agent" as const,
      name: "bms-kb-assistant",
      agentStatus: "prod" as const,
    };
    const devThreadId = getOrCreateAuthoringThreadId(devAgent);
    const prodThreadId = getOrCreateAuthoringThreadId(prodAgent);

    expect(readStoredAuthoringThreadId(devAgent)).toBe(devThreadId);
    expect(readStoredAuthoringThreadId(prodAgent)).toBe(prodThreadId);
    expect(
      readStoredAuthoringThreadId({
        kind: "agent",
        name: "other-agent",
        agentStatus: "dev",
      }),
    ).toBeNull();
  });

  it("keeps skill source paths isolated in the storage key", () => {
    expect(
      buildAuthoringThreadStorageKey({
        kind: "skill",
        name: "deploy",
        sourcePath: "store/dev/deploy",
      }),
    ).not.toBe(
      buildAuthoringThreadStorageKey({
        kind: "skill",
        name: "deploy",
        sourcePath: "store/prod/deploy",
      }),
    );
  });
});
