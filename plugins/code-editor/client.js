window.__ModuleLoader__.load({
  id: '@sredevopsorg/dsh-code-editor',
  factory(require) {
    const React = require('react');
    const { useCallback, useEffect, useMemo, useRef, useState } = React;
    const h = React.createElement;

    const ID = '@sredevopsorg/dsh-code-editor';
    const KIND = 'dsh-code-editor';
    const NS = 'codeEditor';
    const ENDPOINT = '__dsh-code-editor/write';
    const MAX_FILE_BYTES = 1024 * 1024;
    const MAX_LINES = 20000;
    const LINE_HEIGHT = 20;
    const EDITOR_PADDING = 8;
    const DRAFT_ENTRY_LIMIT = 20;
    const DRAFT_BYTE_LIMIT = 8 * 1024 * 1024;

    const encoder = new TextEncoder();
    const decoder = new TextDecoder('utf-8', { fatal: true });

    /** @type {Map<string, {text: string, version: string, bytes: number}>} */
    const drafts = new Map();
    let draftBytes = 0;
    /** @type {Map<string, string>} */
    const lastDirectory = new Map();

    const EN = {
      'tab.title': 'Code editor',
      'guide.title': 'Code editor',
      'guide.description': 'Browse workspace files and edit text files.',
      'browser.title': 'Workspace files',
      'browser.root': 'Workspace root',
      'browser.up': 'Up one directory',
      'browser.refresh': 'Refresh directory',
      'browser.loading': 'Loading directory…',
      'browser.empty': 'This directory is empty.',
      'browser.errorTitle': 'Directory unavailable',
      'browser.retry': 'Retry',
      'browser.notFound': 'The directory no longer exists.',
      'browser.outside': 'The directory is outside the workspace.',
      'browser.notDirectory': 'The path is not a directory.',
      'browser.unavailable': 'The directory is unavailable. {message}',
      'browser.truncated': 'The listing was truncated by the Host.',
      'browser.folder': 'Folder',
      'browser.file': 'File',
      'browser.noWorkspace': 'This Session has no workspace directory.',
      'editor.loading': 'Loading file…',
      'editor.retry': 'Retry',
      'editor.back': 'Back to files',
      'editor.save': 'Save file',
      'editor.saving': 'Saving…',
      'editor.saved': 'File saved.',
      'editor.reload': 'Reload from disk',
      'editor.discard': 'Discard changes',
      'editor.discarded': 'Changes discarded.',
      'editor.unsaved': 'Unsaved changes',
      'editor.draftRestored': 'An unsaved draft was restored.',
      'editor.conflict': 'The file changed on disk. Reload it or overwrite the newer content.',
      'editor.conflict.reload': 'Reload from disk',
      'editor.conflict.overwrite': 'Overwrite',
      'editor.readOnly': 'This Session is read-only. Change its file policy before saving.',
      'editor.authFailed': 'The browser session expired. Reload the page to continue.',
      'editor.sessionInactive': 'The Session is not active. Open the Session before saving.',
      'editor.saveFailed': 'The file could not be saved. {message}',
      'editor.tooLarge': 'This file is larger than 1 MiB and is opened read-only.',
      'editor.tooManyLines': 'This file has more than 20,000 lines and is opened read-only.',
      'editor.binary': 'This file is not valid UTF-8 text and is opened read-only.',
      'editor.notFound': 'The file no longer exists.',
      'editor.unavailable': 'The file could not be read. {message}',
      'editor.noFile': 'Choose a file from the workspace to edit it.',
      'editor.lineColumn': 'Ln {line}, Col {column}',
      'editor.encoding': 'UTF-8',
      'editor.dirty': 'Modified',
      'editor.clean': 'Saved',
      'editor.emptyReadOnly': 'No text preview is available for this file.',
      'editor.status': 'File status',
      'editor.bytes': '{bytes}',
      'editor.files': 'Files',
    };

    const ES = {
      'tab.title': 'Editor de código',
      'guide.title': 'Editor de código',
      'guide.description': 'Explora los archivos del espacio de trabajo y edita archivos de texto.',
      'browser.title': 'Archivos del espacio de trabajo',
      'browser.root': 'Raíz del espacio de trabajo',
      'browser.up': 'Subir un directorio',
      'browser.refresh': 'Actualizar directorio',
      'browser.loading': 'Cargando directorio…',
      'browser.empty': 'Este directorio está vacío.',
      'browser.errorTitle': 'Directorio no disponible',
      'browser.retry': 'Reintentar',
      'browser.notFound': 'El directorio ya no existe.',
      'browser.outside': 'El directorio está fuera del espacio de trabajo.',
      'browser.notDirectory': 'La ruta no es un directorio.',
      'browser.unavailable': 'El directorio no está disponible. {message}',
      'browser.truncated': 'El Host truncó el listado.',
      'browser.folder': 'Carpeta',
      'browser.file': 'Archivo',
      'browser.noWorkspace': 'Esta sesión no tiene un directorio de trabajo.',
      'editor.loading': 'Cargando archivo…',
      'editor.retry': 'Reintentar',
      'editor.back': 'Volver a los archivos',
      'editor.save': 'Guardar archivo',
      'editor.saving': 'Guardando…',
      'editor.saved': 'Archivo guardado.',
      'editor.reload': 'Recargar desde el disco',
      'editor.discard': 'Descartar cambios',
      'editor.discarded': 'Cambios descartados.',
      'editor.unsaved': 'Cambios sin guardar',
      'editor.draftRestored': 'Se restauró un borrador sin guardar.',
      'editor.conflict': 'El archivo cambió en el disco. Recárgalo o sobrescribe el contenido más reciente.',
      'editor.conflict.reload': 'Recargar desde el disco',
      'editor.conflict.overwrite': 'Sobrescribir',
      'editor.readOnly': 'Esta sesión es de solo lectura. Cambia su política de archivos antes de guardar.',
      'editor.authFailed': 'La sesión del navegador expiró. Recarga la página para continuar.',
      'editor.sessionInactive': 'La sesión no está activa. Abre la sesión antes de guardar.',
      'editor.saveFailed': 'No se pudo guardar el archivo. {message}',
      'editor.tooLarge': 'Este archivo supera 1 MiB y se abre en solo lectura.',
      'editor.tooManyLines': 'Este archivo tiene más de 20.000 líneas y se abre en solo lectura.',
      'editor.binary': 'Este archivo no es texto UTF-8 válido y se abre en solo lectura.',
      'editor.notFound': 'El archivo ya no existe.',
      'editor.unavailable': 'No se pudo leer el archivo. {message}',
      'editor.noFile': 'Elige un archivo del espacio de trabajo para editarlo.',
      'editor.lineColumn': 'Ln {line}, Col {column}',
      'editor.encoding': 'UTF-8',
      'editor.dirty': 'Modificado',
      'editor.clean': 'Guardado',
      'editor.emptyReadOnly': 'No hay una vista de texto disponible para este archivo.',
      'editor.status': 'Estado del archivo',
      'editor.bytes': '{bytes}',
      'editor.files': 'Archivos',
    };

    // ---------------------------------------------------------------- helpers

    function byteLength(text) {
      return encoder.encode(text).length;
    }

    function countLines(text) {
      let count = 1;
      for (let index = 0; index < text.length; index += 1) {
        if (text.charCodeAt(index) === 10) count += 1;
      }
      return count;
    }

    function cursorPosition(text, offset) {
      const limit = Math.max(0, Math.min(offset, text.length));
      let line = 1;
      let column = 1;
      for (let index = 0; index < limit; index += 1) {
        if (text.charCodeAt(index) === 10) {
          line += 1;
          column = 1;
        } else {
          column += 1;
        }
      }
      return { line, column };
    }

    function joinPath(directory, name) {
      return directory.length === 0 ? name : `${directory}/${name}`;
    }

    function parentPath(path) {
      const slash = path.lastIndexOf('/');
      return slash === -1 ? '' : path.slice(0, slash);
    }

    function baseName(path) {
      const slash = path.lastIndexOf('/');
      return slash === -1 ? path : path.slice(slash + 1);
    }

    function formatBytes(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
    }

    function draftKey(sessionId, path) {
      return `${sessionId}\u0000${path}`;
    }

    function getDraft(key) {
      return drafts.get(key);
    }

    function removeDraft(key) {
      const existing = drafts.get(key);
      if (existing === undefined) return;
      draftBytes -= existing.bytes;
      drafts.delete(key);
    }

    function pushDraft(key, text, version) {
      removeDraft(key);
      const bytes = byteLength(text);
      drafts.set(key, { text, version, bytes });
      draftBytes += bytes;
      while (
        drafts.size > DRAFT_ENTRY_LIMIT ||
        (draftBytes > DRAFT_BYTE_LIMIT && drafts.size > 1)
      ) {
        const oldest = drafts.keys().next().value;
        if (oldest === undefined) break;
        removeDraft(oldest);
      }
    }

    function endpointUrl() {
      const base = new URL('.', document.baseURI || window.location.href);
      return new URL(ENDPOINT, base);
    }

    function failureText(failure, t) {
      const code = failure === undefined || failure === null ? undefined : failure.code;
      if (code === 'workspace-file/not-found') return t('browser.notFound');
      if (code === 'workspace-file/outside-workspace') return t('browser.outside');
      if (code === 'workspace-file/not-directory') return t('browser.notDirectory');
      return t('browser.unavailable', { message: failure?.message ?? '' });
    }

    // ---------------------------------------------------------------- icons

    function makeIcon(paths, options = {}) {
      const viewBox = options.viewBox ?? '0 0 24 24';
      return function Icon({ size = 16, className }) {
        return h(
          'svg',
          {
            viewBox,
            width: size,
            height: size,
            className,
            'aria-hidden': true,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: options.strokeWidth ?? 1.7,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          paths.map((definition, index) =>
            h('path', { key: index, d: definition }),
          ),
        );
      };
    }

    const EditorIcon = makeIcon(
      ['M6 3h8l4 4v14H6z', 'M14 3v4h4', 'M9.5 12.5 7 15l2.5 2.5', 'M14.5 12.5 17 15l-2.5 2.5', 'M12.5 11.5l-1 7'],
    );
    const BackIcon = makeIcon(['M15 5l-7 7 7 7']);
    const UpIcon = makeIcon(['M12 19V5', 'M5 12l7-7 7 7']);
    const RefreshIcon = makeIcon(['M20 12a8 8 0 1 1-2.3-5.6', 'M20 4v5h-5']);
    const SaveIcon = makeIcon(['M5 4h11l3 3v13H5z', 'M8 4v6h7V4', 'M8 14h8v6H8z']);
    const DiscardIcon = makeIcon(['M5 7h14', 'M9 7V4h6v3', 'M7 7l1 13h8l1-13']);
    const FolderIcon = makeIcon(['M3 7h6l2 2h10v10H3z']);
    const FileIcon = makeIcon(['M6 3h8l4 4v14H6z', 'M14 3v4h4']);
    const ChevronIcon = makeIcon(['M9 6l6 6-6 6']);

    // ---------------------------------------------------------------- styles

    const CSS = `
.dsh-code-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.4;
}
.dsh-code-editor * { box-sizing: border-box; }
.dsh-code-editor-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-height: 40px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1));
}
.dsh-code-editor-heading {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1 1 auto;
}
.dsh-code-editor-title {
  font-weight: 600;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-code-editor-subtitle {
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-code-editor-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}
.dsh-code-editor-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 28px;
  height: 28px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.dsh-code-editor-button:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.dsh-code-editor-button:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.dsh-code-editor-button:disabled { opacity: 0.45; cursor: default; }
.dsh-code-editor-button.is-primary {
  background: var(--dsw-alias-brand-primary);
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base);
}
.dsh-code-editor-button.is-primary:hover:not(:disabled) {
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base);
  opacity: 0.92;
}
.dsh-code-editor-button.is-danger { color: var(--dsw-alias-state-error-primary); }
.dsh-code-editor-button.is-icon { padding: 0; width: 28px; }
.dsh-code-editor-breadcrumb {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
}
.dsh-code-editor-crumb {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  padding: 1px 3px;
  border-radius: 4px;
  cursor: pointer;
}
.dsh-code-editor-crumb:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-code-editor-crumb.is-current { color: var(--dsw-alias-label-primary); font-weight: 600; }
.dsh-code-editor-separator { color: var(--dsw-alias-state-idle-primary); }
.dsh-code-editor-dirty-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dsw-alias-brand-primary);
  flex: none;
}
.dsh-code-editor-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.dsh-code-editor-banner.is-error { color: var(--dsw-alias-state-error-primary); }
.dsh-code-editor-banner.is-warn { color: var(--dsw-alias-state-warn-primary); }
.dsh-code-editor-banner.is-success { color: var(--dsw-alias-state-success-primary); }
.dsh-code-editor-banner-text { flex: 1 1 auto; min-width: 0; }
.dsh-code-editor-banner-actions { display: flex; gap: 4px; flex: none; }
.dsh-code-editor-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
.dsh-code-editor-list { padding: 4px; }
.dsh-code-editor-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 30px;
  padding: 3px 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.dsh-code-editor-row:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.dsh-code-editor-row:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.dsh-code-editor-row:disabled { opacity: 0.5; cursor: default; }
.dsh-code-editor-row-icon { display: inline-flex; color: var(--dsw-alias-state-idle-primary); flex: none; }
.dsh-code-editor-row.is-directory .dsh-code-editor-row-icon { color: var(--dsw-alias-brand-primary); }
.dsh-code-editor-row-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-code-editor-row-meta {
  flex: none;
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.dsh-code-editor-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  min-height: 120px;
  padding: 24px;
  color: var(--dsw-alias-label-secondary);
  text-align: center;
  font-size: 12px;
}
.dsh-code-editor-empty-title { color: var(--dsw-alias-label-primary); font-weight: 600; }
.dsh-code-editor-empty-icon { color: var(--dsw-alias-state-idle-primary); }
.dsh-code-editor-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.dsh-code-editor-pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--dsw-alias-brand-primary);
  animation: dsh-code-editor-pulse 1.1s ease-in-out infinite;
}
@keyframes dsh-code-editor-pulse {
  0%, 100% { opacity: 0.35; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1); }
}
.dsh-code-editor-surface {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
  border-top: 0;
}
.dsh-code-editor-gutter {
  position: relative;
  flex: none;
  overflow: hidden;
  border-right: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-state-idle-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: ${LINE_HEIGHT}px;
  text-align: right;
  user-select: none;
}
.dsh-code-editor-gutter-inner { position: absolute; left: 0; right: 0; }
.dsh-code-editor-line-number { height: ${LINE_HEIGHT}px; padding: 0 8px 0 6px; }
.dsh-code-editor-textarea {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  margin: 0;
  padding: ${EDITOR_PADDING}px 12px;
  border: 0;
  outline: none;
  resize: none;
  overflow: auto;
  white-space: pre;
  tab-size: 2;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  caret-color: var(--dsw-alias-brand-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: ${LINE_HEIGHT}px;
}
.dsh-code-editor-textarea:focus-visible { outline: none; }
.dsh-code-editor-readonly {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  padding: ${EDITOR_PADDING}px 12px;
  overflow: auto;
  white-space: pre;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: ${LINE_HEIGHT}px;
}
.dsh-code-editor-status {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  min-height: 26px;
  padding: 3px 10px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.dsh-code-editor-status-item { white-space: nowrap; }
.dsh-code-editor-status-item.is-dirty { color: var(--dsw-alias-brand-primary); }
.dsh-code-editor-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
`;

    // ---------------------------------------------------------------- chunk

    /**
     * Build the right-sidebar tab body component.
     * @param {object} ctx - Client context.
     * @param {(key: string, params?: Record<string, string>) => string} t - Bound translator.
     */
    function createEditorBody(ctx, t) {
      return function EditorBody(props) {
        const tr = typeof props.t === 'function' ? props.t : t;
        const { tab } = props.useTabInfo();
        const sessionId = props.sessionId;
        const cwd = props.useSessions(
          (sessions) => sessions.byId[sessionId]?.cwd,
        );

        const [mode, setMode] = useState('browse');
        const [directory, setDirectory] = useState(() => lastDirectory.get(sessionId) ?? '');
        const [listing, setListing] = useState({
          status: 'idle',
          entries: [],
          truncated: false,
          error: undefined,
        });
        const [refreshToken, setRefreshToken] = useState(0);
        const [file, setFileState] = useState(null);
        const [dirty, setDirty] = useState(false);
        const [saving, setSaving] = useState(false);
        const [notice, setNotice] = useState(null);
        const [conflict, setConflict] = useState(null);
        const [draftRestored, setDraftRestored] = useState(false);
        const [cursor, setCursor] = useState({ line: 1, column: 1 });
        const [scrollTop, setScrollTop] = useState(0);
        const [viewportHeight, setViewportHeight] = useState(240);

        const fileRef = useRef(null);
        const savingRef = useRef(false);
        const requestRef = useRef(0);
        const fileAbortRef = useRef(null);
        const saveAbortRef = useRef(null);
        const textareaRef = useRef(null);
        const surfaceRef = useRef(null);

        const setFile = useCallback((next) => {
          fileRef.current = next;
          setFileState(next);
        }, []);

        useEffect(() => {
          savingRef.current = saving;
        }, [saving]);

        useEffect(() => {
          return () => {
            if (fileAbortRef.current !== null) fileAbortRef.current.abort();
            if (saveAbortRef.current !== null) saveAbortRef.current.abort();
          };
        }, []);

        useEffect(() => {
          if (fileAbortRef.current !== null) fileAbortRef.current.abort();
          if (saveAbortRef.current !== null) saveAbortRef.current.abort();
          requestRef.current += 1;
          setMode('browse');
          setDirectory(lastDirectory.get(sessionId) ?? '');
          setFile(null);
          setDirty(false);
          setNotice(null);
          setConflict(null);
          setDraftRestored(false);
          setCursor({ line: 1, column: 1 });
        }, [sessionId, setFile]);

        useEffect(() => {
          if (notice === null || (notice.kind !== 'success' && notice.kind !== 'info')) {
            return undefined;
          }
          const handle = setTimeout(() => setNotice(null), 2600);
          return () => clearTimeout(handle);
        }, [notice]);

        useEffect(() => {
          if (mode !== 'browse' || cwd === undefined) return undefined;
          const controller = new AbortController();
          let active = true;
          setListing({
            status: 'loading',
            entries: [],
            truncated: false,
            error: undefined,
          });
          ctx.remote.workspaceFiles
            .list(sessionId, directory.length === 0 ? '.' : directory, controller.signal)
            .then((result) => {
              if (!active || controller.signal.aborted) return;
              if (!result.ok) {
                setListing({
                  status: 'error',
                  entries: [],
                  truncated: false,
                  error: failureText(result.error, t),
                });
                return;
              }
              setListing({
                status: 'ready',
                entries: result.value.entries,
                truncated: result.value.truncated,
                error: undefined,
              });
            })
            .catch((error) => {
              if (!active || controller.signal.aborted) return;
              setListing({
                status: 'error',
                entries: [],
                truncated: false,
                error: t('browser.unavailable', { message: error?.message ?? '' }),
              });
            });
          return () => {
            active = false;
            controller.abort();
          };
        }, [mode, directory, sessionId, cwd, refreshToken]);

        useEffect(() => {
          if (mode !== 'edit') return undefined;
          const element = textareaRef.current;
          if (element === null) return undefined;
          const measure = () => setViewportHeight(element.clientHeight);
          measure();
          if (typeof ResizeObserver === 'function') {
            const observer = new ResizeObserver(measure);
            observer.observe(element);
            return () => observer.disconnect();
          }
          window.addEventListener('resize', measure);
          return () => window.removeEventListener('resize', measure);
        }, [mode, file === null ? null : file.status]);

        const openDirectory = useCallback((path) => {
          lastDirectory.set(sessionId, path);
          setDirectory(path);
          setMode('browse');
          setConflict(null);
          setNotice(null);
        }, [sessionId]);

        const openFile = useCallback((path) => {
          if (fileAbortRef.current !== null) fileAbortRef.current.abort();
          const controller = new AbortController();
          fileAbortRef.current = controller;
          const generation = requestRef.current + 1;
          requestRef.current = generation;
          setMode('edit');
          setConflict(null);
          setNotice(null);
          setDraftRestored(false);
          setDirty(false);
          setFile({ status: 'loading', path });

          const run = async () => {
            const stat = await ctx.remote.workspaceFiles.stat(sessionId, path, controller.signal);
            if (controller.signal.aborted || generation !== requestRef.current) return;
            if (!stat.ok) {
              setFile({
                status: stat.error?.code === 'workspace-file/not-found' ? 'missing' : 'error',
                path,
                message:
                  stat.error?.code === 'workspace-file/not-found'
                    ? t('editor.notFound')
                    : t('editor.unavailable', { message: stat.error?.message ?? '' }),
              });
              return;
            }
            if (typeof stat.value.bytes === 'number' && stat.value.bytes > MAX_FILE_BYTES) {
              setFile({
                status: 'readonly',
                path,
                reason: 'tooLarge',
                message: t('editor.tooLarge'),
                version: stat.value.version,
                bytes: stat.value.bytes,
                text: null,
              });
              return;
            }
            const read = await ctx.remote.workspaceFiles.readBytes(
              sessionId,
              path,
              {},
              controller.signal,
            );
            if (controller.signal.aborted || generation !== requestRef.current) return;
            if (!read.ok) {
              setFile({
                status: read.error?.code === 'workspace-file/not-found' ? 'missing' : 'error',
                path,
                message:
                  read.error?.code === 'workspace-file/not-found'
                    ? t('editor.notFound')
                    : t('editor.unavailable', { message: read.error?.message ?? '' }),
              });
              return;
            }
            const data = read.value.data;
            if (data.byteLength > MAX_FILE_BYTES) {
              setFile({
                status: 'readonly',
                path,
                reason: 'tooLarge',
                message: t('editor.tooLarge'),
                version: read.value.version,
                bytes: data.byteLength,
                text: null,
              });
              return;
            }
            let text;
            try {
              text = decoder.decode(data);
            } catch {
              setFile({
                status: 'readonly',
                path,
                reason: 'binary',
                message: t('editor.binary'),
                version: read.value.version,
                bytes: data.byteLength,
                text: null,
              });
              return;
            }
            if (text.includes('\u0000')) {
              setFile({
                status: 'readonly',
                path,
                reason: 'binary',
                message: t('editor.binary'),
                version: read.value.version,
                bytes: data.byteLength,
                text: null,
              });
              return;
            }
            if (countLines(text) > MAX_LINES) {
              setFile({
                status: 'readonly',
                path,
                reason: 'tooManyLines',
                message: t('editor.tooManyLines'),
                version: read.value.version,
                bytes: data.byteLength,
                text,
              });
              return;
            }
            const key = draftKey(sessionId, path);
            const draft = getDraft(key);
            if (draft !== undefined && draft.text === text) removeDraft(key);
            const restored = draft !== undefined && draft.text !== text;
            setFile({
              status: 'ready',
              path,
              absolutePath: read.value.absolutePath,
              version: read.value.version,
              expectedVersion: restored ? draft.version ?? read.value.version : read.value.version,
              text: restored ? draft.text : text,
              original: text,
              bytes: read.value.bytes ?? data.byteLength,
            });
            setDirty(restored);
            setDraftRestored(restored);
            setCursor({ line: 1, column: 1 });
            setScrollTop(0);
          };

          run().catch((error) => {
            if (controller.signal.aborted || generation !== requestRef.current) return;
            setFile({
              status: 'error',
              path,
              message: t('editor.unavailable', { message: error?.message ?? '' }),
            });
          });
        }, [sessionId, setFile]);

        const updateText = useCallback((nextText, selectionOffset) => {
          const current = fileRef.current;
          if (current === null || current.status !== 'ready') return;
          const isDirty = nextText !== current.original;
          const next = {
            ...current,
            text: nextText,
            bytes: byteLength(nextText),
            expectedVersion: isDirty ? current.expectedVersion : current.version,
          };
          fileRef.current = next;
          setFileState(next);
          setDirty(isDirty);
          const key = draftKey(sessionId, current.path);
          if (isDirty) pushDraft(key, nextText, current.expectedVersion);
          else removeDraft(key);
          if (typeof selectionOffset === 'number') {
            setCursor(cursorPosition(nextText, selectionOffset));
          }
        }, [sessionId]);

        const save = useCallback(async (force) => {
          const current = fileRef.current;
          if (
            current === null ||
            current.status !== 'ready' ||
            savingRef.current
          ) {
            return;
          }
          savingRef.current = true;
          setSaving(true);
          setConflict(null);
          setNotice(null);
          const controller = new AbortController();
          saveAbortRef.current = controller;
          try {
            const response = await fetch(endpointUrl(), {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sessionId,
                path: current.path,
                content: current.text,
                expectedVersion: current.expectedVersion,
                force: force === true,
              }),
              signal: controller.signal,
            });
            let payload = null;
            try {
              payload = await response.json();
            } catch {
              payload = null;
            }
            if (!response.ok) {
              if (response.status === 409) {
                setConflict({ version: payload?.version });
                setNotice({ kind: 'error', text: tr('editor.conflict') });
                return;
              }
              if (payload?.code === 'read-only') {
                setNotice({ kind: 'error', text: tr('editor.readOnly') });
                return;
              }
              if (payload?.code === 'session-not-found') {
                setNotice({ kind: 'error', text: tr('editor.sessionInactive') });
                return;
              }
              if (payload?.code === 'file-not-found' || payload?.code === 'not-a-regular-file') {
                setNotice({ kind: 'error', text: tr('editor.notFound') });
                return;
              }
              if (response.status === 401) {
                setNotice({ kind: 'error', text: tr('editor.authFailed') });
                return;
              }
              setNotice({
                kind: 'error',
                text: tr('editor.saveFailed', {
                  message: payload?.message ?? response.statusText ?? '',
                }),
              });
              return;
            }
            const next = {
              ...current,
              version: payload?.version ?? current.expectedVersion,
              expectedVersion: payload?.version ?? current.expectedVersion,
              original: current.text,
              bytes: byteLength(current.text),
            };
            fileRef.current = next;
            setFileState(next);
            removeDraft(draftKey(sessionId, current.path));
            setDirty(false);
            setDraftRestored(false);
            setNotice({ kind: 'success', text: tr('editor.saved') });
          } catch (error) {
            if (error?.name === 'AbortError') return;
            setNotice({
              kind: 'error',
              text: tr('editor.saveFailed', { message: error?.message ?? String(error) }),
            });
          } finally {
            if (saveAbortRef.current === controller) saveAbortRef.current = null;
            savingRef.current = false;
            setSaving(false);
          }
        }, [sessionId, tr]);

        const reload = useCallback(() => {
          const current = fileRef.current;
          if (current === null) return;
          removeDraft(draftKey(sessionId, current.path));
          openFile(current.path);
        }, [openFile, sessionId]);

        const discard = useCallback(() => {
          const current = fileRef.current;
          if (current === null || current.status !== 'ready') return;
          removeDraft(draftKey(sessionId, current.path));
          const next = {
            ...current,
            text: current.original,
            bytes: byteLength(current.original),
            expectedVersion: current.version,
          };
          fileRef.current = next;
          setFileState(next);
          setDirty(false);
          setDraftRestored(false);
          setConflict(null);
          setNotice({ kind: 'info', text: tr('editor.discarded') });
        }, [sessionId, tr]);

        const insertTab = useCallback((element) => {
          const start = element.selectionStart;
          const end = element.selectionEnd;
          const current = fileRef.current;
          if (current === null || current.status !== 'ready') return;
          const nextText = `${current.text.slice(0, start)}  ${current.text.slice(end)}`;
          updateText(nextText, start + 2);
          requestAnimationFrame(() => {
            if (textareaRef.current === null) return;
            textareaRef.current.selectionStart = start + 2;
            textareaRef.current.selectionEnd = start + 2;
          });
        }, [updateText]);

        const handleKeyDown = useCallback((event) => {
          if ((event.metaKey || event.ctrlKey) && (event.key === 's' || event.key === 'S')) {
            event.preventDefault();
            save(false);
            return;
          }
          if (event.key === 'Tab' && !event.shiftKey) {
            event.preventDefault();
            insertTab(event.currentTarget);
          }
        }, [insertTab, save]);

        const handleChange = useCallback((event) => {
          const element = event.currentTarget;
          updateText(element.value, element.selectionStart);
        }, [updateText]);

        const handleSelection = useCallback((event) => {
          const element = event.currentTarget;
          const current = fileRef.current;
          if (current === null || current.status !== 'ready') return;
          setCursor(cursorPosition(current.text, element.selectionStart));
        }, []);

        const handleScroll = useCallback((event) => {
          setScrollTop(event.currentTarget.scrollTop);
        }, []);

        const lineCount = useMemo(() => {
          if (file === null || file.status !== 'ready') return 0;
          return countLines(file.text);
        }, [file]);

        const firstVisible = Math.max(
          0,
          Math.floor((scrollTop - EDITOR_PADDING) / LINE_HEIGHT) - 8,
        );
        const visibleCount = Math.ceil((viewportHeight || 240) / LINE_HEIGHT) + 16;
        const lastVisible = Math.min(lineCount, firstVisible + visibleCount);
        const lineNumbers = [];
        for (let number = firstVisible + 1; number <= lastVisible; number += 1) {
          lineNumbers.push(number);
        }
        const gutterWidth = Math.max(2, String(Math.max(1, lineCount)).length) * 8 + 20;

        const workspaceName = cwd === undefined ? '' : (baseName(cwd) || cwd);
        const segments = directory.length === 0 ? [] : directory.split('/');

        const renderBreadcrumb = () => {
          const crumbs = [];
          crumbs.push(
            h('button', {
              key: 'root',
              type: 'button',
              className: `dsh-code-editor-crumb${directory.length === 0 ? ' is-current' : ''}`,
              title: cwd,
              onClick: () => openDirectory(''),
            }, workspaceName || tr('browser.root')),
          );
          let accumulated = '';
          segments.forEach((segment, index) => {
            accumulated = accumulated.length === 0 ? segment : `${accumulated}/${segment}`;
            const target = accumulated;
            const isCurrent = index === segments.length - 1;
            crumbs.push(h('span', {
              key: `separator-${target}`,
              className: 'dsh-code-editor-separator',
              'aria-hidden': true,
            }, '/'));
            crumbs.push(
              h('button', {
                key: target,
                type: 'button',
                className: `dsh-code-editor-crumb${isCurrent ? ' is-current' : ''}`,
                title: target,
                onClick: () => openDirectory(target),
              }, segment),
            );
          });
          return h('div', { className: 'dsh-code-editor-breadcrumb' }, crumbs);
        };

        const renderBrowseHeader = () => h(
          'div',
          { className: 'dsh-code-editor-header' },
          h(
            'div',
            { className: 'dsh-code-editor-heading' },
            h(FolderIcon, { size: 15 }),
            h('span', { className: 'dsh-code-editor-title' }, tr('browser.title')),
          ),
          renderBreadcrumb(),
          h(
            'div',
            { className: 'dsh-code-editor-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-code-editor-button is-icon',
                title: tr('browser.up'),
                'aria-label': tr('browser.up'),
                disabled: directory.length === 0,
                onClick: () => openDirectory(parentPath(directory)),
              },
              h(UpIcon),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-code-editor-button is-icon',
                title: tr('browser.refresh'),
                'aria-label': tr('browser.refresh'),
                disabled: listing.status === 'loading',
                onClick: () => setRefreshToken((value) => value + 1),
              },
              h(RefreshIcon),
            ),
          ),
        );

        const renderBanners = () => {
          const banners = [];
          if (notice !== null) {
            banners.push(h(
              'div',
              {
                key: 'notice',
                className: `dsh-code-editor-banner is-${notice.kind}`,
                role: notice.kind === 'error' ? 'alert' : 'status',
              },
              h('span', { className: 'dsh-code-editor-banner-text' }, notice.text),
            ));
          }
          if (draftRestored) {
            banners.push(h(
              'div',
              { key: 'draft', className: 'dsh-code-editor-banner is-info', role: 'status' },
              h('span', { className: 'dsh-code-editor-banner-text' }, tr('editor.draftRestored')),
              h('div', { className: 'dsh-code-editor-banner-actions' },
                h('button', {
                  type: 'button',
                  className: 'dsh-code-editor-button',
                  onClick: discard,
                }, tr('editor.discard'))),
            ));
          }
          if (mode === 'edit' && file !== null && file.status === 'readonly') {
            banners.push(h(
              'div',
              { key: 'readonly', className: 'dsh-code-editor-banner is-warn', role: 'status' },
              h('span', { className: 'dsh-code-editor-banner-text' }, file.message),
            ));
          }
          if (conflict !== null) {
            banners.push(h(
              'div',
              { key: 'conflict', className: 'dsh-code-editor-banner is-error', role: 'alert' },
              h('span', { className: 'dsh-code-editor-banner-text' }, tr('editor.conflict')),
              h('div', { className: 'dsh-code-editor-banner-actions' },
                h('button', {
                  type: 'button',
                  className: 'dsh-code-editor-button',
                  onClick: reload,
                }, tr('editor.conflict.reload')),
                h('button', {
                  type: 'button',
                  className: 'dsh-code-editor-button is-danger',
                  onClick: () => save(true),
                }, tr('editor.conflict.overwrite'))),
            ));
          }
          return banners.length === 0 ? null : banners;
        };

        const renderBrowse = () => {
          if (cwd === undefined) {
            return h('div', { className: 'dsh-code-editor-empty' },
              h('div', { className: 'dsh-code-editor-empty-icon' }, h(FolderIcon, { size: 28 })),
              h('div', { className: 'dsh-code-editor-empty-title' }, tr('browser.title')),
              h('div', null, tr('browser.noWorkspace')));
          }
          if (listing.status === 'loading' || listing.status === 'idle') {
            return h('div', { className: 'dsh-code-editor-loading' },
              h('span', { className: 'dsh-code-editor-pulse' }),
              h('span', null, tr('browser.loading')));
          }
          if (listing.status === 'error') {
            return h('div', { className: 'dsh-code-editor-empty' },
              h('div', { className: 'dsh-code-editor-empty-icon' }, h(FolderIcon, { size: 28 })),
              h('div', { className: 'dsh-code-editor-empty-title' }, tr('browser.errorTitle')),
              h('div', null, listing.error),
              h('button', {
                type: 'button',
                className: 'dsh-code-editor-button',
                onClick: () => setRefreshToken((value) => value + 1),
              }, tr('browser.retry')));
          }
          if (listing.entries.length === 0) {
            return h('div', { className: 'dsh-code-editor-empty' },
              h('div', { className: 'dsh-code-editor-empty-icon' }, h(FolderIcon, { size: 28 })),
              h('div', { className: 'dsh-code-editor-empty-title' }, tr('browser.empty')));
          }
          const rows = listing.entries.map((entry) => {
            const isDirectory = entry.type === 'directory';
            const isFile = entry.type === 'file';
            const target = joinPath(directory, entry.name);
            return h(
              'button',
              {
                key: entry.name,
                type: 'button',
                className: `dsh-code-editor-row${isDirectory ? ' is-directory' : ''}`,
                title: target,
                disabled: !isDirectory && !isFile,
                onClick: () => {
                  if (isDirectory) openDirectory(target);
                  else if (isFile) openFile(target);
                },
              },
              h('span', { className: 'dsh-code-editor-row-icon' },
                isDirectory ? h(ChevronIcon, { size: 14 }) : h(FileIcon, { size: 14 })),
              h('span', { className: 'dsh-code-editor-row-name' }, entry.name),
              isFile && typeof entry.size === 'number'
                ? h('span', { className: 'dsh-code-editor-row-meta' }, formatBytes(entry.size))
                : null,
            );
          });
          return h('div', { className: 'dsh-code-editor-list' },
            rows,
            listing.truncated
              ? h('div', { className: 'dsh-code-editor-banner is-warn' }, tr('browser.truncated'))
              : null);
        };

        const renderEditHeader = () => {
          const current = file;
          const name = current === null ? '' : baseName(current.path);
          return h(
            'div',
            { className: 'dsh-code-editor-header' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-code-editor-button is-icon',
                title: tr('editor.back'),
                'aria-label': tr('editor.back'),
                onClick: () => openDirectory(
                  current === null ? directory : parentPath(current.path),
                ),
              },
              h(BackIcon),
            ),
            h(
              'div',
              { className: 'dsh-code-editor-heading' },
              h('span', { className: 'dsh-code-editor-title', title: current?.path }, name),
              dirty ? h('span', { className: 'dsh-code-editor-dirty-dot', title: tr('editor.unsaved') }) : null,
            ),
            h(
              'div',
              { className: 'dsh-code-editor-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-code-editor-button is-icon',
                  title: tr('editor.reload'),
                  'aria-label': tr('editor.reload'),
                  onClick: reload,
                  disabled: current === null || current.status === 'loading',
                },
                h(RefreshIcon),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-code-editor-button is-icon',
                  title: tr('editor.discard'),
                  'aria-label': tr('editor.discard'),
                  onClick: discard,
                  disabled: !dirty,
                },
                h(DiscardIcon),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-code-editor-button is-primary',
                  title: tr('editor.save'),
                  onClick: () => save(false),
                  disabled:
                    current === null ||
                    current.status !== 'ready' ||
                    !dirty ||
                    saving,
                },
                h(SaveIcon),
                h('span', null, saving ? tr('editor.saving') : tr('editor.save')),
              ),
            ),
          );
        };

        const renderReadonly = () => h(
          'div',
          { className: 'dsh-code-editor-surface' },
          file.text === null || file.text === undefined
            ? h('div', { className: 'dsh-code-editor-empty' },
                h('div', { className: 'dsh-code-editor-empty-icon' }, h(FileIcon, { size: 28 })),
                h('div', { className: 'dsh-code-editor-empty-title' }, baseName(file.path)),
                h('div', null, file.message ?? tr('editor.emptyReadOnly')))
            : h('pre', { className: 'dsh-code-editor-readonly' }, file.text),
        );

        const renderEditorSurface = () => {
          if (file === null) {
            return h('div', { className: 'dsh-code-editor-empty' },
              h('div', { className: 'dsh-code-editor-empty-icon' }, h(FileIcon, { size: 28 })),
              h('div', { className: 'dsh-code-editor-empty-title' }, tr('editor.noFile')));
          }
          if (file.status === 'loading') {
            return h('div', { className: 'dsh-code-editor-loading' },
              h('span', { className: 'dsh-code-editor-pulse' }),
              h('span', null, tr('editor.loading')));
          }
          if (file.status === 'error' || file.status === 'missing') {
            return h('div', { className: 'dsh-code-editor-empty' },
              h('div', { className: 'dsh-code-editor-empty-icon' }, h(FileIcon, { size: 28 })),
              h('div', { className: 'dsh-code-editor-empty-title' }, baseName(file.path)),
              h('div', null, file.message ?? tr('editor.notFound')),
              h('button', {
                type: 'button',
                className: 'dsh-code-editor-button',
                onClick: () => openFile(file.path),
              }, tr('editor.retry')));
          }
          if (file.status === 'readonly') return renderReadonly();
          return h(
            'div',
            { className: 'dsh-code-editor-surface', ref: surfaceRef },
            h(
              'div',
              {
                className: 'dsh-code-editor-gutter',
                style: { width: `${gutterWidth}px` },
                'aria-hidden': true,
              },
              h(
                'div',
                {
                  className: 'dsh-code-editor-gutter-inner',
                  style: { top: `${EDITOR_PADDING + firstVisible * LINE_HEIGHT}px` },
                },
                lineNumbers.map((number) =>
                  h('div', { key: number, className: 'dsh-code-editor-line-number' }, number)),
              ),
            ),
            h('textarea', {
              ref: textareaRef,
              className: 'dsh-code-editor-textarea',
              value: file.text,
              spellCheck: false,
              wrap: 'off',
              autoCapitalize: 'off',
              autoCorrect: 'off',
              'aria-label': `${baseName(file.path)} — ${tr('editor.lineColumn', { line: cursor.line, column: cursor.column })}`,
              onKeyDown: handleKeyDown,
              onChange: handleChange,
              onSelect: handleSelection,
              onScroll: handleScroll,
            }),
          );
        };

        const renderStatus = () => {
          if (mode !== 'edit' || file === null || file.status !== 'ready') return null;
          const bytes = typeof file.bytes === 'number' ? file.bytes : byteLength(file.text);
          return h(
            'div',
            { className: 'dsh-code-editor-status', 'aria-label': tr('editor.status') },
            h('span', { className: 'dsh-code-editor-status-item' },
              tr('editor.lineColumn', { line: cursor.line, column: cursor.column })),
            h('span', { className: 'dsh-code-editor-status-item' }, tr('editor.encoding')),
            h('span', { className: 'dsh-code-editor-status-item' }, formatBytes(bytes)),
            h('span', {
              className: `dsh-code-editor-status-item${dirty ? ' is-dirty' : ''}`,
            }, dirty ? tr('editor.dirty') : tr('editor.clean')),
          );
        };

        return h(
          'div',
          { className: 'dsh-code-editor', 'data-code-editor-tab': tab.id },
          h('style', null, CSS),
          mode === 'browse' ? renderBrowseHeader() : renderEditHeader(),
          renderBanners(),
          mode === 'browse'
            ? h('div', { className: 'dsh-code-editor-scroll' }, renderBrowse())
            : renderEditorSurface(),
          renderStatus(),
        );
      };
    }

    // ---------------------------------------------------------------- apply

    return {
      inject: [
        'slots',
        'locale',
        'sidebarRightTabs',
        'remote',
        'remote.workspaceFiles',
      ],
      apply(ctx) {
        const t = ctx.locale.bind(NS);

        ctx.effect(
          () => ctx.locale.register(NS, { en: EN, es: ES }),
          'dsh-code-editor: dictionaries',
        );

        ctx.effect(
          () => ctx.sidebarRightTabs.register({
            id: ID,
            kind: KIND,
            priority: 'builtin',
            keepMounted: true,
            title: () => t('tab.title'),
            guide: [{
              id: 'workspace-editor',
              order: 40,
              title: () => t('guide.title'),
              description: () => t('guide.description'),
              icon: EditorIcon,
            }],
          }),
          'dsh-code-editor: right-sidebar tab type',
        );

        const EditorBody = createEditorBody(ctx, t);
        ctx.effect(
          () => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
            name: 'sidebar.right.pane.tab',
            key: ID,
            locale: NS,
          }, EditorBody)),
          'dsh-code-editor: tab body',
        );
      },
    };
  },
});
