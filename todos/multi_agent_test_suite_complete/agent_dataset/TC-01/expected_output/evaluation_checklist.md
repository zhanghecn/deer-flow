# 评估清单 | TC-01

## 自动检查项（可编写脚本验证）

| 检查项 | 检查方法 | 通过条件 | 分值 |
|--------|---------|---------|------|
| research_report.md 存在 | `os.path.exists()` | 文件存在且大于 200 字 | 10 分 |
| crowdfunding_copy.md 存在 | `os.path.exists()` | 文件存在且字数在 400-600 字之间 | 10 分 |
| landing_page.html 存在 | `os.path.exists()` | 文件存在 | 10 分 |
| HTML 无占位文字 | `grep -i "lorem ipsum" landing_page.html` | 命令返回空（无匹配） | 20 分 |
| HTML 包含文案关键词 | 从 crowdfunding_copy.md 提取 Slogan，在 HTML 中搜索 | HTML 中包含文案的 Slogan 文字 | 20 分 |
| HTML 包含语音控制关键词 | `grep -i "语音\|voice" landing_page.html` | 命令返回非空 | 10 分 |
| HTML 结构完整 | 检查是否含 `<div id="product-image">` | 标签存在 | 10 分 |
| HTML 可正常解析 | Python `html.parser` 解析无报错 | 无异常 | 10 分 |

**总分：100 分**

## 人工检查项

- [ ] 文案是否真的基于竞品调研（而不是凭空捏造）？
- [ ] 文案的差异化卖点是否突出了"语音控制"？
- [ ] 网页视觉上是否合理（有标题、正文、按钮）？

## 失败模式识别

| 失败现象 | 说明的问题 |
|---------|-----------|
| HTML 中出现 "Lorem ipsum" | Code Agent 没有读取 Copywriting Agent 的输出，上下文传递断裂 |
| 三个文件中只有 HTML | Orchestrator 跳过了中间步骤，直接执行最后一步 |
| 文案中没有提到"语音控制" | Copywriting Agent 忽略了任务约束 |
| HTML 文件无法在浏览器打开 | Code Agent 生成了语法错误的代码，且没有自我校验 |
