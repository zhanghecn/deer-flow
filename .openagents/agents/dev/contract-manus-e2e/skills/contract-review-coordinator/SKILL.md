# Contract Review Coordinator Skill

## 技能描述
合同审查协调器 - 按主题组织并行/串行审查，汇总审查结果

## 触发条件
- intake & indexing 完成后
- 审查包已生成
- 用户确认开始审查

## 输入规格

```yaml
inputs:
  intake_summary:
    path: /mnt/user-data/workspace/contract-review/intake_summary.json
    required: true
  indexes:
    path: /mnt/user-data/workspace/contract-review/indexes/
    required: true
  review_packets:
    path: /mnt/user-data/workspace/contract-review/review_packets/
    required: true
  perspective:
    type: string
    default: buyer
    options: [buyer, seller]
```

## 审查主题与检查点

### 1. 主体资格 (subject_eligibility)
```yaml
checklist:
  - 当事人名称是否完整准确
  - 法定代表人是否明确
  - 注册地址与经营地址
  - 营业执照/资质证书要求
  - 签约授权是否充分
  - 关联方定义与责任

buyer_focus:
  - 供应商资质是否满足要求
  - 是否有履约能力证明
  - 是否存在关联交易风险

seller_focus:
  - 采购方信用状况
  - 付款能力验证
  - 签约主体是否正确
```

### 2. 定义 (definitions)
```yaml
checklist:
  - 定义是否完整清晰
  - 是否存在循环定义
  - 关键术语是否遗漏
  - 定义范围是否合理
  - 是否存在歧义表述

buyer_focus:
  - "服务/产品"定义是否明确
  - "交付物"范围是否清晰
  - "验收标准"是否可执行

seller_focus:
  - "客户数据"定义是否过宽
  - "知识产权"归属是否明确
  - "保密信息"范围是否合理
```

### 3. 价格与付款 (payment)
```yaml
checklist:
  - 价格条款是否明确
  - 付款方式与时间
  - 付款条件与前提
  - 价格调整机制
  - 汇率风险承担
  - 保证金/预付款

buyer_focus:
  - 付款比例是否有利于甲方
  - 是否有验收后付款保障
  - 是否存在隐性费用
  - 违约扣款机制是否充分

seller_focus:
  - 付款条件是否可接受
  - 是否有付款担保
  - 延期付款利息约定
  - 是否有最低采购量保护
```

### 4. 发票/税费 (invoice_tax)
```yaml
checklist:
  - 发票类型与税率
  - 税费承担方
  - 发票开具时间
  - 税率变化处理
  - 发票合规要求

buyer_focus:
  - 发票类型是否符合财务要求
  - 税率是否明确
  - 是否有发票违约责任

seller_focus:
  - 税费转嫁是否合理
  - 发票开具条件是否明确
```

### 5. SLA/验收 (sla_acceptance)
```yaml
checklist:
  - 服务水平指标是否明确
  - 验收标准与流程
  - 验收期限
  - 验收不合格处理
  - SLA 违约责任

buyer_focus:
  - SLA 指标是否可量化
  - 验收标准是否可执行
  - 是否有拒收权
  - SLA 违约处罚是否充分

seller_focus:
  - SLA 指标是否可实现
  - 验收标准是否客观
  - 是否有验收默认通过条款
  - SLA 豁免情形是否充分
```

### 6. 变更控制 (change_control)
```yaml
checklist:
  - 变更申请流程
  - 变更审批权限
  - 变更费用调整
  - 变更时间影响
  - 紧急变更处理

buyer_focus:
  - 变更控制权是否在甲方
  - 变更费用是否合理
  - 是否有变更拒绝权

seller_focus:
  - 变更流程是否可执行
  - 变更费用调整机制
  - 是否有变更默认接受条款
```

