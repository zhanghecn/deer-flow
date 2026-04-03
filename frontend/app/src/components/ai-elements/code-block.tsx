import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CheckIcon, CopyIcon } from "lucide-react";
import {
  type ComponentProps,
  createContext,
  type HTMLAttributes,
  useContext,
  useEffect,
  useState,
} from "react";
import { type BundledLanguage, codeToHtml, type ShikiTransformer } from "shiki";

type CodeBlockRenderMode = "auto" | "highlight" | "plain";

type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string;
  language: BundledLanguage;
  showLineNumbers?: boolean;
  renderMode?: CodeBlockRenderMode;
  viewportClassName?: string;
  wrapLongLines?: boolean;
};

type CodeBlockContextType = {
  code: string;
};

const CodeBlockContext = createContext<CodeBlockContextType>({
  code: "",
});

const lineNumberTransformer: ShikiTransformer = {
  name: "line-numbers",
  line(node, line) {
    node.children.unshift({
      type: "element",
      tagName: "span",
      properties: {
        className: [
          "inline-block",
          "min-w-10",
          "mr-4",
          "text-right",
          "select-none",
          "text-muted-foreground",
        ],
      },
      children: [{ type: "text", value: String(line) }],
    });
  },
};

export async function highlightCode(
  code: string,
  language: BundledLanguage,
  showLineNumbers = false,
) {
  const transformers: ShikiTransformer[] = showLineNumbers
    ? [lineNumberTransformer]
    : [];

  return await Promise.all([
    codeToHtml(code, {
      lang: language,
      theme: "one-light",
      transformers,
    }),
    codeToHtml(code, {
      lang: language,
      theme: "one-dark-pro",
      transformers,
    }),
  ]);
}

function shouldUsePlainTextRender(code: string, renderMode: CodeBlockRenderMode) {
  if (renderMode === "plain") {
    return true;
  }
  if (renderMode === "highlight") {
    return false;
  }

  const lineCount = code.split("\n").length;
  return code.length > 12_000 || lineCount > 200;
}

export const CodeBlock = ({
  code,
  language,
  showLineNumbers = false,
  renderMode = "auto",
  viewportClassName,
  wrapLongLines = true,
  className,
  children,
  ...props
}: CodeBlockProps) => {
  const [html, setHtml] = useState<string>("");
  const [darkHtml, setDarkHtml] = useState<string>("");
  const shouldUsePlainText = shouldUsePlainTextRender(code, renderMode);
  const viewportClasses = cn(
    "overflow-auto font-mono text-sm",
    viewportClassName,
    wrapLongLines ? "whitespace-pre-wrap break-words" : "whitespace-pre",
  );

  useEffect(() => {
    if (shouldUsePlainText) {
      setHtml("");
      setDarkHtml("");
      return;
    }

    let cancelled = false;

    highlightCode(code, language, showLineNumbers).then(([light, dark]) => {
      if (!cancelled) {
        setHtml(light);
        setDarkHtml(dark);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [code, language, showLineNumbers, shouldUsePlainText]);

  return (
    <CodeBlockContext.Provider value={{ code }}>
      <div
        className={cn(
          "group bg-background text-foreground relative w-full overflow-hidden rounded-md border",
          className,
        )}
        {...props}
      >
        <div className="relative w-full">
          {shouldUsePlainText ? (
            <pre className={cn("bg-background text-foreground m-0 p-3", viewportClasses)}>
              {code}
            </pre>
          ) : (
            <>
              <div
                className={cn(
                  "[&>pre]:bg-background! [&>pre]:text-foreground! overflow-auto dark:hidden [&_code]:font-mono [&_code]:text-sm [&>pre]:m-0 [&>pre]:p-3 [&>pre]:text-sm",
                  wrapLongLines
                    ? "[&>pre]:whitespace-pre-wrap"
                    : "[&>pre]:min-w-max [&>pre]:whitespace-pre",
                  viewportClassName,
                )}
                // biome-ignore lint/security/noDangerouslySetInnerHtml: "this is needed."
                dangerouslySetInnerHTML={{ __html: html }}
              />
              <div
                className={cn(
                  "[&>pre]:bg-background! [&>pre]:text-foreground! hidden overflow-auto dark:block [&_code]:font-mono [&_code]:text-sm [&>pre]:m-0 [&>pre]:p-3 [&>pre]:text-sm",
                  wrapLongLines
                    ? "[&>pre]:whitespace-pre-wrap"
                    : "[&>pre]:min-w-max [&>pre]:whitespace-pre",
                  viewportClassName,
                )}
                // biome-ignore lint/security/noDangerouslySetInnerHtml: "this is needed."
                dangerouslySetInnerHTML={{ __html: darkHtml }}
              />
            </>
          )}
          {children && (
            <div className="absolute top-2 right-2 flex items-center gap-2">
              {children}
            </div>
          )}
        </div>
      </div>
    </CodeBlockContext.Provider>
  );
};

export type CodeBlockCopyButtonProps = ComponentProps<typeof Button> & {
  onCopy?: () => void;
  onError?: (error: Error) => void;
  timeout?: number;
};

export const CodeBlockCopyButton = ({
  onCopy,
  onError,
  timeout = 2000,
  children,
  className,
  ...props
}: CodeBlockCopyButtonProps) => {
  const [isCopied, setIsCopied] = useState(false);
  const { code } = useContext(CodeBlockContext);

  const copyToClipboard = async () => {
    if (typeof window === "undefined" || !navigator?.clipboard?.writeText) {
      onError?.(new Error("Clipboard API not available"));
      return;
    }

    try {
      await navigator.clipboard.writeText(code);
      setIsCopied(true);
      onCopy?.();
      setTimeout(() => setIsCopied(false), timeout);
    } catch (error) {
      onError?.(error as Error);
    }
  };

  const Icon = isCopied ? CheckIcon : CopyIcon;

  return (
    <Button
      className={cn("shrink-0", className)}
      onClick={copyToClipboard}
      size="icon"
      variant="ghost"
      {...props}
    >
      {children ?? <Icon size={14} />}
    </Button>
  );
};
