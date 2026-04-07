import { describe, expect, it } from "vitest";

import { getBackendBaseURL } from "@/core/config";

import { buildHtmlPreviewDocument } from "./html-preview";

describe("buildHtmlPreviewDocument", () => {
  it("rewrites workspace image references for html previews", () => {
    const artifactBaseURL = `${getBackendBaseURL()}/api/threads/thread-1/artifacts`;
    const html = `
      <!DOCTYPE html>
      <html>
        <body>
          <img src="../workspace/dragon-constellation.jpg" alt="dragon" />
          <script>
            window.images = {
              dragon: "../workspace/dragon-constellation.jpg"
            };
          </script>
        </body>
      </html>
    `;

    const result = buildHtmlPreviewDocument({
      html,
      filepath: "outputs/celestial-menagerie/index.html",
      threadId: "thread-1",
    });

    expect(result).toContain(
      `src="${artifactBaseURL}/mnt/user-data/workspace/dragon-constellation.jpg"`,
    );
    expect(result).toContain(
      `"${artifactBaseURL}/mnt/user-data/workspace/dragon-constellation.jpg"`,
    );
  });

  it("rewrites shared tmp references for html previews", () => {
    const artifactBaseURL = `${getBackendBaseURL()}/api/threads/thread-1/artifacts`;
    const html = `
      <!DOCTYPE html>
      <html>
        <body>
          <img src="/tmp/cache/chart.png" alt="chart" />
        </body>
      </html>
    `;

    const result = buildHtmlPreviewDocument({
      html,
      filepath: "outputs/demo/index.html",
      threadId: "thread-1",
    });

    expect(result).toContain(
      `src="${artifactBaseURL}/mnt/user-data/tmp/cache/chart.png"`,
    );
  });

  it("rewrites assets relative to the current html file", () => {
    const artifactBaseURL = `${getBackendBaseURL()}/api/threads/thread-1/artifacts`;
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <link rel="stylesheet" href="./assets/app.css" />
        </head>
        <body>
          <img src="./assets/cover.png" alt="cover" />
        </body>
      </html>
    `;

    const result = buildHtmlPreviewDocument({
      html,
      filepath: "outputs/demo/index.html",
      threadId: "thread-1",
    });

    expect(result).toContain(
      `href="${artifactBaseURL}/mnt/user-data/outputs/demo/assets/app.css"`,
    );
    expect(result).toContain(
      `src="${artifactBaseURL}/mnt/user-data/outputs/demo/assets/cover.png"`,
    );
  });

  it("preserves external urls and anchor links", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <body>
          <img src="https://example.com/image.png" alt="remote" />
          <a href="#section-one">Jump</a>
        </body>
      </html>
    `;

    const result = buildHtmlPreviewDocument({
      html,
      filepath: "outputs/demo/index.html",
      threadId: "thread-1",
    });

    expect(result).toContain('src="https://example.com/image.png"');
    expect(result).toContain('href="#section-one"');
  });
});
