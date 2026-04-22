import { syncCanvasPositionsToStore } from '@/canvas/skia-engine-ref'
import { useDocumentStore } from '@/stores/document-store'
import type { PenDocument } from '@/types/pen'

import {
  getDesignBridgeFileName,
  getDesignBridgeRevision,
  isDesignBridgeSessionExpiredError,
  isDesignBridgeMode,
  saveDesignBridgeDocument,
} from '@/utils/design-bridge'
import {
  downloadDocument,
  isElectron,
  saveDocumentAs,
  supportsFileSystemAccess,
  writeToFileHandle,
  writeToFilePath,
} from '@/utils/file-operations'
import {
  notifyDesignDocumentError,
  notifyDesignDocumentSaved,
  notifyDesignSessionExpired,
} from '@/utils/host-bridge'

function isOpenPencilDocument(fileName: string | null): boolean {
  return fileName ? /\.op$/i.test(fileName) : false
}

function buildSuggestedFileName(fileName: string | null): string {
  return fileName
    ? fileName.replace(/\.(pen|op|json)$/i, '') + '.op'
    : 'untitled.op'
}

async function saveThroughBridge(
  document: PenDocument,
  fallbackTargetPath: string | null,
): Promise<void> {
  try {
    const payload = await saveDesignBridgeDocument(document)
    useDocumentStore.setState({
      fileName: getDesignBridgeFileName(payload.target_path),
      filePath: payload.target_path,
      fileHandle: null,
      isDirty: false,
    })
    notifyDesignDocumentSaved({
      targetPath: payload.target_path,
      revision: payload.revision,
    })
  } catch (error) {
    if (isDesignBridgeSessionExpiredError(error)) {
      notifyDesignSessionExpired({
        targetPath: fallbackTargetPath ?? 'unknown',
        revision: getDesignBridgeRevision(),
        error:
          error instanceof Error
            ? error.message
            : 'The Deer Flow design session expired. Reopen the design board to continue syncing.',
      })
      throw error
    }

    notifyDesignDocumentError({
      targetPath: fallbackTargetPath ?? 'unknown',
      error:
        error instanceof Error
          ? error.message
          : 'Failed to save design document',
      phase: 'save',
    })
    throw error
  }
}

async function trySaveInPlace(
  document: PenDocument,
  fileName: string | null,
  fileHandle: FileSystemFileHandle | null,
  filePath: string | null,
): Promise<boolean> {
  if (isElectron() && filePath && isOpenPencilDocument(fileName)) {
    await writeToFilePath(filePath, document)
    useDocumentStore.getState().markClean()
    return true
  }

  if (!fileHandle || !isOpenPencilDocument(fileName)) {
    return false
  }

  try {
    await writeToFileHandle(fileHandle, document)
    useDocumentStore.getState().markClean()
    return true
  } catch (error) {
    console.warn('[Save] File handle write failed, falling back:', error)
    useDocumentStore.setState({ fileHandle: null })
    return false
  }
}

async function saveAsNewDocument(
  document: PenDocument,
  suggestedName: string,
): Promise<void> {
  if (isElectron()) {
    const savedPath = await window.electronAPI!.saveFile(
      JSON.stringify(document),
      suggestedName,
    )
    if (!savedPath) {
      return
    }

    useDocumentStore.setState({
      fileName: savedPath.split(/[/\\]/).pop() || suggestedName,
      filePath: savedPath,
      fileHandle: null,
      isDirty: false,
    })
    return
  }

  if (supportsFileSystemAccess()) {
    const result = await saveDocumentAs(document, suggestedName)
    if (!result) {
      return
    }

    useDocumentStore.setState({
      fileName: result.fileName,
      fileHandle: result.handle,
      isDirty: false,
    })
    return
  }

  downloadDocument(document, suggestedName)
  useDocumentStore.getState().markClean()
}

// Toolbar saves and keyboard saves must stay identical. Centralising the save
// contract here keeps bridge-mode, in-place writes, and browser fallback paths
// from drifting apart when the editor adds new save entry points.
export async function saveCurrentDocument(): Promise<void> {
  try {
    syncCanvasPositionsToStore()
  } catch (error) {
    console.error('[Save] syncCanvasPositionsToStore failed:', error)
  }

  const { document, fileName, fileHandle, filePath } = useDocumentStore.getState()
  const suggestedName = buildSuggestedFileName(fileName)
  const bridgeMode = isDesignBridgeMode()

  try {
    if (bridgeMode) {
      await saveThroughBridge(document, filePath)
      return
    }

    if (await trySaveInPlace(document, fileName, fileHandle, filePath)) {
      return
    }

    await saveAsNewDocument(document, suggestedName)
  } catch (error) {
    console.error('[Save] Failed to save document:', error)

    if (bridgeMode) {
      return
    }

    try {
      downloadDocument(document, suggestedName)
      useDocumentStore.getState().markClean()
    } catch (downloadError) {
      console.error('[Save] Download fallback also failed:', downloadError)
    }
  }
}
