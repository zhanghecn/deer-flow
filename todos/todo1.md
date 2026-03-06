# 现在我想将 deer-flow 项目改造成企业级云端智能体。
目前 deer-flow 包含什么？
先阅读
@deer-flow/CONTRIBUTING.md
@deer-flow/backend/CLAUDE.md
@deer-flow/frontend/CLAUDE.md


# 目前存在一些问题:
1. 只支持一个用户使用
2. 只能在指定页面使用
3. 对于已实现的提示词和工具 以及 子智能体的编排我实际是不放心的
4. 后续不方便改造企业级架构
5. 只有统一的 lead_agent,不能定义多个agent  只能通过一个 lead_agent + skill 完成特殊组装

# 现在需要做一个云端智能体:
1. 支持多用户使用,直接使用我们的云端智能体
2. 支持管理 agents ,并且每个agent 支持 通过传递agent名称 + 授权token 形成开放式接口在任意地方进行调用,中间产生的任何文件任何结构都可以获取到
3. 支持管理 skill 并且每个 skill 拥有prod/dev 状态
4. 支持通过一个对话 生成 agent . 通过 引导的skill。 询问用户想要什么,生成专业性的 skill 以及 系统提示词(放在AGENTS.md)  并附带自测试
5. 每个agent 可以配置 agent名称 agent 描述 使用的模型 以及 AGENTS.md 位置 和 使用哪些 skill 的配置。 包括 prod/dev 状态。

# 储存方面:
可以参考现有的 replace_virtual_path 。
但是除了这个之外,还需要加个 agents 目录,这个目录存放每个智能体的 AGENTS.md 和 skills。而不是像现在这种直接读取全部  
agents 还需要分 prod 和 dev 目录   

# 交互方面:
前端交互默认还是 lead_agent 。 
也支持从点击 智能体/ 找到想要的智能体进行测试/使用。
每个智能体还可以一键导出接口在任意地方使用


# 改造方面:

## 后端
后端网关改成用 go 语言写的
数据库使用 postgre
方便后续进行维护。但是目录结构沿用
模型维护也是通过后台维护,但也支持通过 本地环境配置文件进行测试

## agent 
agent也需要改造 
而是使用opencode。 但是opencode 是个写代码的智能体。 所以需要进行改造。
改造后的智能体就叫做 openagent

## opencode
opencode目前需要先了解可行性。
他拥有可以媲美 langchain Middleware 的 插件系统。
插件系统支持 hook 注入工具 甚至认证。
还拥有 skills 加载机制 和 agents 快速配置

## 改造要求

目前你可能会遇到下面的难点:
1. langchain 中编排的智能体是通过 langgraph 开放的接口
2. 前端使用的也是 langchain sdk 对接的,我该如何修改
3. 事件消息不对等
4. 已经编排的智能体如何转换

所以必须深入了解
1. opencode 插件系统 以及权限(要求放开全部权限,避免出现需要用户确定的情况)
2. sdk 使用 包括 app 里面的使用案例。
3. oh-my-opencode 有一套非常完善得插件使用的案例
4. skills 加载机制
5. 插件和工具的注入
6. sandbox 路由进行改造,支持集成 local/sandbox 两种方式 本地用于调试,sandbox 是实际沙箱用于生产环境 

设计好后给出一个完美的改造方案,对于沙箱看如何通过插件直接动态替换掉 原有的 read edit write..等设计到文件操作的命令

## 测试要求
你必须想一套可完整测试的代码,可来回进行比对,确认是否完全改造完成,才允许验收

现有 deer-flow 测试 事件流。 真实测试 使用skill->自规划->派发子智能体->调研->收集资料->调用工具/执行命令->产出html/doc/pptx 等各种文件

改造后的 openagents 智能体也应该能完成这些操作。 并反复对比日志测试。

## 最终要求
改造完成后
1. 前端保证对齐改造后的网关 和 openagent 并能实现一致的效果
2. 在改造后的基础上完成前面说的新功能
3. 新功能每个部分也需要对应的测试通过的代码
