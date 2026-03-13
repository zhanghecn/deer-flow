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

