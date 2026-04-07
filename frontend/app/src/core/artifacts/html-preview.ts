import { loadArtifactBlob } from "./loader";
import { resolveThreadScopedPath } from "./preview-resolver";
import { urlOfArtifact } from "./utils";

function buildArtifactURLResolver({
  filepath,
  threadId,
  isMock,
  rewrittenPaths,
}: {
  filepath: string;
  threadId: string;
  isMock?: boolean;
  rewrittenPaths?: Map<string, string>;
}) {
  return (value: string) => {
    const resolved = resolveThreadScopedPath(value, filepath);
    if (!resolved) {
      return value;
    }

    if (rewrittenPaths?.has(resolved)) {
      return rewrittenPaths.get(resolved) ?? value;
    }

    return urlOfArtifact({
      filepath: resolved,
      threadId,
      isMock,
    });
  };
}

function rewriteSrcset(value: string, rewriteURL: (value: string) => string) {
  return value
    .split(",")
    .map((entry) => {
      const trimmed = entry.trim();
      if (!trimmed) {
        return trimmed;
      }

      const [url = "", ...descriptorParts] = trimmed.split(/\s+/);
      const rewrittenURL = rewriteURL(url);
      const descriptor = descriptorParts.join(" ");
      return descriptor ? `${rewrittenURL} ${descriptor}` : rewrittenURL;
    })
    .join(", ");
}

