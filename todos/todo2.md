使用有头模式,打开 http://localhost:3000 作为用户测试agent。

输入 派发subagent,从[A股]收集数据后。并创建报告。 要求PPT文件
测试 agent 任务规划 task 调用 各个工具的使用 并检查最终任务产物,并能够进行预览。
测试过程中如果发现错误,请找到原因并修复。


除此之外,你还要检查 后端trace 日志,以及打开 http://localhost:5173/observability  观察流程是否正确。
目前我自己通过 http://localhost:5173/observability 发现几个问题。
1. 很多重复内容,点击的每个事件查看都发现重复的内容,不能很直观,让我不知道如何去看。
2. 没有看到思考部分内容
3. 点击节点展开详情后,每一块内容区分不明显,不知道每一块是做什么的。
4. 在检查工具调用中的响应内容,比如read 工具 发现响应内容被截取掉了 不知道是实际工具被截取  还是数据库储存被截取 或者说页面显示被截取了这个需要排查


测试过程中出现 文生图skill 使用不成功都是正常情况,因为我还没有买apikey。 但是你可以检查执行过程中环境变量是不是有对于key环境。
账号密码是 admin admin123


了解清楚
我的项目多agent。 AGENTS.md skills 加载。 deepagent 后端协议(local/sandbox/remote) 工具执行。
以及agent 实际执行过程中 工具使用的路径,对于 local协议是为了本地调试。 真正生产环境都是在 sandbox 中。
agent 内部的路径是统一的,外面路径映射虽然不一样,但对于内部agent 来说都是一致的路径。
了解清楚后记录这次规范和架构说明,避免下次再犯。
然后在检查skills 中路径是否被破坏。


现在我需要一个更加完善得生图skill。 
读取文档
https://www.volcengine.com/docs/82379/1541523?lang=zh
集成 doubao-seedream-5.0-lite 文生图 图生图的方式
下面是为的key:
32a0e8cb-ffa6-4687-96fd-5da2da9d73df

由于目前用的是 /home/zhangxuan/project/ai/deer-flow/.openagents/skills/shared/image-generation/scripts/generate.py 但是我没有 GEMINI_API_KEY 。 帮我自主测试 并维护到里面 以及 对应的环境key。







现在skill 储存有3个渠道  shared dev/prod 
以及每个 agent 运行时 skill。
shared 是所有agent 都可以使用的。
dev/prod 分为开发/生成 agent 使用的。
每个agent 都可以独立配置拥有的 skill 。

目前感觉过于复杂了。 本来想的是 dev/prod agent 只能用 dev/prod 的skill 。

实际只用 dev/prod 。
为什么之前弄的那么复杂？
之前想的是 dev/prod agent 只能用对应 dev/prod skill。
但是实际 dev/prod agent 和 dev/prod skill 是分开的。
dev agent 也能使用 prod skill 

# 功能变更
1. dev agent 在选择skill 的时候 可以共用 dev prod 只不过禁止使用重名的skill。
2. 对于 prod agent 在确保 使用的skill 必须 prod skill。

# 功能新增
所有skill 可以使用 $skill_name  快速引用,类似目前 / 命令

# 测试以及修复
你需要作为用户 打开浏览器 访问 http://localhost:3000 
账号密码 admin admin123 

接下来就是全面测试:
通过 find-skill 尝试从
设计 视频 写作 编程 等各个方面找出skill  
1. 测试 skill 是否自动安装在 dev 中
2. 接下来 通过 lead_agent 使用 /create-agent 创建相应的agent 看看是否会推荐使用一些 skill 自动配置
3. 创建完后 应该会推荐进行测试创建的agent,跳转创建后的agent提供数据/文件 进行测试
4. 测试完后 检查下 skill AGENTS.md 有没有问题
5. 如果有问题,请不要自己改 skill 和 AGENTS.md 接下来就是进行更深层的测试 在 dev 模型下的 agent 可以自主修复 AGENTS.md 和 skill 你需要反复问 让其自主修改
6. 如果无法自主修改正确 请检查原因


内部审查是必须的,有些时候agent 表达行为不正确,你不能随意猜测


你可以访问 http://localhost:5173  对于agent 内部检查内部执行状态 

如果遇到生成/编辑视频skill需要使用的到gemini 
你可以转换成 doubao-seedance-2-0-260128
参考
https://www.volcengine.com/docs/82379/1520757?lang=zh


 一律使用 kimi ultra 模式。用kimi 应该速度会更快点 ultra 功能更全 。

# 功能修正
1. 目前 模式有 闪速,思考,Pro,Ultra 太多了。 
都允许自规划和subagent  只分 闪速(不思考)和Pro(就是Ultra) 
2. 输入 $选出有哪些技能可用无法上下选择分页,目前选择页面直接铺面不美观
3. 
# 目前我测试发现的问题
1. 我发现当模型出现错误不会重试 如Connection error 或者 429 速率问题,你去看看langchain deepagent 规范看看如何进行重试。
2. 还有一点出错后 前端没有提示。
3. 执行subagent 前端显示不美观,字迹不清晰。 并且一直提示 子任务运行中 哪怕已经完成
4. 任务执行一半 点击取消,在重新规划
是的 但还有一点你没考虑到。  
我的项目做出的agent 发在prod 后可被任意地方调用。 
比如业务部门当生成合同审查agent 发布在prod 那么不应该在我平台使用了。 
而是可以导出成api 随意被使用。
导出api 还应该提供 演示demo 直接在agent 点击下载demo 
里面会有一个 react demo 项目 自动填写好 链接地址 以及 token 可脱离平台进行本地化测试

你作为用户你会如何使用？
你作为用户你会给这个项目提出什么建议？