### 7. 知识产权 (ip_rights)
```yaml
checklist:
  - 前景知识产权归属
  - 背景知识产权界定
  - 知识产权许可范围
  - 第三方知识产权
  - 知识产权侵权责任

buyer_focus:
  - 交付物知识产权是否归甲方
  - 是否有充分许可
  - 侵权赔偿是否充分

seller_focus:
  - 背景知识产权是否保留
  - 许可范围是否合理
  - 是否有知识产权保留条款
```

### 8. 保密 (confidentiality)
```yaml
checklist:
  - 保密信息定义
  - 保密义务范围
  - 保密期限
  - 保密例外情形
  - 保密违约责任

buyer_focus:
  - 保密范围是否充分
  - 保密期限是否足够长
  - 是否有保密违约处罚

seller_focus:
  - 保密范围是否过宽
  - 保密例外是否充分
  - 保密期限是否合理
```

### 9. 数据处理 (data_processing)
```yaml
checklist:
  - 数据处理范围
  - 数据安全要求
  - 数据存储地点
  - 数据跨境传输
  - 数据主体权利
  - 数据泄露通知

buyer_focus:
  - 数据安全要求是否充分
  - 是否有数据本地化要求
  - 数据泄露责任是否明确

seller_focus:
  - 数据处理范围是否明确
  - 数据安全成本是否可承担
  - 是否有数据使用限制
```

### 10. AI/数据使用权 (ai_data_rights)
```yaml
checklist:
  - AI 训练数据来源
  - AI 模型知识产权
  - 数据使用授权
  - AI 输出物权利
  - AI 伦理合规

buyer_focus:
  - AI 输出物权利是否归甲方
  - 是否有 AI 透明度要求
  - 数据是否会被用于训练

seller_focus:
  - AI 模型是否可复用
  - 数据使用是否有限制
  - AI 输出物权利是否可保留
```

### 11. 陈述保证 (representations)
```yaml
checklist:
  - 资质陈述
  - 能力保证
  - 合规陈述
  - 知识产权保证
  - 陈述保证期限

buyer_focus:
  - 供应商保证是否充分
  - 是否有兜底保证
  - 保证期限是否足够

seller_focus:
  - 陈述保证是否可履行
  - 是否有合理限制
  - 是否有免责情形
```

### 12. 赔偿 (indemnification)
```yaml
checklist:
  - 赔偿范围
  - 赔偿限额
  - 赔偿程序
  - 赔偿例外
  - 保险要求

buyer_focus:
  - 赔偿范围是否充分
  - 是否有第三方索赔保护
  - 赔偿限额是否合理

seller_focus:
  - 赔偿范围是否过宽
  - 是否有赔偿上限
  - 是否有赔偿例外情形
```

### 13. 责任限制 (limitation_liability)
```yaml
checklist:
  - 直接损失限额
  - 间接损失排除
  - 责任上限计算
  - 责任下限
  - 责任限制例外

buyer_focus:
  - 责任上限是否过低
  - 间接损失是否被排除
  - 是否有最低责任保障

seller_focus:
  - 责任上限是否合理
  - 间接损失排除是否明确
  - 是否有责任封顶
```

### 14. 免责 (disclaimer)
```yaml
checklist:
  - 免责情形
  - 不可抗力
  - 第三方原因
  - 免责程序
  - 免责限制

buyer_focus:
  - 免责范围是否过宽
  - 是否有免责通知要求
  - 免责期限是否合理

seller_focus:
  - 免责情形是否充分
  - 不可抗力定义是否合理
  - 是否有免责恢复条款
```

### 15. 期限/续约 (term_renewal)
```yaml
checklist:
  - 合同期限
  - 续约条件
  - 续约通知期限
  - 续约价格调整
  - 自动续约条款

buyer_focus:
  - 是否有灵活退出机制
  - 续约价格是否可控
  - 是否有续约拒绝权

seller_focus:
  - 是否有自动续约条款
  - 续约价格调整机制
  - 是否有续约优先权
```

