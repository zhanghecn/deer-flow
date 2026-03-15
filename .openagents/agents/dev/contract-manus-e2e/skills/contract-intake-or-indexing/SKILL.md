# Contract Intake & Indexing Skill

## 技能描述
合同摄入与索引构建 - 处理超长合同的分块、索引和结构化映射

## 触发条件
- 收到合同审查请求
- 输入为合同文件或合同 URL
- 在任何审查开始前必须执行

## 输入规格

```yaml
inputs:
  contract_source:
    type: file | url
    required: true
    description: 合同文件路径或 URL
  perspective:
    type: string
    default: buyer
    options: [buyer, seller]
    description: 审查视角
  contract_name:
    type: string
    required: false
    description: 合同名称（可选，用于报告标题）
```

## 处理流程

### Phase 1: 合同获取

#### 1.1 文件输入处理
```
如果输入是文件：
  - 检测文件格式（PDF/DOCX/TXT/MD）
  - 读取文件内容
  - 保存到 /mnt/user-data/workspace/contract-review/source/contract.{ext}
```

#### 1.2 URL 输入处理
```
如果输入是 URL：
  - 使用 web_fetch 抓取内容
  - 保存到 /mnt/user-data/workspace/contract-review/source/contract_from_url.{ext}
  - 记录源 URL 和抓取时间
```

### Phase 2: 合同分块（Chunking）

#### 2.1 分块策略
```
分块原则：
1. 按章节/条款自然分割
2. 每块不超过 3000 字符（预留上下文空间）
3. 保持条款完整性，不在条款中间断开
4. 保留块之间的关联信息
```

#### 2.2 分块执行
```python
# 伪代码示意
chunks = []
for section in contract_sections:
    if len(section) <= 3000:
        chunks.append(section)
    else:
        # 子分块，保持语义边界
        sub_chunks = split_by_clause(section, max_size=3000)
        chunks.extend(sub_chunks)

# 保存分块
for i, chunk in enumerate(chunks):
    save_to(f"/mnt/user-data/workspace/contract-review/chunks/chunk_{i:04d}.md", chunk)
```

#### 2.3 分块元数据
```json
{
  "total_chunks": 42,
  "chunk_size_limit": 3000,
  "sections_detected": ["定义", "价格与付款", "保密条款", ...],
  "estimated_tokens": 15000
}
```

### Phase 3: 索引构建

#### 3.1 条款索引 (clause_index.json)
```json
{
  "clauses": [
    {
      "id": "C001",
      "name": "定义",
      "section_number": "1",
      "chunk_ids": ["chunk_0000", "chunk_0001"],
      "keywords": ["定义", "术语", "解释"],
      "key_terms": ["甲方", "乙方", "服务", "产品"]
    },
    {
      "id": "C002",
      "name": "价格与付款",
      "section_number": "3",
      "chunk_ids": ["chunk_0005", "chunk_0006"],
      "keywords": ["价格", "付款", "费用", "结算"],
      "key_terms": ["合同金额", "付款方式", "发票"]
    }
  ],
  "clause_types": {
    "definition": ["C001"],
    "payment": ["C002"],
    "confidentiality": ["C007"],
    "termination": ["C012"]
  }
}
```

#### 3.2 章节映射 (section_map.json)
```json
{
  "sections": [
    {
      "id": "S001",
      "number": "1",
      "title": "定义与解释",
      "level": 1,
      "start_chunk": "chunk_0000",
      "end_chunk": "chunk_0001",
      "parent": null,
      "children": ["S002"]
    },
    {
      "id": "S002",
      "number": "1.1",
      "title": "定义",
      "level": 2,
      "start_chunk": "chunk_0000",
      "end_chunk": "chunk_0000",
      "parent": "S001"
    }
  ],
  "section_hierarchy": {
    "total_sections": 25,
    "max_depth": 3
  }
}
```

