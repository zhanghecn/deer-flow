import type { Locale } from "@/core/i18n";

export type AuthoringWorkbenchText = {
  openWorkbench: string;
  loading: string;
  loadErrorTitle: string;
  emptyEditor: string;
  fileTree: string;
  archiveStatus: string;
  sourcePath: string;
  authoringThread: string;
  rootPath: string;
  saveDraft: string;
  publishAgent: string;
  saveSuccess: (name: string) => string;
  publishSuccess: (name: string) => string;
  dirtyState: string;
  cleanState: string;
  unsavedChanges: string;
  actionsTitle: string;
  actionsDescriptionAgent: string;
  actionsDescriptionSkill: string;
  createFile: string;
  createFileDescription: string;
  newFilePath: string;
  newFilePathPlaceholder: string;
  createFileSubmit: string;
  fileCreated: (path: string) => string;
  createFileIn: string;
  deleteFile: string;
  deleteDirectory: string;
  fileDeleted: (name: string) => string;
  confirmDeleteFile: (name: string) => string;
  confirmDeleteDirectory: (name: string) => string;
  invalidFilePath: string;
  saveHintAgent: string;
  saveHintSkill: string;
  saveHintSkillLegacy: string;
  publishHintAgent: string;
  backToAgents: string;
  backToSkills: string;
  settings: string;
  archiveSummary: string;
};

const enUS: AuthoringWorkbenchText = {
  openWorkbench: "Open Workbench",
  loading: "Loading authoring workbench...",
  loadErrorTitle: "Workbench unavailable",
  emptyEditor: "Select a file from the tree to start editing.",
  fileTree: "File tree",
  archiveStatus: "Archive status",
  sourcePath: "Source path",
  authoringThread: "Draft thread",
  rootPath: "Draft root",
  saveDraft: "Save archive",
  publishAgent: "Publish agent",
  saveSuccess: (name) => `Saved ${name} to its archive.`,
  publishSuccess: (name) => `Published ${name}.`,
  dirtyState: "Unsaved changes",
  cleanState: "All changes saved",
  unsavedChanges: "You have unsaved changes in this workbench.",
  actionsTitle: "Actions",
  actionsDescriptionAgent:
    "Edits are staged in a thread-local draft tree and only become canonical after save.",
  actionsDescriptionSkill:
    "Reusable skills save into the canonical custom archive instead of the legacy store roots.",
  createFile: "Create file",
  createFileDescription:
    "Use nested paths like `references/checklist.md` to create folders and files together.",
  newFilePath: "Relative path",
  newFilePathPlaceholder: "references/checklist.md",
  createFileSubmit: "Add file",
  fileCreated: (path) => `Created ${path}.`,
  createFileIn: "New file",
  deleteFile: "Delete file",
  deleteDirectory: "Delete folder",
  fileDeleted: (name) => `Deleted ${name}.`,
  confirmDeleteFile: (name) => `Delete ${name}?`,
  confirmDeleteDirectory: (name) =>
    `Delete folder ${name} and everything inside it?`,
  invalidFilePath: "Enter a relative file path under the current draft root.",
  saveHintAgent:
    "Save copies the draft back into the selected archived agent version.",
  saveHintSkill:
    "Save copies the draft into `.openagents/custom/skills/<name>`.",
  saveHintSkillLegacy:
    "Legacy store skills are copied into custom skills when you save from this workbench.",
  publishHintAgent:
    "Publish stays on the agent archive flow. Save before publishing so the prod copy uses the latest draft.",
  backToAgents: "Back to agents",
  backToSkills: "Back to skills",
  settings: "Settings",
  archiveSummary: "Archive summary",
};

const zhCN: AuthoringWorkbenchText = {
  openWorkbench: "打开工作台",
  loading: "正在加载编辑工作台...",
  loadErrorTitle: "工作台不可用",
  emptyEditor: "从左侧文件树选择一个文件开始编辑。",
  fileTree: "文件树",
  archiveStatus: "归档状态",
  sourcePath: "来源路径",
  authoringThread: "草稿线程",
  rootPath: "草稿根目录",
  saveDraft: "保存归档",
  publishAgent: "发布智能体",
  saveSuccess: (name) => `已将 ${name} 保存到归档。`,
  publishSuccess: (name) => `已发布 ${name}。`,
  dirtyState: "有未保存修改",
  cleanState: "修改已全部保存",
  unsavedChanges: "当前工作台还有未保存的修改。",
  actionsTitle: "操作",
  actionsDescriptionAgent:
    "编辑先写入线程级草稿目录，只有点击保存后才会回写到正式归档。",
  actionsDescriptionSkill:
    "可复用技能会保存到 canonical 的 custom archive，而不是旧的 store 目录。",
  createFile: "新建文件",
  createFileDescription:
    "可直接输入 `references/checklist.md` 这类嵌套路径，一次创建目录和文件。",
  newFilePath: "相对路径",
  newFilePathPlaceholder: "references/checklist.md",
  createFileSubmit: "添加文件",
  fileCreated: (path) => `已创建 ${path}。`,
  createFileIn: "新建文件",
  deleteFile: "删除文件",
  deleteDirectory: "删除文件夹",
  fileDeleted: (name) => `已删除 ${name}。`,
  confirmDeleteFile: (name) => `删除 ${name}？`,
  confirmDeleteDirectory: (name) => `删除文件夹 ${name} 及其中所有内容？`,
  invalidFilePath: "请输入当前草稿根目录下的相对文件路径。",
  saveHintAgent: "保存会把当前草稿回写到所选的 agent archive 版本。",
  saveHintSkill: "保存会把草稿写入 `.openagents/custom/skills/<name>`。",
  saveHintSkillLegacy:
    "如果当前来自 legacy store，保存时会复制进 custom skills。",
  publishHintAgent:
    "发布仍走 agent archive 的发布链路。先保存，再发布，prod 才会拿到最新草稿。",
  backToAgents: "返回智能体",
  backToSkills: "返回技能",
  settings: "设置",
  archiveSummary: "归档摘要",
};

export function getAuthoringWorkbenchText(locale: Locale) {
  return locale === "zh-CN" ? zhCN : enUS;
}
