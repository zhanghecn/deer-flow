import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Model } from "@/core/models/types";

const EMPTY_MODEL_VALUE = "__inherit__";
const UNAVAILABLE_MODEL_VALUE = "__unavailable__";

type ModelSelectProps = {
  value: string;
  models: Model[];
  isLoading: boolean;
  disabled?: boolean;
  placeholder: string;
  emptyLabel?: string;
  unavailableLabel: (modelName: string) => string;
  onChange: (value: string) => void;
};

export function ModelSelect({
  value,
  models,
  isLoading,
  disabled = false,
  placeholder,
  emptyLabel,
  unavailableLabel,
  onChange,
}: ModelSelectProps) {
  const normalizedValue = value.trim();
  const hasCurrentModel =
    normalizedValue.length > 0 &&
    models.some((model) => model.name === normalizedValue);
  const selectValue =
    normalizedValue.length === 0
      ? emptyLabel
        ? EMPTY_MODEL_VALUE
        : undefined
      : hasCurrentModel
        ? normalizedValue
        : UNAVAILABLE_MODEL_VALUE;

  return (
    <Select
      value={selectValue}
      onValueChange={(nextValue) => {
        if (nextValue === EMPTY_MODEL_VALUE) {
          onChange("");
          return;
        }
        if (nextValue === UNAVAILABLE_MODEL_VALUE) {
          onChange(normalizedValue);
          return;
        }
        onChange(nextValue);
      }}
      disabled={disabled || isLoading}
    >
      <SelectTrigger className="h-11 w-full rounded-2xl">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {emptyLabel ? (
          <SelectItem value={EMPTY_MODEL_VALUE}>{emptyLabel}</SelectItem>
        ) : null}
        {!hasCurrentModel && normalizedValue.length > 0 ? (
          <SelectItem value={UNAVAILABLE_MODEL_VALUE}>
            {unavailableLabel(normalizedValue)}
          </SelectItem>
        ) : null}
        {models.map((model) => (
          <SelectItem key={model.name} value={model.name}>
            {model.display_name || model.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