#### 3.3 交叉引用映射 (cross_reference_map.json)
```json
{
  "cross_references": [
    {
      "id": "XR001",
      "source_clause": "C005",
      "source_text": "如第3.2条所述...",
      "target_clause": "C003",
      "target_section": "3.2",
      "reference_type": "definition_reference"
    },
    {
      "id": "XR002",
      "source_clause": "C008",
      "source_text": "根据第6条保密条款...",
      "target_clause": "C007",
      "target_section": "6",
      "reference_type": "clause_reference"
    }
  ],
  "reference_types": {
    "definition_reference": 15,
    "clause_reference": 23,
    "external_reference": 5
  }
}
```

### Phase 4: 审查包生成

#### 4.1 审查包结构
```json
{
  "packet_id": "PKT_payment",
  "theme": "价格与付款",
  "perspective": "buyer",
  "chunks": ["chunk_0005", "chunk_0006", "chunk_0007"],
  "related_clauses": ["C002", "C003"],
  "cross_references": ["XR005", "XR008"],
  "review_focus": [
    "付款条件是否合理",
    "是否存在隐性费用",
    "发票与税费约定",
    "付款安全措施"
  ],
  "risk_checklist": [
    "付款比例是否有利于甲方",
    "验收后付款的保障",
    "违约扣款机制"
  ]
}
```

#### 4.2 审查包清单
```
/mnt/user-data/workspace/contract-review/review_packets/
├── pkt_001_subject_eligibility.json  # 主体资格
├── pkt_002_definitions.json          # 定义
├── pkt_003_payment.json              # 价格与付款
├── pkt_004_invoice_tax.json          # 发票/税费
├── pkt_005_sla_acceptance.json       # SLA/验收
├── pkt_006_change_control.json       # 变更控制
├── pkt_007_ip_rights.json            # 知识产权
├── pkt_008_confidentiality.json      # 保密
├── pkt_009_data_processing.json      # 数据处理
├── pkt_010_ai_data_rights.json       # AI/数据使用权
├── pkt_011_representations.json      # 陈述保证
├── pkt_012_indemnification.json     # 赔偿
├── pkt_013_limitation_liability.json # 责任限制
├── pkt_014_disclaimer.json           # 免责
├── pkt_015_term_renewal.json         # 期限/续约
├── pkt_016_termination.json         # 终止
├── pkt_017_exit_assistance.json      # 退出协助
├── pkt_018_governing_law.json        # 适用法律
├── pkt_019_dispute_resolution.json   # 争议解决
├── pkt_020_audit.json                # 审计
└── pkt_021_compliance.json           # 合规
```

## 输出规格

```yaml
outputs:
  chunks_dir:
    path: /mnt/user-data/workspace/contract-review/chunks/
    description: 分块后的合同片段
  indexes_dir:
    path: /mnt/user-data/workspace/contract-review/indexes/
    files:
      - clause_index.json
      - section_map.json
      - cross_reference_map.json
  review_packets_dir:
    path: /mnt/user-data/workspace/contract-review/review_packets/
    description: 按主题组织的审查包
  intake_summary:
    path: /mnt/user-data/workspace/contract-review/intake_summary.json
    content:
      contract_name: string
      total_chunks: integer
      total_sections: integer
      total_clauses: integer
      total_packets: integer
      estimated_review_time: string
      perspective: buyer | seller
```

## 状态报告

完成 intake 后，输出简报：

```markdown
## 合同摄入完成

- **合同名称**：{contract_name}
- **总字数**：{total_chars}
- **分块数量**：{total_chunks} 块
- **识别章节**：{total_sections} 个
- **条款索引**：{total_clauses} 条
- **审查包**：{total_packets} 个
- **预估审查时间**：{estimated_time}
- **审查视角**：{perspective}

准备进入审查阶段...
```

## 错误处理

| 错误场景 | 处理方式 |
|---------|---------|
| 文件无法读取 | 报告错误，请求重新上传 |
| URL 无法访问 | 重试 3 次，失败后请求直接上传 |
| 格式不支持 | 转换或请求其他格式 |
| 合同结构异常 | 尝试恢复，记录异常 |

## 依赖

- web_fetch（URL 抓取）
- 文件系统操作
- 文本分析能力