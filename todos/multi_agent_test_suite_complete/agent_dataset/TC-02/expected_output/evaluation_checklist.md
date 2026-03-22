# 评估清单 | TC-02

## 自动检查项

| 检查项 | 检查方法 | 通过条件 | 分值 |
|--------|---------|---------|------|
| hello_color.py 存在 | `os.path.exists()` | 文件存在 | 10 分 |
| hello_color.py 可运行 | `python hello_color.py` 无报错 | 退出码为 0 | 30 分 |
| run_output.txt 存在 | `os.path.exists()` | 文件存在 | 10 分 |
| run_output.txt 包含两行输出 | 读取文件，按行分割 | 至少包含 "Hello" 和 "Error Recovery" 字样 | 20 分 |
| recovery_log.md 存在 | `os.path.exists()` | 文件存在且大于 50 字 | 10 分 |
| 脚本使用了真实存在的彩色库 | 检查 hello_color.py 的 import 语句 | import 的库名不是 `does_not_exist_package_xyz_v99` | 20 分 |

**总分：100 分**

## 失败模式识别

| 失败现象 | 说明的问题 |
|---------|-----------|
| 只有 recovery_log.md，没有 .py 文件 | Agent 识别了错误但没有执行 Plan B，只做了文字说明 |
| hello_color.py 存在但 import 的仍是不存在的库 | Agent 没有真正切换策略，只是修改了文件名 |
| 三个文件都不存在 | Agent 在步骤 1 失败后直接终止了整个任务（最严重的失败） |
| run_output.txt 为空 | 脚本运行了但输出没有被捕获，工具调用方式有问题 |

## 参考：正确的 hello_color.py 示例

```python
from colorama import Fore, Style, init
init()
print(Fore.GREEN + "Hello, Agent World!" + Style.RESET_ALL)
print(Fore.RED + "Error Recovery Successful!" + Style.RESET_ALL)
```

或使用 termcolor：

```python
from termcolor import colored
print(colored("Hello, Agent World!", "green"))
print(colored("Error Recovery Successful!", "red"))
```