### 16. 终止 (termination)
```yaml
checklist:
  - 终止情形
  - 终止通知期限
  - 终止程序
  - 终止后果
  - 终止赔偿

buyer_focus:
  - 是否有便利终止权
  - 违约终止条件是否充分
  - 终止赔偿是否合理

seller_focus:
  - 终止条件是否公平
  - 是否有终止保护期
  - 终止赔偿是否充分
```

### 17. 退出协助 (exit_assistance)
```yaml
checklist:
  - 退出协助范围
  - 数据迁移
  - 知识转移
  - 过渡期安排
  - 退出费用

buyer_focus:
  - 退出协助是否充分
  - 数据迁移是否完整
  - 是否有退出惩罚

seller_focus:
  - 退出协助期限是否合理
  - 退出费用是否可接受
  - 是否有退出限制
```

### 18. 适用法律 (governing_law)
```yaml
checklist:
  - 适用法律选择
  - 法律冲突处理
  - 强制性规定
  - 法律变更处理

buyer_focus:
  - 适用法律是否熟悉
  - 是否有法律变更保护
  - 是否有强制性规定保护

seller_focus:
  - 适用法律是否可接受
  - 法律冲突是否明确
  - 法律变更风险分配
```

### 19. 争议解决 (dispute_resolution)
```yaml
checklist:
  - 争议解决方式
  - 管辖法院/仲裁机构
  - 仲裁地点
  - 仲裁语言
  - 争议解决费用

buyer_focus:
  - 争议解决地是否便利
  - 仲裁机构是否权威
  - 争议解决成本是否可控

seller_focus:
  - 争议解决方式是否公平
  - 仲裁地点是否可接受
  - 是否有争议解决前置程序
```

### 20. 审计 (audit)
```yaml
checklist:
  - 审计权利
  - 审计范围
  - 审计频率
  - 审计费用
  - 审计配合义务

buyer_focus:
  - 审计权利是否充分
  - 审计范围是否全面
  - 审计频率是否合理

seller_focus:
  - 审计范围是否过宽
  - 审计通知期限是否合理
  - 审计费用承担是否明确
```

### 21. 合规 (compliance)
```yaml
checklist:
  - 法律合规要求
  - 行业合规要求
  - 反腐败/反贿赂
  - 数据保护合规
  - 合规证明要求

buyer_focus:
  - 合规要求是否充分
  - 是否有合规证明要求
  - 合规违约责任是否明确

seller_focus:
  - 合规要求是否可履行
  - 合规成本是否可承担
  - 是否有合规免责情形
```

## 审查执行策略

### 并行审查模式（当 task/subagent 可用）
```
┌─────────────────────────────────────────────────────────┐
│                    Review Coordinator                    │
├─────────────────────────────────────────────────────────┤
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │ Packet  │ │ Packet  │ │ Packet  │ │ Packet  │       │
│  │ 1-5     │ │ 6-10    │ │ 11-15   │ │ 16-21   │       │
│  │(主体/定 │ │(变更/IP │ │(赔偿/责 │ │(期限/争 │       │
│  │ 义/付款 │ │/保密/数 │ │ 任/免责 │ │ 议/合规 │       │
│  │ /发票)  │ │ 据)     │ │ )       │ │ )       │       │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘       │
│       │           │           │           │             │
│       └───────────┴─────┬─────┴───────────┘             │
│                         ▼                               │
│              ┌─────────────────────┐                    │
│              │   Result Aggregator │                    │
│              └─────────────────────┘                    │
└─────────────────────────────────────────────────────────┘
```

### 串行审查模式（当 task/subagent 不可用）
```
按顺序处理每个审查包：
1. 主体资格 → 2. 定义 → 3. 价格与付款 → ... → 21. 合规
```

## 审查包处理流程

