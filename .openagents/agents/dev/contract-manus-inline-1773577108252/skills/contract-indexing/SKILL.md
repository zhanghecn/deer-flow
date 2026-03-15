---
name: contract-indexing
description: 合同切分与索引技能。当用户上传合同文件并需要审查时，首先调用此技能进行合同内容的提取、切分和索引构建。支持 PDF、Word、TXT 等格式的合同文档，能够识别条款边界、章节结构，建立可查询的条款索引。这是合同审查流程的第一步。
---

# 合同切分与索引技能

## 概述

此技能负责处理用户上传的合同文件，将其转换为结构化的条款索引。这是合同审查流程的基础设施，为后续的并行审查提供数据支撑。

## 核心功能

1. **文件解析**: 从上传目录读取合同文件，支持多种格式
2. **内容提取**: 提取合同纯文本内容
3. **智能切分**: 按条款结构切分合同
4. **索引构建**: 建立结构化的条款索引

## 工作流程

### Step 1: 获取合同文件

检查 `/mnt/user-data/uploads/` 目录下的文件，识别合同文件：

- PDF 文件 (.pdf)
- Word 文档 (.docx, .doc)
- 文本文件 (.txt)
- Markdown 文件 (.md)

```bash
ls /mnt/user-data/uploads/
```

### Step 2: 提取合同内容

根据文件类型选择提取方法：

#### PDF 文件

对于 PDF 文件，先检查是否有转换后的 Markdown 版本（.md 文件），如果有则直接读取；否则使用文本提取工具：

```bash
# 检查是否有转换后的 md 文件
ls /mnt/user-data/uploads/*.md

# 如果没有，使用 pdfplumber 提取文本
python -c "
import pdfplumber
with pdfplumber.open('/mnt/user-data/uploads/contract.pdf') as pdf:
    for page in pdf.pages:
        print(page.extract_text() or '')
"
```

#### Word 文档

对于 Word 文档，检查是否有转换后的 Markdown 版本：

```bash
# 检查转换后的 md 文件
ls /mnt/user-data/uploads/*.md

# 如果需要，使用 python-docx 提取
python -c "
from docx import Document
doc = Document('/mnt/user-data/uploads/contract.docx')
for para in doc.paragraphs:
    print(para.text)
"
```

#### 文本/Markdown 文件

直接读取文件内容：

```bash
cat /mnt/user-data/uploads/contract.txt
# 或
cat /mnt/user-data/uploads/contract.md
```

### Step 3: 智能切分合同

将合同按条款结构切分为片段。切分规则：

#### 条款识别模式

识别以下常见的条款标记模式：

1. **编号条款**: 
   - 数字编号: "第X条", "第X款", "Article X", "Section X"
   - 层级编号: "一、", "二、", "1.", "2.", "(1)", "(2)"
   - 字母编号: "A.", "B.", "a)", "b)"

2. **标题条款**:
   - 带方括号的标题: "【付款条款】", "[Payment Terms]"
   - 独立行标题: "付款条款", "Payment Terms"
   - 冒号结尾: "付款条款:", "Payment Terms:"

3. **关键条款关键词**:
   - 定义条款: "定义", "Definitions"
   - 付款条款: "付款", "支付", "Payment"
   - 保密条款: "保密", "Confidentiality"
   - 违约条款: "违约", "Breach", "Default"
   - 终止条款: "终止", "Termination"
   - 争议解决: "争议", "仲裁", "诉讼", "Dispute", "Arbitration"

#### 切分策略

```
切分单位:
- 每个独立条款作为一个切分单元
- 每个章节标题作为切分边界
- 对于超长条款（超过 500 字），可进一步按段落切分

切分输出:
{
  "segment_id": "SEG_001",
  "segment_type": "条款",
  "clause_number": "第3条",
  "clause_title": "付款条款",
  "content": "条款原文内容...",
  "start_line": 45,
  "end_line": 67,
  "keywords": ["付款", "支付期限", "违约金"]
}
```

### Step 4: 构建条款索引

建立结构化的条款索引，输出为 JSON 格式：

```json
{
  "contract_info": {
    "file_name": "contract.pdf",
    "total_segments": 25,
    "total_characters": 15000,
    "index_timestamp": "2024-01-15T10:30:00Z"
  },
  "segments": [
    {
      "segment_id": "SEG_001",
      "segment_type": "章节",
      "clause_number": "第一章",
      "clause_title": "总则",
      "content": "...",
      "start_line": 1,
      "end_line": 10,
      "keywords": ["总则", "目的", "适用范围"]
    },
    {
      "segment_id": "SEG_002",
      "segment_type": "条款",
      "clause_number": "第1条",
      "clause_title": "定义",
      "content": "...",
      "start_line": 11,
      "end_line": 25,
      "keywords": ["定义", "合同双方", "服务内容"]
    }
  ],
  "clause_index": {
    "付款条款": ["SEG_005", "SEG_006"],
    "违约条款": ["SEG_010", "SEG_011"],
    "终止条款": ["SEG_015"],
    "争议解决": ["SEG_020", "SEG_021"]
  }
}
```

### Step 5: 保存索引文件

将索引保存到工作目录，供后续审查使用：

```bash
# 保存到工作目录
cat > /mnt/user-data/workspace/contract_index.json << 'EOF'
{索引内容...}
EOF
```

## 输出

完成索引构建后，输出以下信息：

1. **合同基本信息**: 文件名、总字符数、总条款数
2. **条款分类统计**: 各类型条款的数量分布
3. **索引文件路径**: `/mnt/user-data/workspace/contract_index.json`
4. **切分片段预览**: 前 3-5 个片段的内容摘要

## 注意事项

- 对于扫描版 PDF，需要先进行 OCR 处理
- 保持条款原文的完整性，不得修改或省略内容
- 对于双语合同，优先保留原文，同时保留译文
- 索引必须包含精确的行号定位，便于后续引用