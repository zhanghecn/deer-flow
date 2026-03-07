import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import type { LLMProviderKey } from "@/types";
import { toast } from "sonner";

const PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "google", label: "Google" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "other", label: "Other" },
];

interface LLMKeyFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editKey?: LLMProviderKey | null;
  onSuccess: () => void;
}

export function LLMKeyForm({
  open,
  onOpenChange,
  editKey,
  onSuccess,
}: LLMKeyFormProps) {
  const isEdit = !!editKey;
  const [provider, setProvider] = useState(editKey?.provider_name ?? "openai");
  const [displayName, setDisplayName] = useState(editKey?.display_name ?? "");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(editKey?.base_url ?? "");
  const [isActive, setIsActive] = useState(editKey?.is_active ?? true);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const body = {
        provider_name: provider,
        display_name: displayName,
        api_key: isEdit && !apiKey ? editKey!.api_key : apiKey,
        base_url: baseUrl || null,
        is_active: isActive,
      };

      if (isEdit) {
        await api(`/api/admin/llm-keys/${editKey!.id}`, {
          method: "PUT",
          body,
        });
        toast.success("Key updated");
      } else {
        await api("/api/admin/llm-keys", { method: "POST", body });
        toast.success("Key created");
      }
      onOpenChange(false);
      onSuccess();
    } catch {
      toast.error(isEdit ? "Failed to update key" : "Failed to create key");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Provider Key" : "Add Provider Key"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Provider</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Display Name</Label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Production Key"
              required
            />
          </div>
          <div className="space-y-2">
            <Label>API Key</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={isEdit ? "Leave blank to keep current" : "sk-..."}
              required={!isEdit}
            />
          </div>
          <div className="space-y-2">
            <Label>Base URL (optional)</Label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            <Label>Active</Label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : isEdit ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
