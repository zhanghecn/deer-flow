# MCP Library 用户使用说明与真实测试截图

日期：2026-04-16

## 先说结论

这次改动后，MCP 的使用方式已经变成两步：

1. 先在全局 **MCP** 入口里创建一个可复用的 MCP Profile
2. 再到某个智能体的 **Settings -> Config** 里，把这个 MCP Profile 绑定给该智能体

如果你只是打开聊天页，不去：

- 工作区右上角用户菜单里的 **Settings -> MCP**
- 或某个 agent 的 **Settings -> Config**

那你确实可能“看不到变化”。这也是你刚才会怀疑没做真实测试的原因。

## 这次截图放在哪里

目录：

- [docs/testing/results/2026-04-16-mcp-library-user-guide](/root/project/ai/deer-flow/docs/testing/results/2026-04-16-mcp-library-user-guide)

截图文件：

1. [01-mcp-library-empty.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-16-mcp-library-user-guide/01-mcp-library-empty.png)
2. [02-mcp-create-dialog.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-16-mcp-library-user-guide/02-mcp-create-dialog.png)
3. [03-mcp-library-created.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-16-mcp-library-user-guide/03-mcp-library-created.png)
4. [04-agent-config-mcp-bindings.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-16-mcp-library-user-guide/04-agent-config-mcp-bindings.png)
5. [05-agent-config-mcp-selected.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-16-mcp-library-user-guide/05-agent-config-mcp-selected.png)
6. [06-agent-config-saved.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-16-mcp-library-user-guide/06-agent-config-saved.png)
7. [07-mcp-library-clean-empty.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-16-mcp-library-user-guide/07-mcp-library-clean-empty.png)
8. [08-agent-config-clean-bindings.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-16-mcp-library-user-guide/08-agent-config-clean-bindings.png)

## 作为用户，你应该怎么用

### A. 创建 MCP Profile

1. 登录工作区 `http://127.0.0.1:8083`
2. 点击左上/左侧工作区里的用户头像菜单
3. 点 `Settings`
4. 点左侧的 `MCP`

你看到的空状态应该类似：

- [01-mcp-library-empty.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-16-mcp-library-user-guide/01-mcp-library-empty.png)

然后：

1. 点击 `Create MCP`
2. 填 `Profile name`
3. 在 `Canonical mcpServers JSON` 里粘贴标准 MCP JSON

创建对话框示例：

- [02-mcp-create-dialog.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-16-mcp-library-user-guide/02-mcp-create-dialog.png)

一个最小 JSON 示例：

```json
{
  "mcpServers": {
    "customer-docs": {
      "type": "http",
      "url": "https://customer.example.com/mcp"
    }
  }
}
```

保存后列表里会出现这个 Profile：

- [03-mcp-library-created.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-16-mcp-library-user-guide/03-mcp-library-created.png)

## B. 把 MCP Profile 绑定给某个智能体

1. 进入 `Agents`
2. 找到你要配置的 agent
3. 点击 `Settings`
4. 切到 `Config`

你会在 `Config` 页签里看到新的 `MCP library bindings` 区块：

- [04-agent-config-mcp-bindings.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-16-mcp-library-user-guide/04-agent-config-mcp-bindings.png)

接着：

1. 在搜索框里搜你刚创建的 MCP Profile
2. 点选它

点选后的状态：

- [05-agent-config-mcp-selected.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-16-mcp-library-user-guide/05-agent-config-mcp-selected.png)

最后：

1. 点击页面底部的 `Save changes`

保存后的状态：

- [06-agent-config-saved.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-16-mcp-library-user-guide/06-agent-config-saved.png)

## C. 绑定后怎么验证它真的生效

最简单的用户验证方式：

1. 给这个 agent 开一个新 chat
2. 明确让它调用你 MCP 里的某个 tool
3. 看返回结果是否来自该 tool

如果你想做管理员级验证：

1. 打开 `http://127.0.0.1:8081`
2. 登录 admin
3. 去 `Observability`
4. 点开对应 trace
5. 检查：
   - `Registered Tools` 里有没有该 MCP tool
   - 事件里有没有真正的 tool call
   - 最终输出是不是来自 MCP 返回

## 这次我真实测试了什么

我不是只做了页面静态改动，已经做了真实 current-code 测试：

1. 重新用 `docker/docker-compose-prod.yaml` build 了 current-code `gateway/langgraph/nginx`
2. 在 `8083` 里真实打开 `Settings -> MCP`
3. 真实创建了 `customer-docs` MCP Profile
4. 真实打开 `lead_agent` 的 `Settings -> Config`
5. 真实绑定了 `customer-docs`
6. 真实保存，并通过已登录浏览器里的 API 请求确认：
   - `mcp_servers = ["custom/mcp-profiles/customer-docs.json"]`
7. 真实让 `lead_agent` 调用了一个 MCP test server 的 `test_echo`
8. 实际返回了：

```text
MCP_TEST_OK:hello
```

9. 再到 `8081` 的 `Observability` 里确认 trace 里看到了：
   - `Registered Tools -> test_echo`
   - `Tool · test_echo`
   - 最终结果 `[MCP_TEST_OK:hello]`

## 为什么你现在进去可能还是空的

因为我在交付前把测试残留清掉了：

- 测试用的 `customer-docs` MCP Profile 已删除
- `lead_agent` 上的测试绑定也已清掉

这样做是为了让交付态干净，不把测试垃圾留在系统里。

所以你现在如果打开 `Settings -> MCP` 看到空状态，是正常的。  
你需要按上面的步骤自己新建一个 profile，再绑定给 agent。

这两张图就是**清理后的当前交付态**：

- 全局 MCP Library 空状态：
  - [07-mcp-library-clean-empty.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-16-mcp-library-user-guide/07-mcp-library-clean-empty.png)
- `lead_agent` 的 `Config` 页签在交付态下没有测试残留绑定：
  - [08-agent-config-clean-bindings.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-16-mcp-library-user-guide/08-agent-config-clean-bindings.png)

## 现在产品心智可以这样记

- **全局 MCP 页面**：维护 MCP Library
- **Agent Settings -> Config**：选择这个 agent 能用哪些 MCP
- **聊天页**：真正使用这些 MCP tools
- **8081 Observability**：验证是否真的调用了 MCP
