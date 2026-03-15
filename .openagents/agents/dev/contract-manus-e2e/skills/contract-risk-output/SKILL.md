# Contract Risk Output Skill

## 技能描述
合同风险报告生成 - 汇总审查结果，生成结构化风险报告

## 触发条件
- 所有审查包处理完成
- 审查结果已汇总

## 输入规格

```yaml
inputs:
  review_results:
    path: /mnt/user-data/workspace/contract-review/review_results/
    required: true
  review_summary:
    path: /mnt/user-data/workspace/contract-review/review_summary.json
    required: true
  intake_summary:
    path: /mnt/user-data/workspace/contract-review/intake_summary.json
    required: true
  indexes:
    path: /mnt/user-data/workspace/contract-review/indexes/
    required: true
  perspective:
    type: string
    default: buyer
```

## 输出格式

### 报告结构

```markdown
# 合同审查报告

## 报告概要

| 项目 | 内容 |
|------|------|
| 合同名称 | {contract_name} |
| 审查日期 | {review_date} |
| 审查视角 | {perspective} |
| 审查范围 | {review_scope} |

## 风险概览

| 风险等级 | 数量 | 占比 |
|----------|------|------|
| 🔴 RED | {red_count} | {red_pct}% |
| 🟡 YELLOW | {yellow_count} | {yellow_pct}% |
| 🟢 GREEN | {green_count} | {green_pct}% |

## 重点风险提示

{top_3_risks}

---

## 详细审查结果

### 1. 主体资格

{subject_eligibility_findings}

### 2. 定义

{definitions_findings}

... (共21个主题)

---

## 交叉引用问题

{cross_reference_issues}

---

## 建议行动计划

### 立即处理（RED 风险）

{immediate_actions}

### 近期处理（YELLOW 风险）

{near_term_actions}

### 持续关注（GREEN 风险）

{ongoing_monitoring}

---

## 待确认事项

### 需业务确认

{business_confirmations}

### 需法务确认

{legal_confirmations}

---

## 附录

### A. 审查依据

{review_basis}

### B. 术语说明

{glossary}

### C. 风险等级定义

| 等级 | 定义 | 处理建议 |
|------|------|----------|
| 🔴 RED | 重大风险，可能导致严重损失或法律风险 | 必须修改，不接受当前条款 |
| 🟡 YELLOW | 中等风险，存在潜在问题需关注 | 建议修改，可接受 fallback |
| 🟢 GREEN | 低风险或无问题 | 条款合理，可接受 |

---

*报告生成时间: {generated_at}*
*审查智能体版本: contract-manus-e2e v1.0.0*
```

### 单个发现格式

```markdown
#### 🔴 [RED] F001: 付款条件对甲方不利

**条款位置**: 第3.2条

**原文引用**:
> "乙方有权在交付后30日内要求甲方支付全部款项，甲方不得以任何理由拒绝或延迟付款。"

**问题分析**:
该条款剥夺了甲方的验收权和付款抗辩权，违反公平原则。甲方在未验收合格的情况下被迫付款，存在以下风险：
1. 无法对质量问题进行付款抗辩
2. 无法在交付不符合约定时暂缓付款
3. 可能导致验收流于形式

**建议 Redline**:
```
原条款：
乙方有权在交付后30日内要求甲方支付全部款项，甲方不得以任何理由拒绝或延迟付款。

建议修改为：
乙方应在甲方验收合格并出具书面确认后【15】个工作日内，向甲方提交付款申请。甲方在收到合规发票及付款申请后【30】个工作日内支付相应款项。
```

**Fallback 谈判方案**:

| 优先级 | 方案 | 让步程度 |
|--------|------|----------|
| 1 | 付款应在验收合格后进行，验收标准见附件X | 首选 |
| 2 | 付款分阶段：预付30%，验收合格后支付60%，质保期满后支付10% | 可接受 |
| 3 | 付款应在验收合格后进行，但甲方有权在发现质量问题时暂缓付款 | 备选 |

**确认需求**:
- ⚠️ **需业务确认**: 涉及付款条件和比例，需业务确认可接受范围
- ⚠️ **需法务确认**: 需法务确认法律风险

---
```

## 报告生成流程

### Phase 1: 数据汇总
```python
def aggregate_results():
    # 1. 加载所有审查结果
    all_findings = []
    for result_file in review_results:
        result = load_json(result_file)
        all_findings.extend(result['findings'])
    
    # 2. 统计风险分布
    risk_summary = {
        'RED': count_by_level(all_findings, 'RED'),
        'YELLOW': count_by_level(all_findings, 'YELLOW'),
        'GREEN': count_by_level(all_findings, 'GREEN')
    }
    
    # 3. 识别跨主题问题
    cross_theme_issues = identify_cross_theme_issues(all_findings)
    
    # 4. 整理待确认事项
    confirmations = aggregate_confirmations(all_findings)
    
    return {
        'findings': all_findings,
        'risk_summary': risk_summary,
        'cross_theme_issues': cross_theme_issues,
        'confirmations': confirmations
    }
```

### Phase 2: 风险排序
```python
def prioritize_risks(findings):
    """
    风险优先级排序规则：
    1. RED > YELLOW > GREEN
    2. 同等级内按主题重要性排序
    3. 同主题内按发现顺序排序
    """
    
    theme_priority = {
        'payment': 1,
        'termination': 2,
        'limitation_liability': 3,
        'indemnification': 4,
        'ip_rights': 5,
        'confidentiality': 6,
        'data_processing': 7,
        'sla_acceptance': 8,
        # ... 其他主题
    }
    
    return sorted(findings, key=lambda f: (
        risk_level_order(f['risk_level']),
        theme_priority.get(f['theme'], 99)
    ))
```

