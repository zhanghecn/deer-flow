# Browser Probe Scripts

这些脚本用于有头或无头地回归 OpenAgents 的关键浏览器流程。

## 目标脚本

- `agent_dataset_browser_probe.mjs`
  基于 `todos/multi_agent_test_suite_complete/agent_dataset/` 执行 7 个数据集用例，并按评审规则校验结果。
- `find_skills_browser_probe.mjs`
  回归 `find-skills` 的搜索、安装成功路径和失败回显路径。
- `headed_full_flow_probe.mjs`
  执行从创建 skill、创建 agent、dev 验证、推送 prod、下载 demo 到 artifact 产物验证的整条链路。

## 共享约定

- 默认地址：`OPENAGENTS_BASE_URL=http://127.0.0.1:3101`
- 默认账号：`OPENAGENTS_ADMIN_ACCOUNT=admin`
- 默认密码：`OPENAGENTS_ADMIN_PASSWORD=admin123`
- 浏览器内核从 `frontend/app` 的 Playwright 依赖加载
- 运行结果统一写入：
  `todos/multi_agent_test_suite_complete/agent_test_package/runtime_results/`
- 如果目标是本地 Next dev server，请优先使用 `http://localhost:3000`，不要用 `http://127.0.0.1:3000`，否则 Next dev 的 `/_next/*` 资源可能触发跨源告警并让登录页 hydration 失效。

## 常用环境变量

- `HEADLESS=1`
  使用无头模式运行支持该选项的脚本。
- `PW_SLOW_MO=150`
  控制 Playwright 操作节奏，便于人工观察。
- `RUN_TIMEOUT_MS=600000`
  控制单轮等待超时时间。
  对 `TC-01`、`TC-02` 这类完整执行与产物生成场景，建议保持默认值；如果人为压到 240000，可能把长任务误判为失败。
- `OPENAGENTS_TEST_RUN_ID=<token>`
  给 `headed_full_flow_probe.mjs` 生成唯一 skill/agent 名，避免与历史测试残留冲突。
- `ONLY_SUITE=<key>`
  只执行 `headed_full_flow_probe.mjs` 的某一个领域测试，或 `artifacts`。
- `ARTIFACT_KEYS=markdown,pdf`
  只执行指定 artifact 场景。
- `CASE_IDS=TC-A,TC-B,TC-02`
  只执行指定数据集用例。

## 示例

```bash
node scripts/find_skills_browser_probe.mjs
```

```bash
HEADLESS=1 OPENAGENTS_TEST_RUN_ID=smoke-a1 \
node scripts/headed_full_flow_probe.mjs
```

```bash
CASE_IDS=TC-A,TC-B,TC-03 \
node scripts/agent_dataset_browser_probe.mjs
```
