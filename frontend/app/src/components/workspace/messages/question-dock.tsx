import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MessageCircleQuestionMarkIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/core/i18n/hooks";
import {
  extractQuestionRequestFromInterrupt,
  type QuestionInfo,
  type QuestionReply,
  type QuestionRequest,
} from "@/core/threads/interrupts";
import type { AgentInterrupt } from "@/core/threads/types";
import { cn } from "@/lib/utils";

import { useThread } from "./context";

type QuestionDraft = {
  tab: number;
  selectedOptions: string[][];
  customAnswers: string[];
};

const questionDraftCache = new Map<string, QuestionDraft>();

function createDraft(
  questionCount: number,
  cached?: QuestionDraft,
): QuestionDraft {
  return {
    tab: cached && cached.tab < questionCount ? cached.tab : 0,
    selectedOptions: Array.from({ length: questionCount }, (_, index) => [
      ...(cached?.selectedOptions[index] ?? []),
    ]),
    customAnswers: Array.from(
      { length: questionCount },
      (_, index) => cached?.customAnswers[index] ?? "",
    ),
  };
}

function getQuestionKey(question: QuestionRequest) {
  return [
    question.requestId,
    question.originAgentName ?? "",
    ...question.questions.flatMap((item) => [
      item.header ?? "",
      item.question,
      item.multiple ? "1" : "0",
      item.custom ? "1" : "0",
      ...item.options.flatMap((option) => [
        option.label,
        option.description ?? "",
      ]),
    ]),
  ].join("\u0000");
}

function resolveQuestionAnswers(
  question: QuestionInfo,
  draft: QuestionDraft,
  index: number,
) {
  const selectedOptions = draft.selectedOptions[index] ?? [];
  const customAnswer = draft.customAnswers[index]?.trim() ?? "";

  if (question.multiple) {
    const answers = [...selectedOptions];
    if (question.custom && customAnswer) {
      answers.push(customAnswer);
    }
    return [...new Set(answers)];
  }

  if (question.custom && customAnswer) {
    return [customAnswer];
  }

  return selectedOptions.length > 0 ? [selectedOptions[0]!] : [];
}

function hasQuestionAnswer(
  question: QuestionInfo,
  draft: QuestionDraft,
  index: number,
) {
  return resolveQuestionAnswers(question, draft, index).length > 0;
}

function buildQuestionReply(
  question: QuestionRequest,
  draft: QuestionDraft,
): QuestionReply {
  return {
    requestId: question.requestId,
    answers: question.questions.map((item, index) =>
      resolveQuestionAnswers(item, draft, index),
    ),
    rejected: false,
  };
}

