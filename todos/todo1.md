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
5. 每个agent 可以配置 agent名称 agent头像 agent描述 使用的模型 以及 AGENTS.md 位置 和 使用哪些 skill 的配置。 包括 prod/dev 状态。

# 储存方面:
可以参考现有的 replace_virtual_path 。
但是除了这个之外,还需要加个 agents 目录,这个目录存放每个智能体的 AGENTS.md 和 skills。而不是像现在这种直接读取全部  
agents 还需要分 prod 和 dev 目录    
agents 是集体的,里面的 AGENTS.md 和 skills是公用的。 只不过运行时的目录是按照 thread_id 隔离开。

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
agent也需要改造 目前agent 注册的工具和编排实际是不太靠谱的。
需要使用 deepagents 框架
关于 deepagents 我已经把源码下载下来了。你可以从 backend/deepagents/examples 中作为起发点了解源码实现 特别是 deep_research 和 content-builder-agent
然后将  backend 进行对齐。 将里面的 沙箱工具注册 subagents skills加载 全部精简优化

## 项目名称
项目名称统一改成 openagents,并对改造后测试完成的代码作为最终代码。 之前旧版代码可以删除,避免冗余误导

## 测试要求
你必须想一套可完整测试的代码,可来回进行比对,确认是否完全改造完成,才允许验收

现有 deer-flow 测试 事件流。 真实测试 使用skill->自规划->派发子智能体->调研->收集资料->调用工具/执行命令->产出html/doc/pptx 等各种文件

改造后的  智能体也应该能完成这些操作。 并反复对比日志测试。



## opencode 工具和智能体迁移
opencode 的工具注册和智能体更加完善。
收集 
../opencode/packages/opencode/src/agent
以及
../opencode/packages/opencode/src/tool

然后将对应提示词 和 工具内部实现全部对齐到目前我的项目。

为什么要这样做？
就拿 read 工具举例。
opencode 实现的read 不仅包含行号还包括剩余多少行的信息,提示词也更完善,参与智能体智能体循环过程中更加稳定,智能体会自动分页调用read工具。 
包括里面的智能体更容易搭配,这对我的项目配置子智能体用哪些工具 哪个模型 以及总结 上下文压缩策略也更好

## 后端协议方面
deer-flow/backend/agents/src/agents/lead_agent/agent.py 构建的后端协议有问题。 也没有完全统一规范
1. 创建agent 通过 skill + AGENTS.md 完成属于专业领域agent 要做的工作流
2. skills 是一个单独的文件夹储存 但是 AGENTS.md 独属于各个智能体。 skills 可以被 agent 引用。 选着哪几个skill 
3. 本地调试 用的 本地文件系统 但是发版肯定走虚拟机的 此时肯定需要 sandbox 
4. agent 中的 AGENTS.md 实际也是本地文件。 数据库储存的都是引用。目前看上去实现是有问题的
5. agent 里面分 dev/prod 的 避免调试污染 
6. agent 中的skill 是从 skills 库中复制过来的。避免每个agent 修改 skill 被污染。 后续还可以发布agent 内部的skill
7. 默认的agent 就是 lead_agent 中的 skill 可以用所有归档的skill

dev/prod 中的skills 和 AGENTS.md 都是归档在本地的。
沙箱什么时候用？运行时用,当环境变量启动沙箱那么就用沙箱。 沙箱是否使用也是通过某个配置开关开启的。不使用的话一般都是本地测试用的,通过指定一个目录和CompositeBackend 组合成一个虚拟目录。
将 dev/prod 中的对于的agent 的skills 和 AGENTS.md 通过调用 后端协议的写入功能 复制到对应目录中。这样 整个agent 执行过程中 不管配置的是沙箱还是基于本地但是虚拟路径路由都可以直接走通
dev/prod 只是区分调试和发布。因为我的智能体到时候会通过开放式接口给别人使用。肯定是区分prod版本的

完成后画一个 ascii 流程图 以及文档。 让我审查你是否真的理解清楚


## lead_agent
现在有一个 lead_agent 你帮我考虑一下如何融合现在的架构。

