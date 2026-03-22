# 多 Agent 系统实测数据集 v1.0

本数据集专为**"一键生成型"多 Agent 协作系统**设计，包含 7 个测试用例，覆盖 4 个核心测试维度。

## 目录结构

```
agent_dataset/
├── README.md                    ← 本文件（总览）
│
├── TC-01/                       ← 多 Agent 协调测试
│   ├── input/
│   │   └── task.md              ← 直接上传给 Agent 的任务指令
│   └── expected_output/
│       └── evaluation_checklist.md  ← 评估清单（含评分标准）
│
├── TC-02/                       ← 错误恢复测试
│   ├── input/
│   │   └── task.md
│   └── expected_output/
│       └── evaluation_checklist.md
│
├── TC-03/                       ← 执行路径正确性测试
│   ├── input/
│   │   ├── task.md
│   │   └── sales_data.csv       ← ⚠️ 前置数据文件，必须与 task.md 一起上传
│   └── expected_output/
│       ├── evaluation_checklist.md
│       └── correct_answers.json ← 正确答案（含精确数字）
│
├── TC-04/                       ← 长链条约束记忆测试
│   ├── input/
│   │   └── task.md
│   └── expected_output/
│       └── evaluation_checklist.md
│
├── TC-A/                        ← 压力测试：模糊指令澄清
│   ├── input/task.md
│   └── expected_output/evaluation_checklist.md
│
├── TC-B/                        ← 压力测试：矛盾指令冲突识别
│   ├── input/task.md
│   └── expected_output/evaluation_checklist.md
│
└── TC-C/                        ← 压力测试：并发子任务合并
    ├── input/task.md
    └── expected_output/evaluation_checklist.md
```

## 测试用例速览

| 用例 | 测试维度 | 核心考察点 | 难度 |
|------|---------|-----------|------|
| **TC-01** | 多 Agent 协调 | 子 Agent 之间的数据传递是否完整（网页里有没有真实文案） | ★★★☆☆ |
| **TC-02** | 错误恢复能力 | 遇到工具报错后能否自动切换 Plan B，而不是直接崩溃 | ★★☆☆☆ |
| **TC-03** | 执行路径正确性 | 处理 1000 行 CSV 时，是写代码计算还是把数据塞进 Prompt | ★★☆☆☆ |
| **TC-04** | 任务完成率 | 长链条执行中，3 个隐性约束是否全部被记住 | ★★★☆☆ |
| **TC-A** | 澄清能力 | 收到模糊指令时，是主动澄清还是瞎猜 | ★☆☆☆☆ |
| **TC-B** | 冲突识别 | 发现指令内部矛盾时，是识别冲突还是强行执行 | ★★☆☆☆ |
| **TC-C** | 并发 + 合并 | 并发子任务的结果能否被正确合并（顺序、格式、完整性） | ★★★★☆ |

## 使用方式

### 基础测试（TC-01 ~ TC-04）
1. 进入对应用例目录的 `input/` 文件夹
2. 将该目录下的**所有文件**（task.md + 任何前置数据文件）一起上传给您的 Agent
3. Agent 执行完成后，对照 `expected_output/evaluation_checklist.md` 进行评分

### 压力测试（TC-A ~ TC-C）
1. 只需上传 `input/task.md` 给 Agent
2. 观察 Agent 的**第一轮回复**，对照评估清单评分

### ⚠️ TC-03 特别说明
TC-03 必须同时上传 `task.md` 和 `sales_data.csv`，否则 Agent 没有数据可以分析。
评分时，将 Agent 的计算结果与 `expected_output/correct_answers.json` 中的数字对比。

## 综合评分表

| 用例 | 满分 | 您的得分 | 失败原因 |
|------|------|---------|---------|
| TC-01 | 100 | | |
| TC-02 | 100 | | |
| TC-03 | 100 | | |
| TC-04 | 100 | | |
| TC-A | 100 | | |
| TC-B | 100 | | |
| TC-C | 100 | | |
| **总分** | **700** | | |

**评级**：630+ 优秀 / 490-629 良好 / 350-489 合格 / 350 以下需重点优化