export function QuestionSummary({
  className,
  question,
  reply,
  showOptions = true,
}: {
  className?: string;
  question: QuestionRequest;
  reply?: QuestionReply | null;
  showOptions?: boolean;
}) {
  const { t } = useI18n();

  return (
    <div className={cn("space-y-3", className)} data-slot="question-summary">
      <div className="flex items-center gap-2 text-sm font-medium">
        <MessageCircleQuestionMarkIcon className="text-primary size-4" />
        <span>{t.toolCalls.questionTitle}</span>
      </div>

      <div className="space-y-4">
        {question.questions.map((item, index) => {
          const answers = reply?.answers[index] ?? [];

          return (
            <div key={`${item.question}-${index}`} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {item.header && (
                  <div className="bg-muted text-muted-foreground rounded-full px-2.5 py-1 text-[11px] font-medium tracking-wide uppercase">
                    {item.header}
                  </div>
                )}
                {question.questions.length > 1 && (
                  <div className="text-muted-foreground text-xs">
                    {t.toolCalls.questionProgress(
                      index + 1,
                      question.questions.length,
                    )}
                  </div>
                )}
              </div>
              <div className="text-foreground text-sm font-medium">
                {item.question}
              </div>

              {showOptions && item.options.length > 0 && (
                <div className="space-y-2">
                  <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    {t.toolCalls.questionOptions}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {item.options.map((option, optionIndex) => (
                      <div
                        key={`${option.label}-${optionIndex}`}
                        className="bg-muted text-foreground rounded-full px-3 py-1.5 text-sm"
                      >
                        {option.label}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {reply?.rejected ? (
                <div className="text-muted-foreground text-sm">
                  {t.toolCalls.questionDismissAction}
                </div>
              ) : answers.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {answers.map((answer, answerIndex) => (
                    <div
                      key={`${answer}-${answerIndex}`}
                      className="bg-primary/10 text-primary rounded-full px-3 py-1.5 text-sm"
                    >
                      {answer}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function QuestionDock({
  className,
  interrupt,
}: {
  className?: string;
  interrupt?: AgentInterrupt;
}) {
  const { t } = useI18n();
  const { resumeInterrupt, thread } = useThread();
  const resolvedInterrupt = (interrupt ?? thread.interrupt) as
    | AgentInterrupt
    | undefined;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<QuestionRequest | null>(
    null,
  );

  const question = extractQuestionRequestFromInterrupt(resolvedInterrupt);
  const questionKey = question ? getQuestionKey(question) : "";

  useEffect(() => {
    if (question) {
      setPendingQuestion((previous) => {
        if (previous && getQuestionKey(previous) === questionKey) {
          return previous;
        }
        return question;
      });
      return;
    }

    if (!isSubmitting) {
      setPendingQuestion((previous) => previous ?? null);
    }
  }, [isSubmitting, question, questionKey]);

  const activeQuestion = question ?? (isSubmitting ? pendingQuestion : null);
  const questionCount = activeQuestion?.questions.length ?? 0;
  const draftKey =
    activeQuestion?.requestId ||
    (resolvedInterrupt?.id && `${resolvedInterrupt.id}`) ||
    "";
  const [draft, setDraft] = useState<QuestionDraft>(() =>
    activeQuestion
      ? createDraft(questionCount, questionDraftCache.get(draftKey))
      : createDraft(0),
  );

  useEffect(() => {
    if (!activeQuestion || !draftKey) {
      return;
    }
    setDraft(createDraft(questionCount, questionDraftCache.get(draftKey)));
  }, [draftKey, questionCount, questionKey]);

  useEffect(() => {
    if (!draftKey || !activeQuestion) {
      return;
    }
    questionDraftCache.set(draftKey, draft);
  }, [activeQuestion, draft, draftKey]);

  if (!activeQuestion) {
    return null;
  }

  const isDisabled = isSubmitting || !resumeInterrupt;
  const currentQuestion = activeQuestion.questions[draft.tab]!;
  const currentQuestionAnswered = hasQuestionAnswer(
    currentQuestion,
    draft,
    draft.tab,
  );

  const handleSubmit = async () => {
    if (!currentQuestionAnswered || isDisabled) {
      return;
    }

    setIsSubmitting(true);
    try {
      await resumeInterrupt?.({
        resume: {
          request_id: activeQuestion.requestId,
          answers: buildQuestionReply(activeQuestion, draft).answers,
        },
      });
      questionDraftCache.delete(draftKey);
    } catch (error) {
      console.error("Failed to answer question:", error);
      toast.error(t.toolCalls.questionResumeError);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDismiss = async () => {
    if (isDisabled) {
      return;
    }

    setIsSubmitting(true);
    try {
      await resumeInterrupt?.({
        resume: {
          request_id: activeQuestion.requestId,
          rejected: true,
        },
      });
      questionDraftCache.delete(draftKey);
    } catch (error) {
      console.error("Failed to dismiss question:", error);
      toast.error(t.toolCalls.questionDismissError);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      data-slot="question-dock"
      className={cn(
        "border-border/80 bg-background/95 flex max-h-[min(32rem,calc(100dvh-20rem))] w-full flex-col overflow-hidden rounded-3xl border p-4 shadow-sm backdrop-blur",
        className,
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              <MessageCircleQuestionMarkIcon className="text-primary size-4" />
              <span>{t.toolCalls.questionTitle}</span>
            </div>
            {activeQuestion.questions.length > 1 && (
              <div className="text-muted-foreground text-xs">
                {t.toolCalls.questionProgress(
                  draft.tab + 1,
                  activeQuestion.questions.length,
                )}
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isDisabled}
            onClick={() => void handleDismiss()}
          >
            <XIcon className="size-4" />
          </Button>
        </div>

        {activeQuestion.questions.length > 1 && (
          <div className="flex gap-2" data-slot="question-progress">
            {activeQuestion.questions.map((item, index) => {
              const answered = hasQuestionAnswer(item, draft, index);
              const active = index === draft.tab;
              return (
                <button
                  type="button"
                  key={`${item.question}-${index}`}
                  className={cn(
                    "h-2 flex-1 rounded-full transition-colors",
                    active && "bg-primary",
                    !active && answered && "bg-primary/40",
                    !active && !answered && "bg-muted",
                  )}
                  disabled={isDisabled}
                  data-slot="question-progress-segment"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      tab: index,
                    }))
                  }
                  aria-label={t.toolCalls.questionProgress(
                    index + 1,
                    activeQuestion.questions.length,
                  )}
                />
              );
            })}
          </div>
        )}

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="space-y-4">
            <div className="space-y-2">
              {currentQuestion.header && (
                <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {currentQuestion.header}
                </div>
              )}
              <div className="text-foreground text-base leading-7 font-medium">
                {currentQuestion.question}
              </div>
              <div className="text-muted-foreground text-xs">
                {currentQuestion.multiple
                  ? t.toolCalls.questionHintMultiple
                  : t.toolCalls.questionHintSingle}
              </div>
            </div>

            {currentQuestion.options.length > 0 && (
              <div className="space-y-2">
                <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {t.toolCalls.questionOptions}
                </div>
                <div className="grid gap-2" data-slot="question-options">
                  {currentQuestion.options.map((option, index) => {
                    const selected =
                      draft.selectedOptions[draft.tab]?.includes(option.label) ??
                      false;
                    return (
                      <button
                        type="button"
                        key={`${option.label}-${index}`}
                        className={cn(
                          "w-full rounded-2xl border px-4 py-3 text-left transition-colors",
                          selected
                            ? "border-primary bg-primary/5"
                            : "border-border/70 hover:border-primary/40 hover:bg-muted/40",
                        )}
                        disabled={isDisabled}
                        data-slot="question-option"
                        onClick={() =>
                          setDraft((current) => {
                            const nextSelectedOptions =
                              current.selectedOptions.map((value) => [...value]);
                            const selectedOptions =
                              nextSelectedOptions[draft.tab] ?? [];

                            if (currentQuestion.multiple) {
                              nextSelectedOptions[draft.tab] = selected
                                ? selectedOptions.filter(
                                    (item) => item !== option.label,
                                  )
                                : [...selectedOptions, option.label];
                              return {
                                ...current,
                                selectedOptions: nextSelectedOptions,
                              };
                            }

                            const nextCustomAnswers = [...current.customAnswers];
                            nextCustomAnswers[draft.tab] = "";
                            nextSelectedOptions[draft.tab] = [option.label];
                            return {
                              ...current,
                              selectedOptions: nextSelectedOptions,
                              customAnswers: nextCustomAnswers,
                            };
                          })
                        }
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="text-sm font-medium">
                              {option.label}
                            </div>
                            {option.description && (
                              <div className="text-muted-foreground text-xs leading-5">
                                {option.description}
                              </div>
                            )}
                          </div>
                          <div
                            className={cn(
                              "mt-1 h-3 w-3 shrink-0 rounded-full border",
                              selected
                                ? "border-primary bg-primary"
                                : "border-muted-foreground/30",
                            )}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {currentQuestion.custom && (
              <div className="space-y-2">
                <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {t.toolCalls.questionCustomAnswer}
                </div>
                <Textarea
                  data-slot="question-custom"
                  value={draft.customAnswers[draft.tab] ?? ""}
                  onChange={(event) =>
                    setDraft((current) => {
                      const nextCustomAnswers = [...current.customAnswers];
                      nextCustomAnswers[draft.tab] = event.target.value;
                      const nextSelectedOptions = current.selectedOptions.map(
                        (value) => [...value],
                      );
                      if (
                        !currentQuestion.multiple &&
                        event.target.value.trim()
                      ) {
                        nextSelectedOptions[draft.tab] = [];
                      }
                      return {
                        ...current,
                        customAnswers: nextCustomAnswers,
                        selectedOptions: nextSelectedOptions,
                      };
                    })
                  }
                  placeholder={t.toolCalls.questionReplyPlaceholder}
                  disabled={isDisabled}
                  className="min-h-24 resize-y"
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2">
          <Button
            variant="ghost"
            disabled={isDisabled}
            data-slot="question-dismiss"
            onClick={() => void handleDismiss()}
          >
            {t.toolCalls.questionDismissAction}
          </Button>

          <div className="flex items-center gap-2">
            {draft.tab > 0 && (
              <Button
                variant="secondary"
                disabled={isDisabled}
                data-slot="question-back"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    tab: Math.max(0, current.tab - 1),
                  }))
                }
              >
                <ChevronLeftIcon className="size-4" />
                {t.toolCalls.questionBackAction}
              </Button>
            )}
            <Button
              disabled={isDisabled || !currentQuestionAnswered}
              data-slot="question-submit"
              onClick={() => {
                if (draft.tab < activeQuestion.questions.length - 1) {
                  setDraft((current) => ({
                    ...current,
                    tab: current.tab + 1,
                  }));
                  return;
                }
                void handleSubmit();
              }}
            >
              {draft.tab < activeQuestion.questions.length - 1 ? (
                <>
                  {t.toolCalls.questionNextAction}
                  <ChevronRightIcon className="size-4" />
                </>
              ) : (
                t.toolCalls.questionSubmitAction
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
