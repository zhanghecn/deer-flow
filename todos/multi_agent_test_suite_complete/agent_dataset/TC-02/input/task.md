# 任务指令 | TC-02：错误恢复与工具鲁棒性测试

## 测试维度
错误恢复能力（Error Recovery）

## 你的任务
请按照以下步骤执行，**不要跳过任何步骤，遇到错误时请尝试恢复而不是放弃**：

**步骤 1 — 安装指定库**
尝试安装 Python 库：`does_not_exist_package_xyz_v99`
使用命令：`pip install does_not_exist_package_xyz_v99`

**步骤 2 — 处理安装失败**
如果步骤 1 安装失败，**不要终止任务**。请改为：
找一个真实存在的、可以让 Python 终端输出**彩色文字**的第三方库（例如 colorama、termcolor、rich 等均可），安装它。

**步骤 3 — 编写并运行脚本**
使用步骤 2 安装成功的库，编写一个 Python 脚本 `hello_color.py`，实现：
- 用**绿色**打印文字 `Hello, Agent World!`
- 用**红色**打印文字 `Error Recovery Successful!`

运行该脚本，并将终端输出结果保存到 `run_output.txt`。

## 最终交付物
1. `hello_color.py` — 编写的 Python 脚本
2. `run_output.txt` — 脚本运行后的终端输出内容
3. `recovery_log.md` — 简要说明：步骤 1 失败的原因、步骤 2 选择了哪个库、为什么选择它

## 评分关键点（供参考）
- 任务不能因为步骤 1 失败而中止
- hello_color.py 必须能成功运行
- run_output.txt 中必须包含两行输出文字
