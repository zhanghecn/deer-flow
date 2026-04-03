import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";

import { OnlyOfficeDocumentEditor } from "./onlyoffice-document-editor";

type OnlyOfficeWindow = Window & {
  DocsAPI?: {
    DocEditor: new (
      id: string,
      config: Record<string, unknown>,
    ) => { destroyEditor?: () => void };
  };
  DocEditor?: {
    instances?: Record<string, { destroyEditor?: () => void } | undefined>;
  };
};

type OnlyOfficeDocEditorConstructor = new (
  id: string,
  config: Record<string, unknown>,
) => { destroyEditor?: () => void };

describe("OnlyOfficeDocumentEditor", () => {
  beforeEach(() => {
    const onlyOfficeWindow = window as OnlyOfficeWindow;
    onlyOfficeWindow.DocEditor = { instances: {} };
    document.body.innerHTML = "";
  });

  it("destroys any stale editor instance before mounting a new one", async () => {
    const staleDestroy = vi.fn();
    const ctor = vi.fn(function (this: { destroyEditor?: () => void }) {
      this.destroyEditor = vi.fn();
      return this;
    });
    const onlyOfficeWindow = window as OnlyOfficeWindow;

    onlyOfficeWindow.DocEditor = {
      instances: {
        "office-editor": { destroyEditor: staleDestroy },
      },
    };
    onlyOfficeWindow.DocsAPI = {
      DocEditor: ctor as unknown as OnlyOfficeDocEditorConstructor,
    };

    renderWithProviders(
      <OnlyOfficeDocumentEditor
        id="office-editor"
        documentServerUrl="http://localhost:8082"
        config={{
          document: { key: "deck-key" },
          documentType: "slide",
        }}
      />,
    );

    await waitFor(() => expect(ctor).toHaveBeenCalledTimes(1));

    expect(staleDestroy).toHaveBeenCalledTimes(1);
  });

  it("cleans up the editor instance on unmount", async () => {
    const createdDestroy = vi.fn();
    const replaceChildrenSpy = vi.spyOn(
      HTMLElement.prototype,
      "replaceChildren",
    );
    const ctor = vi.fn(function (this: { destroyEditor?: () => void }) {
      this.destroyEditor = createdDestroy;
      return this;
    });
    const onlyOfficeWindow = window as OnlyOfficeWindow;

    onlyOfficeWindow.DocsAPI = {
      DocEditor: ctor as unknown as OnlyOfficeDocEditorConstructor,
    };

    const view = renderWithProviders(
      <OnlyOfficeDocumentEditor
        id="office-editor"
        documentServerUrl="http://localhost:8082"
        config={{
          document: { key: "deck-key" },
          documentType: "slide",
        }}
      />,
    );

    await waitFor(() => expect(ctor).toHaveBeenCalledTimes(1));
    view.unmount();

    expect(createdDestroy).toHaveBeenCalledTimes(1);
    expect(onlyOfficeWindow.DocEditor?.instances?.["office-editor"]).toBeUndefined();
    expect(replaceChildrenSpy).not.toHaveBeenCalled();

    replaceChildrenSpy.mockRestore();
  });

  it("forwards ONLYOFFICE runtime errors through onEditorError", async () => {
    const onEditorError = vi.fn();
    let capturedConfig: Record<string, unknown> | undefined;
    const ctor = vi.fn(function (
      this: { destroyEditor?: () => void },
      _id: string,
      config: Record<string, unknown>,
    ) {
      capturedConfig = config;
      this.destroyEditor = vi.fn();
      return this;
    });
    const onlyOfficeWindow = window as OnlyOfficeWindow;

    onlyOfficeWindow.DocsAPI = {
      DocEditor: ctor as unknown as OnlyOfficeDocEditorConstructor,
    };

    renderWithProviders(
      <OnlyOfficeDocumentEditor
        id="office-editor"
        documentServerUrl="http://localhost:8082"
        config={{
          document: { key: "deck-key" },
          documentType: "slide",
        }}
        onEditorError={onEditorError}
      />,
    );

    await waitFor(() => expect(ctor).toHaveBeenCalledTimes(1));

    const events = capturedConfig?.events as {
      onError?: (event: {
        data?: { errorCode?: number; errorDescription?: string };
      }) => void;
    };
    expect(events?.onError).toBeTypeOf("function");

    events?.onError?.({
      data: {
        errorCode: 7,
        errorDescription: "The document security token is not correctly formed.",
      },
    });

    expect(onEditorError).toHaveBeenCalledWith(
      7,
      "The document security token is not correctly formed.",
    );
  });
});