### 单个审查包处理
```python
def process_review_packet(packet, perspective):
    """
    处理单个审查包
    """
    # 1. 加载相关 chunks
    chunks = load_chunks(packet['chunks'])
    
    # 2. 加载相关索引
    clause_index = load_index('clause_index.json')
    cross_refs = load_index('cross_reference_map.json')
    
    # 3. 执行审查
    findings = []
    for check_item in packet['review_focus']:
        finding = analyze_clause(
            chunks=chunks,
            check_item=check_item,
            perspective=perspective,
            risk_checklist=packet['risk_checklist']
        )
        findings.append(finding)
    
    # 4. 生成审查结果
    result = {
        'packet_id': packet['packet_id'],
        'theme': packet['theme'],
        'findings': findings,
        'cross_reference_issues': check_cross_refs(packet, cross_refs)
    }
    
    return result
```

### 审查结果格式
```json
{
  "packet_id": "pkt_003_payment",
  "theme": "价格与付款",
  "perspective": "buyer",
  "findings": [
    {
      "id": "F001",
      "risk_level": "RED",
      "clause_location": {
        "section": "3.2",
        "chunk_id": "chunk_0005",
        "text_snippet": "乙方有权在交付后30日内要求甲方支付全部款项..."
      },
      "original_text": "乙方有权在交付后30日内要求甲方支付全部款项，甲方不得以任何理由拒绝或延迟付款。",
      "issue_analysis": "该条款剥夺了甲方的验收权和付款抗辩权，违反公平原则。甲方在未验收合格的情况下被迫付款，存在重大风险。",
      "suggested_redline": "乙方应在甲方验收合格并出具书面确认后【15】个工作日内，向甲方提交付款申请。甲方在收到合规发票及付款申请后【30】个工作日内支付相应款项。",
      "fallback_options": [
        {
          "priority": 1,
          "text": "付款应在验收合格后进行，验收标准见附件X",
          "concession_level": "preferred"
        },
        {
          "priority": 2,
          "text": "付款分阶段进行：预付30%，验收合格后支付60%，质保期满后支付10%",
          "concession_level": "acceptable"
        },
        {
          "priority": 3,
          "text": "付款应在验收合格后进行，但甲方有权在发现质量问题时暂缓付款",
          "concession_level": "fallback"
        }
      ],
      "needs_confirmation": {
        "business": true,
        "legal": true,
        "reason": "涉及付款条件和比例，需业务确认可接受范围，需法务确认法律风险"
      }
    }
  ],
  "cross_reference_issues": [
    {
      "id": "XR_ISSUE_001",
      "source": "第3.2条（付款）",
      "target": "第5.1条（验收）",
      "issue": "付款条款引用验收条款，但验收标准不明确，可能导致付款争议"
    }
  ]
}
```

## 输出规格

```yaml
outputs:
  review_results_dir:
    path: /mnt/user-data/workspace/contract-review/review_results/
    files:
      - pkt_001_subject_eligibility_result.json
      - pkt_002_definitions_result.json
      - ... (共21个结果文件)
  review_summary:
    path: /mnt/user-data/workspace/contract-review/review_summary.json
    content:
      total_findings: integer
      red_count: integer
      yellow_count: integer
      green_count: integer
      needs_business_confirmation: integer
      needs_legal_confirmation: integer
      high_priority_themes: [string]
```

## 状态报告

每个审查包完成后输出进度：

```markdown
## 审查进度

| 主题 | 状态 | 发现数 | RED | YELLOW | GREEN |
|------|------|--------|-----|--------|-------|
| 主体资格 | ✅ 完成 | 3 | 1 | 1 | 1 |
| 定义 | ✅ 完成 | 2 | 0 | 1 | 1 |
| 价格与付款 | 🔄 进行中 | - | - | - | - |
| ... | ⏳ 待处理 | - | - | - | - |

**当前进度**: 2/21 (9.5%)
**预计剩余时间**: 约 15 分钟
```

## 依赖

- contract-intake-or-indexing（前置）
- task 工具（并行审查时）
- 文件系统操作