### Phase 3: 报告生成
```python
def generate_report():
    # 1. 生成报告头部
    header = generate_report_header()
    
    # 2. 生成风险概览
    overview = generate_risk_overview()
    
    # 3. 生成重点风险提示（TOP 3 RED）
    top_risks = generate_top_risks(limit=3)
    
    # 4. 生成详细审查结果（按主题分组）
    detailed_results = generate_detailed_results()
    
    # 5. 生成交叉引用问题
    cross_refs = generate_cross_reference_issues()
    
    # 6. 生成行动计划
    action_plan = generate_action_plan()
    
    # 7. 生成待确认事项
    confirmations = generate_confirmations()
    
    # 8. 组装完整报告
    report = assemble_report(
        header,
        overview,
        top_risks,
        detailed_results,
        cross_refs,
        action_plan,
        confirmations
    )
    
    # 9. 保存报告
    save_report(
        path='/mnt/user-data/outputs/contract_review_report.md',
        content=report
    )
    
    return report
```

## 行动计划生成规则

### 立即处理（RED 风险）
```markdown
| 序号 | 发现ID | 主题 | 问题描述 | 建议行动 | 责任方 |
|------|--------|------|----------|----------|--------|
| 1 | F001 | 价格与付款 | 付款条件对甲方不利 | 建议修改第3.2条，增加验收前置条件 | 法务/采购 |
| 2 | F005 | 责任限制 | 责任上限过低 | 建议提高责任上限至合同金额的100% | 法务 |
| ... | ... | ... | ... | ... | ... |
```

### 近期处理（YELLOW 风险）
```markdown
| 序号 | 发现ID | 主题 | 问题描述 | 建议行动 | 时间建议 |
|------|--------|------|----------|----------|----------|
| 1 | F003 | 保密 | 保密期限较短 | 建议延长保密期限至合同终止后5年 | 谈判阶段 |
| ... | ... | ... | ... | ... | ... |
```

### 持续关注（GREEN 风险）
```markdown
| 序号 | 发现ID | 主题 | 说明 | 关注点 |
|------|--------|------|------|--------|
| 1 | F010 | 适用法律 | 条款合理 | 确认适用法律为中国法律 |
| ... | ... | ... | ... | ... |
```

## 待确认事项格式

### 需业务确认
```markdown
| 序号 | 发现ID | 确认事项 | 涉及条款 | 影响 | 建议负责人 |
|------|--------|----------|----------|------|------------|
| 1 | F001 | 付款比例是否可接受 | 第3.2条 | 影响资金流 | 采购负责人 |
| 2 | F006 | SLA指标是否可执行 | 第5.1条 | 影响验收 | 业务负责人 |
| ... | ... | ... | ... | ... | ... |
```

### 需法务确认
```markdown
| 序号 | 发现ID | 确认事项 | 涉及条款 | 法律风险 | 建议负责人 |
|------|--------|----------|----------|----------|------------|
| 1 | F005 | 责任上限是否合规 | 第8.3条 | 可能无法覆盖实际损失 | 法务律师 |
| 2 | F012 | 争议解决条款效力 | 第15条 | 仲裁条款可能无效 | 法务律师 |
| ... | ... | ... | ... | ... | ... |
```

## 报告质量检查

### 检查项
```yaml
quality_checks:
  - 每个发现是否有原文引用
  - 每个发现是否有问题分析
  - 每个发现是否有建议 redline
  - 每个发现是否有 fallback 方案
  - 风险等级是否合理
  - 交叉引用是否正确
  - 待确认事项是否完整
  - 报告格式是否规范
```

### 输出验证
```python
def validate_report(report):
    errors = []
    
    # 检查每个发现
    for finding in report.findings:
        if not finding.original_text:
            errors.append(f"发现 {finding.id} 缺少原文引用")
        if not finding.issue_analysis:
            errors.append(f"发现 {finding.id} 缺少问题分析")
        if not finding.suggested_redline:
            errors.append(f"发现 {finding.id} 缺少建议 redline")
        if finding.risk_level not in ['RED', 'YELLOW', 'GREEN']:
            errors.append(f"发现 {finding.id} 风险等级无效")
    
    return errors
```

## 输出规格

```yaml
outputs:
  final_report:
    path: /mnt/user-data/outputs/contract_review_report.md
    format: markdown
    encoding: utf-8
    language: zh-CN
    content:
      - 报告概要
      - 风险概览
      - 重点风险提示
      - 详细审查结果
      - 交叉引用问题
      - 建议行动计划
      - 待确认事项
      - 附录
```

## 完成通知

报告生成后输出：

```markdown
## ✅ 合同审查报告已生成

**报告位置**: `/mnt/user-data/outputs/contract_review_report.md`

**审查统计**:
- 总发现数: {total_findings}
- 🔴 RED: {red_count} 项
- 🟡 YELLOW: {yellow_count} 项
- 🟢 GREEN: {green_count} 项

**待处理事项**:
- 需立即处理: {red_count} 项
- 需业务确认: {business_confirmations} 项
- 需法务确认: {legal_confirmations} 项

**建议下一步**:
1. 优先处理 RED 风险项
2. 与业务团队确认相关事项
3. 与法务团队确认法律风险
4. 根据谈判策略选择 fallback 方案
```

## 依赖

- contract-intake-or-indexing（前置）
- contract-review-coordinator（前置）
- 文件系统操作