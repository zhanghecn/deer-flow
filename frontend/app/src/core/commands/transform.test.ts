import { describe, expect, it } from "vitest";

import {
  buildCreateAgentFlowExtraContext,
  buildPromptExtraContext,
} from "./transform";

describe("buildPromptExtraContext", () => {
  it("extracts slash-command context for explicit commands", () => {
    expect(buildPromptExtraContext("/push-agent-prod 请发布")).toMatchObject({
      command_name: "push-agent-prod",
      command_args: "请发布",
      original_user_input: "/push-agent-prod 请发布",
    });
  });

  it("infers target skill name for skill persistence commands", () => {
    expect(
      buildPromptExtraContext(
        '/push-skill-prod 请把 dev skill oa-test-se-code-20260320 推送到 prod，必要时直接调用 push_skill_prod(skill_name="oa-test-se-code-20260320")。',
      ),
    ).toMatchObject({
      command_name: "push-skill-prod",
      target_skill_name: "oa-test-se-code-20260320",
    });
  });

  it("extracts knowledge document mentions from inline @ references", () => {
    expect(
      buildPromptExtraContext("请优先查看 @annual-report.pdf 总结收入"),
    ).toMatchObject({
      knowledge_document_mentions: ["annual-report.pdf"],
      original_user_input: "请优先查看 @annual-report.pdf 总结收入",
    });
  });

  it("extracts knowledge document mentions from bracket and quoted references", () => {
    expect(
      buildPromptExtraContext(
        '对比 @knowledge[2023 Annual Report.pdf] 和 @"Board Deck Q4.md"',
      ),
    ).toMatchObject({
      knowledge_document_mentions: [
        "2023 Annual Report.pdf",
        "Board Deck Q4.md",
      ],
    });
  });

  it("does not treat email addresses as knowledge document mentions", () => {
    expect(
      buildPromptExtraContext("请联系 foo@example.com 获取最新版本"),
    ).toBeUndefined();
  });
});

describe("buildCreateAgentFlowExtraContext", () => {
  it("injects create-agent context for plain follow-up text", () => {
    expect(
      buildCreateAgentFlowExtraContext(
        "请直接调用 setup_agent 完成建档",
        "demo-agent",
      ),
    ).toMatchObject({
      command_name: "create-agent",
      command_args: "请直接调用 setup_agent 完成建档",
      target_agent_name: "demo-agent",
      original_user_input: "请直接调用 setup_agent 完成建档",
    });
  });

  it("keeps explicit slash commands while preserving target agent name", () => {
    expect(
      buildCreateAgentFlowExtraContext(
        "/push-agent-prod 现在发布",
        "demo-agent",
      ),
    ).toMatchObject({
      command_name: "push-agent-prod",
      command_args: "现在发布",
      target_agent_name: "demo-agent",
      original_user_input: "/push-agent-prod 现在发布",
    });
  });

  it("preserves referenced skills on plain follow-up text", () => {
    expect(
      buildCreateAgentFlowExtraContext(
        "请复用 $find-skills 和 $skill-creator",
        "demo-agent",
      ),
    ).toMatchObject({
      command_name: "create-agent",
      target_agent_name: "demo-agent",
      referenced_skill_names: ["find-skills", "skill-creator"],
    });
  });
});