当用户第一次使用啥也没有的时候 肯定只会用到lead_agent。 
lead_agent 可以直接使用。
也可以为后续创建 其他领域agent 做个创建者。 流程是通过 lead_agent + skills 中的一个引导skill 。以及用户提示词 就能够完成智能体的创建。

我现在有个问题这个lead_agent 是否需要先处理一下。
统一下agent执行接口。 通过传递 agent名称 完成指定agent调用。
我的想法是 专业领域agent 发布后,可以不用通过我的平台使用,直接拿着这个接口任意地方使用。我的项目是要做一个云智能体。

如果lead_agent 需要处理,是不是应该先把AGENTS.md 放在本地文件夹里面 dev/prod。 然后数据库配置好 skills 和 AGENTS.md 的文件引用。
执行过程中理论上会自动 copy 到虚拟文件路由中(composite统一路由,实际内部隐藏掉 sandbox/local)  然后在去执行。

### 条件
目前已有的 deer-flow/skills/public 都是作为 skills的初始库 。



但是这样没有统一对齐
设想一下 如果 lead_agent 直接调通了。 后面其他agent 是不是都可以认为全部通过。
代表了方案的可行性。
开发测试的时候也只用根据一个lead_agent就可以设计好整个架构。
如果后续让你测试其他agent 你是否也会觉得困难。




比如用户说: 我想创建个合同审查智能体

1. 智能体会自行检查skills 
2. 发现有个 bootstrap 用于引导创建智能体
3. bootstrap 里面还描述了如何向用户提问澄清问题
4. 一步步引导创建 AGENTS.md 还会检查需要引入哪些现成的skill 如果没有是否需要自己创建,必要的时候还会网络检索，是否有更靠谱的方案,整个都是智能体自主执行。
5. 最后创建完成智能体 此时就要带用户跳转到已经创建好的智能体进行测试,这里需要写个测试页面,智能体接口的是统一的,只不过会传智能体名称和用的模型以及 pro 还是 ultra 等模式。这里用户可以自主配置并进行测试。
6. 用户测试过程中 可以让智能体自主提供 thread_id. 然后 直接问智能体 并提供 thread_id 和一些问题。 智能体会自主的检索 thread_id 对话内容和最终答案,并给出解决方案还可以自主优化智能体中的 AGENTS.md 或者  skill 
7. 整个过程中可反复迭代测试优化。完全自主。

这个才是未来的走向


首先我先回答你几个问题。
目前架构确实足够了,并且很多都已经实现

.openagents/{dev/prod}/{agents} 中储存智能体
以后扫描 里面 就知道有哪些智能体了。
config.yaml 做为智能体的描述。  通过skill_refs。 来决定复制哪些skill 到运行时目录
运行的时候  复制到 工作目录中。 因为已经实现了 composite 统一了路由,具体路由里面走的是 local/sandbox 这些都被隐藏了。

唯一难点就是 如何将运行过程调优好的 skill 和 AGENTS.md 如何恰当的同步到外部 .openagents/{dev/prod}/{agents} 中。  也不能随便同步,也担心会破坏。 这种隔离机制也是需要考虑的。

----------------
1. skills/ 也统一放在 .openagents 中 
2. 在实现过程中 你需要确保了解内部agent执行过程  比如 deepagent 各个middleware skills sandbox 等等 
一般来说, 当通用型agent 基础架构完成。 你也只是修改 AGENTS.md 或者 做个skills 。 后面全部都会自行加载完成。
到时候用户创建skill,顶多就是加个 common 命令 /create-skill  但是实际就是读取prompt 直接发给 agent 一句话  帮我创建个skill 使用什么 skill-creator (实际可能更标准的提示词)

整个过程完全就是一个输入框,完全交给大模型自主规划能力,agent 只是提供 工具和一些基本系统提示词。 

可以按照这个计划执行。
完成后,前端不是有个 agent 创建的快速入口吗。 以及创建skill 的地方。 看需不需要前端也修改下快速方式,实际就是自动发送 / 命令 创建agent 。
接下来打开 localhost:3000 并完成测试工作。
你需要在测试过程中 跟踪内部执行情况,agent 创建情况,skill 创建情况,后续如何进行测试。 界面效果情况,有没有bug 。然后全部进行修复完善。