function rewriteCSSURLs(
  cssText: string,
  rewriteURL: (value: string) => string,
) {
  return cssText.replace(
    /url\(\s*(["']?)([^)"']+)\1\s*\)/gi,
    (match, quote: string, rawURL: string) => {
      const rewritten = rewriteURL(rawURL);
      if (rewritten === rawURL) {
        return match;
      }

      const safeQuote = quote || '"';
      return `url(${safeQuote}${rewritten}${safeQuote})`;
    },
  );
}

function rewriteQuotedArtifactPaths(
  text: string,
  rewriteURL: (value: string) => string,
) {
  return text.replace(
    /(["'`])((?:\.{1,2}\/|\/mnt\/user-data\/|outputs\/|workspace\/|tmp\/|uploads\/|agents\/|authoring\/)[^"'`]*?)\1/g,
    (match, quote: string, rawURL: string) => {
      const rewritten = rewriteURL(rawURL);
      if (rewritten === rawURL) {
        return match;
      }

      return `${quote}${rewritten}${quote}`;
    },
  );
}

function collectResolvedArtifactPaths({
  html,
  filepath,
}: {
  html: string;
  filepath: string;
}) {
  if (!html.trim() || typeof DOMParser === "undefined") {
    return new Set<string>();
  }

  const resolvedPaths = new Set<string>();
  const document = new DOMParser().parseFromString(html, "text/html");

  document.querySelectorAll("*").forEach((element) => {
    for (const attribute of ["src", "href", "poster", "data"]) {
      const currentValue = element.getAttribute(attribute);
      if (!currentValue) {
        continue;
      }

      const resolved = resolveThreadScopedPath(currentValue, filepath);
      if (resolved) {
        resolvedPaths.add(resolved);
      }
    }

    for (const attribute of ["srcset", "imagesrcset"]) {
      const currentValue = element.getAttribute(attribute);
      if (!currentValue) {
        continue;
      }

      currentValue.split(",").forEach((entry) => {
        const [url = ""] = entry.trim().split(/\s+/);
        const resolved = resolveThreadScopedPath(url, filepath);
        if (resolved) {
          resolvedPaths.add(resolved);
        }
      });
    }

    const inlineStyle = element.getAttribute("style");
    if (inlineStyle) {
      inlineStyle.replace(
        /url\(\s*(["']?)([^)"']+)\1\s*\)/gi,
        (_match, _quote: string, rawURL: string) => {
          const resolved = resolveThreadScopedPath(rawURL, filepath);
          if (resolved) {
            resolvedPaths.add(resolved);
          }
          return _match;
        },
      );
    }
  });

  document.querySelectorAll("style").forEach((element) => {
    if (!element.textContent) {
      return;
    }
    element.textContent.replace(
      /url\(\s*(["']?)([^)"']+)\1\s*\)/gi,
      (_match, _quote: string, rawURL: string) => {
        const resolved = resolveThreadScopedPath(rawURL, filepath);
        if (resolved) {
          resolvedPaths.add(resolved);
        }
        return _match;
      },
    );
  });

  document.querySelectorAll("script").forEach((element) => {
    if (!element.textContent) {
      return;
    }
    element.textContent.replace(
      /(["'`])((?:\.{1,2}\/|\/mnt\/user-data\/|outputs\/|workspace\/|tmp\/|uploads\/|agents\/|authoring\/)[^"'`]*?)\1/g,
      (_match, _quote: string, rawURL: string) => {
        const resolved = resolveThreadScopedPath(rawURL, filepath);
        if (resolved) {
          resolvedPaths.add(resolved);
        }
        return _match;
      },
    );
  });

  return resolvedPaths;
}

function renderHtmlPreviewDocument({
  html,
  rewriteURL,
}: {
  html: string;
  rewriteURL: (value: string) => string;
}) {
  if (!html.trim() || typeof DOMParser === "undefined") {
    return html;
  }

  const document = new DOMParser().parseFromString(html, "text/html");

  document.querySelectorAll("*").forEach((element) => {
    for (const attribute of ["src", "href", "poster", "data"]) {
      const currentValue = element.getAttribute(attribute);
      if (!currentValue) {
        continue;
      }

      element.setAttribute(attribute, rewriteURL(currentValue));
    }

    for (const attribute of ["srcset", "imagesrcset"]) {
      const currentValue = element.getAttribute(attribute);
      if (!currentValue) {
        continue;
      }

      element.setAttribute(attribute, rewriteSrcset(currentValue, rewriteURL));
    }

    const inlineStyle = element.getAttribute("style");
    if (inlineStyle) {
      element.setAttribute("style", rewriteCSSURLs(inlineStyle, rewriteURL));
    }
  });

  document.querySelectorAll("style").forEach((element) => {
    if (!element.textContent) {
      return;
    }
    element.textContent = rewriteCSSURLs(element.textContent, rewriteURL);
  });

  document.querySelectorAll("script").forEach((element) => {
    if (!element.textContent) {
      return;
    }
    element.textContent = rewriteQuotedArtifactPaths(
      element.textContent,
      rewriteURL,
    );
  });

  return `<!DOCTYPE html>\n${document.documentElement.outerHTML}`;
}

export function buildHtmlPreviewDocument({
  html,
  filepath,
  threadId,
  isMock,
}: {
  html: string;
  filepath: string;
  threadId: string;
  isMock?: boolean;
}) {
  return renderHtmlPreviewDocument({
    html,
    rewriteURL: buildArtifactURLResolver({
      filepath,
      threadId,
      isMock,
    }),
  });
}

export async function loadHtmlPreviewDocument({
  html,
  filepath,
  threadId,
  isMock,
}: {
  html: string;
  filepath: string;
  threadId: string;
  isMock?: boolean;
}) {
  const resolvedPaths = collectResolvedArtifactPaths({ html, filepath });
  const rewrittenPaths = new Map<string, string>();

  await Promise.all(
    Array.from(resolvedPaths).map(async (resolvedPath) => {
      try {
        const blob = await loadArtifactBlob({
          filepath: resolvedPath,
          threadId,
          isMock,
        });
        rewrittenPaths.set(resolvedPath, URL.createObjectURL(blob));
      } catch {
        rewrittenPaths.set(
          resolvedPath,
          urlOfArtifact({
            filepath: resolvedPath,
            threadId,
            isMock,
          }),
        );
      }
    }),
  );

  return {
    html: renderHtmlPreviewDocument({
      html,
      rewriteURL: buildArtifactURLResolver({
        filepath,
        threadId,
        isMock,
        rewrittenPaths,
      }),
    }),
    objectUrls: Array.from(rewrittenPaths.values()).filter((value) =>
      value.startsWith("blob:"),
    ),
  };
}
