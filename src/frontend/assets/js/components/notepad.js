import { Datepicker } from "flowbite";
import { getAuthenticatedUser } from "./auth.js";
import { modals } from "./modals.js";

// Global in-memory state for the active notepad session
let _activeEditor = null;
let _currentNoteId = null;
let _notesList = [];
let _sortOrder = "newest"; // "newest" | "oldest"
let _dateFilter = "";      // YYYY-MM-DD or ""
let _searchQuery = "";

// Lazy-loaded TipTap modules cache to keep page loads instant
let _tiptapModules = null;
let _tiptapLoadingPromise = null;

// Default starter note shown to staff upon first opening
const DEFAULT_SEED_NOTE = {
  id: "seed-welcome-note",
  title: "Welcome to SPES Quick Notes",
  content: `
    <h2>Welcome to SPES Notes & WYSIWYG Editor</h2>
    <p>This floating notepad is available globally across all portal pages for authorized staff.</p>
    <p>You can format rich text, insert headings, create bullet lists, format tables or code, and attach images or links.</p>
    <ul>
      <li><strong>Real-time drafts:</strong> Changes can be saved locally and prepared for cloud synchronization.</li>
      <li><strong>Smart auto-hiding:</strong> Automatically tucks away whenever drawers, modals, or toasts appear.</li>
      <li><strong>Filtering:</strong> Search by keyword or filter by date using the built-in calendar.</li>
    </ul>
    <p>Click <em>Create new note</em> above to start a clean memo!</p>
  `.trim(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

// --- FUNCTION: LAZY TIPTAP LOADER (START) ---
/**
 * Asynchronously loads heavy TipTap WYSIWYG dependencies on-demand to optimize initial page loading.
 * @returns {Promise<Object>} Object containing all required TipTap extensions and the core Editor.
 */
async function _getTipTap() {
  if (_tiptapModules) return _tiptapModules;
  if (_tiptapLoadingPromise) return _tiptapLoadingPromise;

  _tiptapLoadingPromise = Promise.all([
    import("@tiptap/core"),
    import("@tiptap/starter-kit"),
    import("@tiptap/extension-highlight"),
    import("@tiptap/extension-underline"),
    import("@tiptap/extension-link"),
    import("@tiptap/extension-text-align"),
    import("@tiptap/extension-image"),
    import("@tiptap/extension-youtube"),
    import("@tiptap/extension-text-style"),
    import("@tiptap/extension-font-family"),
    import("@tiptap/extension-color"),
    import("@tiptap/extension-bold"),
  ]).then(([
    { Editor },
    starterKitPkg,
    highlightPkg,
    underlinePkg,
    linkPkg,
    textAlignPkg,
    imagePkg,
    youtubePkg,
    { TextStyle },
    fontFamilyPkg,
    { Color },
    boldPkg,
  ]) => {
    _tiptapModules = {
      Editor,
      StarterKit: starterKitPkg.default || starterKitPkg,
      Highlight: highlightPkg.default || highlightPkg,
      Underline: underlinePkg.default || underlinePkg,
      Link: linkPkg.default || linkPkg,
      TextAlign: textAlignPkg.default || textAlignPkg,
      Image: imagePkg.default || imagePkg,
      Youtube: youtubePkg.Youtube || youtubePkg.default || youtubePkg,
      TextStyle,
      FontFamily: fontFamilyPkg.default || fontFamilyPkg,
      Color,
      Bold: boldPkg.default || boldPkg,
    };
    return _tiptapModules;
  });

  return _tiptapLoadingPromise;
}
// --- FUNCTION: LAZY TIPTAP LOADER (END) ---

// --- FUNCTION: NOTEPAD STORAGE HANDLER (START) ---
/**
 * Handles persistent CRUD operations for notes.
 * Stores locally under `spes_staff_notes_${userId}` with placeholders for Supabase DB synchronization.
 */
export function initNotepadStorage() {
  const user = getAuthenticatedUser();
  const storageKey = user?.id ? `spes_staff_notes_${user.id}` : "spes_staff_notes_guest";

  const loadNotes = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        _notesList = [DEFAULT_SEED_NOTE];
        localStorage.setItem(storageKey, JSON.stringify(_notesList));
      } else {
        _notesList = JSON.parse(raw);
        if (!Array.isArray(_notesList) || _notesList.length === 0) {
          _notesList = [DEFAULT_SEED_NOTE];
        }
      }
    } catch {
      _notesList = [DEFAULT_SEED_NOTE];
    }
    return _notesList;
  };

  const saveNote = async (noteData) => {
    const user = getAuthenticatedUser();
    const now = new Date().toISOString();

    if (noteData.id) {
      const idx = _notesList.findIndex(n => n.id === noteData.id);
      if (idx !== -1) {
        _notesList[idx] = {
          ..._notesList[idx],
          title: noteData.title || "Untitled Note",
          content: noteData.content || "",
          updatedAt: now
        };
      }
    } else {
      const newNote = {
        id: "note_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
        title: noteData.title || "Untitled Note",
        content: noteData.content || "",
        createdAt: now,
        updatedAt: now
      };
      _notesList.unshift(newNote);
      _currentNoteId = newNote.id;
    }

    try {
      localStorage.setItem(storageKey, JSON.stringify(_notesList));
    } catch (err) {
      console.warn("[Notepad] LocalStorage write failed:", err);
    }

    return _notesList;
  };

  const deleteNote = async (noteId) => {
    _notesList = _notesList.filter(n => n.id !== noteId);
    try {
      localStorage.setItem(storageKey, JSON.stringify(_notesList));
    } catch (err) {
      console.warn("[Notepad] LocalStorage delete failed:", err);
    }

    return _notesList;
  };

  loadNotes();
  return { loadNotes, saveNote, deleteNote };
}
// --- FUNCTION: NOTEPAD STORAGE HANDLER (END) ---


// --- FUNCTION: NOTEPAD OVERLAY OBSERVER (START) ---
/**
 * Monitors modals, toasts, and drawers across the SPES Portal.
 * Automatically hides the floating notepad whenever any modal, toast, or drawer is active.
 * Uses debounced requestAnimationFrame to avoid thrashing CPU.
 */
export function initNotepadOverlayObserver() {
  const container = document.getElementById("spes-notepad-floating-container");
  if (!container) return;
  if (container.dataset.observerInit === "true") return;
  container.dataset.observerInit = "true";

  const isOverlayActive = () => {
    // 1. SweetAlert2 Modal
    const swalModal = document.querySelector(".swal2-container.swal2-shown");
    if (swalModal && swalModal.offsetParent !== null) return true;
    if (document.body.classList.contains("swal2-shown") || document.body.classList.contains("swal2-toast-shown")) return true;

    // 2. Modals, dialogs, and custom modal backdrops (Flowbite or custom)
    const modalBackdrops = document.querySelectorAll("[modal-backdrop], [data-modal-backdrop]");
    for (const mb of modalBackdrops) {
      if (!mb.classList.contains("hidden") && mb.offsetParent !== null) {
        const style = window.getComputedStyle(mb);
        if (style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0") {
          return true;
        }
      }
    }

    // 3. Toasts container
    const toastContainer = document.getElementById("spes-flowbite-toast-container");
    if (toastContainer && toastContainer.children.length > 0) return true;

    // 4. Specific known drawer overlay elements when revealed
    const drawerOverlays = document.querySelectorAll(
      "#configure-drawer-overlay, #implementors-drawer-overlay, #drawer-add-impl-overlay, #drawer-bene-form-overlay, #drawer-batch-form-overlay, #drawer-payroll-edit-overlay, #drawer-backdrop, [data-drawer-backdrop]"
    );
    for (const ov of drawerOverlays) {
      if (!ov.classList.contains("hidden")) {
        const style = window.getComputedStyle(ov);
        if (style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0") {
          return true;
        }
      }
    }

    // 5. Specific known drawers across all SPES Portal pages
    const knownDrawers = document.querySelectorAll(
      "#configure-drawer, #implementors-drawer, #drawer-add-implementor, #drawer-bene-form, #drawer-batch-form, #drawer-beneficiary-details, #drawer-payroll-edit, #drawer-top-example"
    );
    for (const d of knownDrawers) {
      if (d.classList.contains("hidden") || d.getAttribute("aria-hidden") === "true") continue;
      if (d.dataset.drawerState === "closed") continue;

      // Check if drawer is transformed off-screen
      const isOffscreen = d.classList.contains("-translate-x-full") ||
                          d.classList.contains("translate-x-full") ||
                          d.classList.contains("-translate-y-full") ||
                          d.classList.contains("translate-y-full") ||
                          d.classList.contains("sm:translate-x-full");
      if (!isOffscreen) {
        const style = window.getComputedStyle(d);
        if (style.display !== "none" && style.visibility !== "hidden") {
          return true;
        }
      }
    }

    // 6. Generic open Flowbite or custom dialogs/modals (excluding notepad panel and inline drawers)
    const openModals = document.querySelectorAll("[role='dialog']:not(#spes-notepad-panel):not(#drawer-batch-form):not(#drawer-bene-form):not(#drawer-beneficiary-details)");
    for (const m of openModals) {
      if (m.id === "spes-notepad-floating-container" || m.id === "spes-notepad-panel" || m.closest("#spes-notepad-floating-container")) continue;
      if (!m.classList.contains("hidden") && m.getAttribute("aria-hidden") !== "true" && m.offsetParent !== null) {
        const style = window.getComputedStyle(m);
        if (style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0") {
          return true;
        }
      }
    }

    return false;
  };

  let rafId = null;
  const updateVisibility = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      const hiddenByOverlay = isOverlayActive();
      if (hiddenByOverlay) {
        container.classList.add("opacity-0", "pointer-events-none", "translate-y-8", "scale-90");
        const panel = document.getElementById("spes-notepad-panel");
        const toggleBtn = document.getElementById("spes-notepad-toggle-btn");
        if (panel && !panel.classList.contains("hidden")) {
          panel.classList.add("hidden");
          panel.classList.remove("flex");
          toggleBtn?.classList.remove("is-active");
        }
      } else {
        container.classList.remove("opacity-0", "pointer-events-none", "translate-y-8", "scale-90");
      }
    });
  };

  // Initial check
  updateVisibility();

  // Observe DOM changes (open modals, appended toasts, transformed drawers)
  const observer = new MutationObserver(() => {
    updateVisibility();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "aria-hidden", "style", "hidden"]
  });

  // Also hook window popstate and resize
  window.addEventListener("resize", updateVisibility, { passive: true });
}
// --- FUNCTION: NOTEPAD OVERLAY OBSERVER (END) ---


// --- FUNCTION: NOTEPAD FLOATING UI HANDLER (START) ---
/**
 * Controls opening, closing, responsive toggling, and note count badge.
 */
export function initNotepadFloating() {
  const container = document.getElementById("spes-notepad-floating-container");
  const toggleBtn = document.getElementById("spes-notepad-toggle-btn");
  const panel = document.getElementById("spes-notepad-panel");
  const closeBtn = document.getElementById("btn-close-notepad");
  const badge = document.getElementById("spes-notepad-badge");

  if (!container || !toggleBtn || !panel) return;

  const updateBadge = () => {
    if (!badge) return;
    const count = _notesList.length;
    if (count > 0) {
      badge.textContent = count > 9 ? "9+" : String(count);
      badge.classList.remove("hidden");
      badge.classList.add("flex");
    } else {
      badge.classList.add("hidden");
      badge.classList.remove("flex");
    }
  };

  const openPanel = () => {
    panel.classList.remove("hidden");
    panel.classList.add("flex");
    toggleBtn.classList.add("is-active");
    renderNotesList();
    // Warm up TipTap in background on first panel open
    if (!_activeEditor) {
      _initEditorInstance().catch(() => {});
    }
  };

  const closePanel = () => {
    panel.classList.add("hidden");
    panel.classList.remove("flex");
    toggleBtn.classList.remove("is-active");
  };

  if (container.dataset.floatingInit === "true") {
    updateBadge();
    return { openPanel, closePanel, updateBadge };
  }
  container.dataset.floatingInit = "true";

  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isHidden = panel.classList.contains("hidden");
    if (isHidden) {
      openPanel();
    } else {
      closePanel();
    }
  });

  closeBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    closePanel();
  });

  // Close when pressing Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.classList.contains("hidden")) {
      closePanel();
    }
  });

  // Click outside to minimize panel
  document.addEventListener("click", (e) => {
    if (!panel.classList.contains("hidden") && !container.contains(e.target)) {
      // Don't close if interacting with datepicker or popper tooltips
      if (e.target.closest(".datepicker, .tooltip, [role='tooltip'], [data-popper-arrow]")) return;
      closePanel();
    }
  });

  updateBadge();
  return { openPanel, closePanel, updateBadge };
}
// --- FUNCTION: NOTEPAD FLOATING UI HANDLER (END) ---


// --- FUNCTION: RENDER NOTES LIST (START) ---
/**
 * Renders the filtered and sorted notes cards in the list view.
 */
function renderNotesList() {
  const cardsContainer = document.getElementById("notepad-cards-container");
  const emptyState = document.getElementById("notepad-empty-state");
  if (!cardsContainer || !emptyState) return;

  // Filter notes
  let filtered = [..._notesList];

  // Search filter
  if (_searchQuery.trim()) {
    const q = _searchQuery.toLowerCase().trim();
    filtered = filtered.filter(n =>
      (n.title && n.title.toLowerCase().includes(q)) ||
      (n.content && n.content.toLowerCase().includes(q))
    );
  }

  // Date filter
  if (_dateFilter) {
    filtered = filtered.filter(n => {
      const noteDate = (n.createdAt || "").substring(0, 10);
      return noteDate === _dateFilter;
    });
  }

  // Sort
  filtered.sort((a, b) => {
    const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return _sortOrder === "newest" ? timeB - timeA : timeA - timeB;
  });

  if (filtered.length === 0) {
    cardsContainer.innerHTML = "";
    emptyState.classList.remove("hidden");
    emptyState.classList.add("flex");
    return;
  }

  emptyState.classList.add("hidden");
  emptyState.classList.remove("flex");

  cardsContainer.innerHTML = filtered.map(note => {
    const dateFormatted = note.updatedAt ? new Date(note.updatedAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    }) : "Recent";

    // Clean plain text snippet
    const tmp = document.createElement("div");
    tmp.innerHTML = note.content || "";
    const snippet = (tmp.textContent || tmp.innerText || "Empty note content").trim().substring(0, 75);

    return `
      <div data-note-id="${note.id}"
           class="js-note-card cursor-pointer group relative p-2.5 bg-slate-50 dark:bg-slate-800/70 hover:bg-spes-blue/5 dark:hover:bg-spes-yellow/10 border border-slate-200/80 dark:border-slate-700/80 hover:border-spes-blue/30 dark:hover:border-spes-yellow/30 rounded-lg transition-all shadow-xs">
        <div class="flex items-start justify-between gap-1.5">
          <h5 class="text-xs font-bold text-slate-900 dark:text-white truncate group-hover:text-spes-blue dark:group-hover:text-spes-yellow">
            ${note.title || "Untitled Note"}
          </h5>
          <span class="text-[9.5px] font-semibold text-slate-400 dark:text-slate-500 whitespace-nowrap">${dateFormatted}</span>
        </div>
        <p class="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5 leading-snug">
          ${snippet}...
        </p>
      </div>
    `;
  }).join("");

  // Attach card click handlers
  cardsContainer.querySelectorAll(".js-note-card").forEach(card => {
    card.addEventListener("click", () => {
      const noteId = card.getAttribute("data-note-id");
      openNoteInEditor(noteId);
    });
  });
}
// --- FUNCTION: RENDER NOTES LIST (END) ---


// --- FUNCTION: SWITCH VIEW MODES (START) ---
/**
 * Switches between the list view and the editor view.
 * @param {"list" | "editor"} view
 */
function switchView(view) {
  const listView = document.getElementById("notepad-list-view");
  const editorView = document.getElementById("notepad-editor-view");
  if (!listView || !editorView) return;

  if (view === "editor") {
    listView.classList.add("hidden");
    listView.classList.remove("flex");
    editorView.classList.remove("hidden");
    editorView.classList.add("flex");
  } else {
    editorView.classList.add("hidden");
    editorView.classList.remove("flex");
    listView.classList.remove("hidden");
    listView.classList.add("flex");
    renderNotesList();
  }
}
// --- FUNCTION: SWITCH VIEW MODES (END) ---


// --- FUNCTION: OPEN NOTE IN EDITOR (START) ---
/**
 * Loads a note by ID into the TipTap WYSIWYG editor.
 * @param {string|null} noteId
 */
async function openNoteInEditor(noteId) {
  _currentNoteId = noteId;
  const titleInput = document.getElementById("note-title-input");
  const statusLabel = document.getElementById("editor-save-status");

  let note = null;
  if (noteId) {
    note = _notesList.find(n => n.id === noteId);
  }

  switchView("editor");
  if (statusLabel) statusLabel.textContent = "Loading editor...";

  // Ensure TipTap editor is instantiated
  if (!_activeEditor) {
    await _initEditorInstance();
  }

  if (note) {
    if (titleInput) titleInput.value = note.title || "";
    if (_activeEditor) {
      _activeEditor.commands.setContent(note.content || "");
    }
  } else {
    // New Note
    _currentNoteId = null;
    if (titleInput) titleInput.value = "";
    if (_activeEditor) {
      _activeEditor.commands.setContent("<p></p>");
      _activeEditor.commands.focus();
    }
  }

  if (statusLabel) statusLabel.textContent = "Ready";
  updateWordCount();
}
// --- FUNCTION: OPEN NOTE IN EDITOR (END) ---


// --- FUNCTION: UPDATE WORD AND CHAR COUNTER (START) ---
function updateWordCount() {
  const wordEl = document.getElementById("editor-word-count");
  const charEl = document.getElementById("editor-char-count");
  if (!_activeEditor || !wordEl || !charEl) return;

  const text = _activeEditor.getText() || "";
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;

  wordEl.textContent = `${words} word${words === 1 ? "" : "s"}`;
  charEl.textContent = `${chars} char${chars === 1 ? "" : "s"}`;

  // Live preview synchronization
  const previewContent = document.getElementById("wysiwyg-preview-content");
  if (previewContent) {
    previewContent.innerHTML = _activeEditor.getHTML();
  }
}
// --- FUNCTION: UPDATE WORD AND CHAR COUNTER (END) ---


// --- FUNCTION: NOTEPAD FILTERS & SEARCH (START) ---
/**
 * Sets up the search bar, datepicker, and sorting buttons.
 */
export function initNotepadFilters() {
  const container = document.getElementById("spes-notepad-floating-container");
  const searchInput = document.getElementById("notepad-search-input");
  const btnNewest = document.getElementById("btn-sort-newest");
  const btnOldest = document.getElementById("btn-sort-oldest");
  const dateInput = document.getElementById("notepad-datepicker-input");
  const btnClearDate = document.getElementById("btn-clear-date");

  if (!container) return;
  if (container.dataset.filtersInit === "true") return;
  container.dataset.filtersInit = "true";

  // Search input
  searchInput?.addEventListener("input", (e) => {
    _searchQuery = e.target.value;
    renderNotesList();
  });

  // Sort buttons
  const setActiveSort = (order) => {
    _sortOrder = order;
    if (order === "newest") {
      btnNewest?.classList.add("bg-white", "dark:bg-slate-700", "text-spes-blue", "dark:text-spes-yellow", "shadow-xs", "font-semibold");
      btnNewest?.classList.remove("text-slate-600", "dark:text-slate-400", "font-medium");
      btnOldest?.classList.remove("bg-white", "dark:bg-slate-700", "text-spes-blue", "dark:text-spes-yellow", "shadow-xs", "font-semibold");
      btnOldest?.classList.add("text-slate-600", "dark:text-slate-400", "font-medium");
    } else {
      btnOldest?.classList.add("bg-white", "dark:bg-slate-700", "text-spes-blue", "dark:text-spes-yellow", "shadow-xs", "font-semibold");
      btnOldest?.classList.remove("text-slate-600", "dark:text-slate-400", "font-medium");
      btnNewest?.classList.remove("bg-white", "dark:bg-slate-700", "text-spes-blue", "dark:text-spes-yellow", "shadow-xs", "font-semibold");
      btnNewest?.classList.add("text-slate-600", "dark:text-slate-400", "font-medium");
    }
    renderNotesList();
  };

  btnNewest?.addEventListener("click", () => setActiveSort("newest"));
  btnOldest?.addEventListener("click", () => setActiveSort("oldest"));

  // Flowbite Datepicker
  if (dateInput) {
    try {
      new Datepicker(dateInput, {
        autohide: true,
        format: "yyyy-mm-dd"
      });

      dateInput.addEventListener("changeDate", (e) => {
        const val = dateInput.value;
        _dateFilter = val || "";
        if (_dateFilter) {
          btnClearDate?.classList.remove("hidden");
        } else {
          btnClearDate?.classList.add("hidden");
        }
        renderNotesList();
      });
    } catch (err) {
      console.warn("[Notepad] Datepicker init skipped:", err);
    }
  }

  btnClearDate?.addEventListener("click", () => {
    if (dateInput) dateInput.value = "";
    _dateFilter = "";
    btnClearDate.classList.add("hidden");
    renderNotesList();
  });
}
// --- FUNCTION: NOTEPAD FILTERS & SEARCH (END) ---


// --- FUNCTION: INITIALIZE TIPTAP INSTANCE (START) ---
async function _initEditorInstance() {
  const mountEl = document.getElementById("wysiwyg-example");
  if (!mountEl || _activeEditor) return _activeEditor;

  const {
    Editor,
    StarterKit,
    Highlight,
    Underline,
    Link,
    TextAlign,
    Image,
    Youtube,
    TextStyle,
    FontFamily,
    Color,
    Bold,
  } = await _getTipTap();

  // Custom Extension: Font Size support via style
  const FontSizeTextStyle = TextStyle.extend({
    addAttributes() {
      return {
        fontSize: {
          default: null,
          parseHTML: element => element.style.fontSize,
          renderHTML: attributes => {
            if (!attributes.fontSize) return {};
            return { style: `font-size: ${attributes.fontSize}` };
          }
        }
      };
    }
  });

  // Custom Extension: Custom Bold font-weight
  const CustomBold = Bold.extend({
    renderHTML({ mark, HTMLAttributes }) {
      const { style, ...rest } = HTMLAttributes;
      const newStyle = "font-weight: bold;" + (style ? " " + style : "");
      return ["span", { ...rest, style: newStyle.trim() }, 0];
    },
    addOptions() {
      return {
        ...this.parent?.(),
        HTMLAttributes: {}
      };
    }
  });

  // TipTap Instance
  const editor = new Editor({
    element: mountEl,
    extensions: [
      StarterKit.configure({
        textStyle: false,
        bold: false,
        marks: {
          bold: false
        }
      }),
      CustomBold,
      TextStyle,
      Color,
      FontSizeTextStyle,
      FontFamily,
      Highlight,
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https"
      }),
      TextAlign.configure({
        types: ["heading", "paragraph"]
      }),
      Image,
      Youtube
    ],
    content: DEFAULT_SEED_NOTE.content,
    editorProps: {
      attributes: {
        class: "format lg:format-lg dark:format-invert focus:outline-none format-blue max-w-none text-slate-800 dark:text-slate-100 min-h-[120px] text-xs sm:text-sm"
      }
    },
    onUpdate: () => {
      updateWordCount();
      const statusLabel = document.getElementById("editor-save-status");
      if (statusLabel) statusLabel.textContent = "Unsaved changes";
    }
  });

  _activeEditor = editor;
  return editor;
}
// --- FUNCTION: INITIALIZE TIPTAP INSTANCE (END) ---


// --- FUNCTION: NOTEPAD TIPTAP WYSIWYG EDITOR (START) ---
/**
 * Configures the TipTap text editor with all toolbar interactions.
 */
export function initNotepadEditor() {
  const container = document.getElementById("spes-notepad-floating-container");
  const mountEl = document.getElementById("wysiwyg-example");
  if (!mountEl || !container) return;
  if (container.dataset.editorInit === "true") return;
  container.dataset.editorInit = "true";

  // Helper to execute command after ensuring editor is ready
  const execCmd = async (fn) => {
    if (!_activeEditor) await _initEditorInstance();
    if (_activeEditor) fn(_activeEditor);
  };

  // Toolbar Button Click Listeners
  document.getElementById("toggleBoldButton")?.addEventListener("click", () => execCmd(e => e.chain().focus().toggleBold().run()));
  document.getElementById("toggleItalicButton")?.addEventListener("click", () => execCmd(e => e.chain().focus().toggleItalic().run()));
  document.getElementById("toggleUnderlineButton")?.addEventListener("click", () => execCmd(e => e.chain().focus().toggleUnderline().run()));
  document.getElementById("toggleStrikeButton")?.addEventListener("click", () => execCmd(e => e.chain().focus().toggleStrike().run()));

  document.getElementById("toggleHighlightButton")?.addEventListener("click", () => {
    execCmd(e => {
      const isHighlighted = e.isActive("highlight");
      e.chain().focus().toggleHighlight({
        color: isHighlighted ? undefined : "#FCD116"
      }).run();
    });
  });

  document.getElementById("toggleCodeButton")?.addEventListener("click", () => execCmd(e => e.chain().focus().toggleCode().run()));

  document.getElementById("toggleLinkButton")?.addEventListener("click", () => {
    const url = window.prompt("Enter web URL for hyperlink:", "https://");
    if (url) {
      execCmd(e => e.chain().focus().toggleLink({ href: url }).run());
    }
  });

  document.getElementById("removeLinkButton")?.addEventListener("click", () => {
    execCmd(e => e.chain().focus().unsetLink().run());
  });

  document.getElementById("toggleLeftAlignButton")?.addEventListener("click", () => execCmd(e => e.chain().focus().setTextAlign("left").run()));
  document.getElementById("toggleCenterAlignButton")?.addEventListener("click", () => execCmd(e => e.chain().focus().setTextAlign("center").run()));
  document.getElementById("toggleRightAlignButton")?.addEventListener("click", () => execCmd(e => e.chain().focus().setTextAlign("right").run()));

  document.getElementById("toggleListButton")?.addEventListener("click", () => execCmd(e => e.chain().focus().toggleBulletList().run()));
  document.getElementById("toggleOrderedListButton")?.addEventListener("click", () => execCmd(e => e.chain().focus().toggleOrderedList().run()));
  document.getElementById("toggleBlockquoteButton")?.addEventListener("click", () => execCmd(e => e.chain().focus().toggleBlockquote().run()));
  document.getElementById("toggleHRButton")?.addEventListener("click", () => execCmd(e => e.chain().focus().setHorizontalRule().run()));

  document.getElementById("addImageButton")?.addEventListener("click", () => {
    const url = window.prompt("Enter Image URL:", "https://placehold.co/600x400");
    if (url) {
      execCmd(e => e.chain().focus().setImage({ src: url }).run());
    }
  });

  document.getElementById("addVideoButton")?.addEventListener("click", () => {
    const url = window.prompt("Enter YouTube Video URL:", "https://www.youtube.com/watch?v=");
    if (url) {
      execCmd(e => e.commands.setYoutubeVideo({
        src: url,
        width: 480,
        height: 270
      }));
    }
  });

  // Typography Dropdown (Paragraph & Headings 1-6)
  const typographyDropdownEl = document.getElementById("typographyDropdown");
  document.getElementById("toggleParagraphButton")?.addEventListener("click", () => {
    execCmd(e => e.chain().focus().setParagraph().run());
    typographyDropdownEl?.classList.add("hidden");
  });

  document.querySelectorAll("[data-heading-level]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const level = parseInt(btn.getAttribute("data-heading-level"), 10);
      execCmd(e => e.chain().focus().toggleHeading({ level }).run());
      typographyDropdownEl?.classList.add("hidden");
    });
  });

  // Text Size Dropdown
  const textSizeDropdownEl = document.getElementById("textSizeDropdown");
  document.querySelectorAll("[data-text-size]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fontSize = btn.getAttribute("data-text-size");
      execCmd(e => e.chain().focus().setMark("textStyle", { fontSize }).run());
      textSizeDropdownEl?.classList.add("hidden");
    });
  });

  // Text Color Swatches & Picker
  const colorPicker = document.getElementById("color");
  colorPicker?.addEventListener("input", (e) => {
    const color = e.target.value;
    execCmd(ed => ed.chain().focus().setColor(color).run());
  });

  document.querySelectorAll("[data-hex-color]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const color = btn.getAttribute("data-hex-color");
      execCmd(e => e.chain().focus().setColor(color).run());
      document.getElementById("textColorDropdown")?.classList.add("hidden");
    });
  });

  document.getElementById("reset-color")?.addEventListener("click", () => {
    execCmd(e => e.commands.unsetColor());
    document.getElementById("textColorDropdown")?.classList.add("hidden");
  });

  // Font Family Dropdown
  const fontFamilyDropdownEl = document.getElementById("fontFamilyDropdown");
  document.querySelectorAll("[data-font-family]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fontFamily = btn.getAttribute("data-font-family");
      execCmd(e => e.chain().focus().setFontFamily(fontFamily).run());
      fontFamilyDropdownEl?.classList.add("hidden");
    });
  });

  // Header & Empty State "Create Note" buttons
  const createNewNoteHandler = () => {
    openNoteInEditor(null);
  };
  document.getElementById("btn-header-create-note")?.addEventListener("click", createNewNoteHandler);
  document.getElementById("btn-empty-create-note")?.addEventListener("click", createNewNoteHandler);

  // Back to list button
  document.getElementById("btn-editor-back")?.addEventListener("click", () => {
    switchView("list");
  });

  // Save current note
  const saveBtn = document.getElementById("btn-save-current-note");
  saveBtn?.addEventListener("click", async () => {
    const title = document.getElementById("note-title-input")?.value.trim() || "Untitled Note";
    const content = _activeEditor ? _activeEditor.getHTML() : "";
    const statusLabel = document.getElementById("editor-save-status");

    const storage = initNotepadStorage();
    await storage.saveNote({
      id: _currentNoteId,
      title,
      content
    });

    if (statusLabel) {
      statusLabel.textContent = "Saved locally";
      statusLabel.classList.remove("text-slate-500");
      statusLabel.classList.add("text-emerald-500");
    }

    const { updateBadge } = initNotepadFloating();
    updateBadge();
    modals.toast("Note saved successfully!", "success");
  });

  // Delete current note
  document.getElementById("btn-delete-current-note")?.addEventListener("click", async () => {
    if (!_currentNoteId) {
      openNoteInEditor(null);
      return;
    }

    const confirmed = await modals.confirm(
      "Delete Note",
      "Are you sure you want to delete this note? This action cannot be undone.",
      "Yes, Delete",
      "Cancel"
    );

    if (confirmed?.isConfirmed) {
      const storage = initNotepadStorage();
      await storage.deleteNote(_currentNoteId);
      const { updateBadge } = initNotepadFloating();
      updateBadge();
      modals.toast("Note deleted", "info");
      switchView("list");
    }
  });

  // Edit / Preview Mode Toggles
  const btnModeEdit = document.getElementById("btn-mode-edit");
  const btnModePreview = document.getElementById("btn-mode-preview");
  const canvasContainer = document.getElementById("editor-canvas-container");
  const previewContainer = document.getElementById("editor-preview-container");

  btnModeEdit?.addEventListener("click", () => {
    btnModeEdit.classList.add("bg-white", "dark:bg-slate-700", "text-spes-blue", "dark:text-spes-yellow", "shadow-xs", "font-bold");
    btnModeEdit.classList.remove("text-slate-600", "dark:text-slate-400", "font-medium");
    btnModePreview?.classList.remove("bg-white", "dark:bg-slate-700", "text-spes-blue", "dark:text-spes-yellow", "shadow-xs", "font-bold");
    btnModePreview?.classList.add("text-slate-600", "dark:text-slate-400", "font-medium");

    canvasContainer?.classList.remove("hidden");
    previewContainer?.classList.add("hidden");
  });

  btnModePreview?.addEventListener("click", () => {
    btnModePreview.classList.add("bg-white", "dark:bg-slate-700", "text-spes-blue", "dark:text-spes-yellow", "shadow-xs", "font-bold");
    btnModePreview.classList.remove("text-slate-600", "dark:text-slate-400", "font-medium");
    btnModeEdit?.classList.remove("bg-white", "dark:bg-slate-700", "text-spes-blue", "dark:text-spes-yellow", "shadow-xs", "font-bold");
    btnModeEdit?.classList.add("text-slate-600", "dark:text-slate-400", "font-medium");

    canvasContainer?.classList.add("hidden");
    previewContainer?.classList.remove("hidden");
    updateWordCount();
  });
}
// --- FUNCTION: NOTEPAD TIPTAP WYSIWYG EDITOR (END) ---


// --- FUNCTION: NOTEPAD PARENT INITIALIZER (START) ---
/**
 * Parent orchestrator for the global SPES floating notepad component.
 * Verifies authenticated session, sets up storage, floating triggers, overlay observers,
 * search & filters, and TipTap WYSIWYG editor.
 */
export function notepad() {
  // Only activate for authenticated users
  const user = getAuthenticatedUser();
  const floatingContainer = document.getElementById("spes-notepad-floating-container");

  if (!user) {
    if (floatingContainer) {
      floatingContainer.classList.add("hidden");
    }
    return;
  }

  if (!floatingContainer) return;
  floatingContainer.classList.remove("hidden");

  initNotepadStorage();
  initNotepadFloating();
  initNotepadOverlayObserver();
  initNotepadFilters();
  initNotepadEditor();
}
// --- FUNCTION: NOTEPAD PARENT INITIALIZER (END) ---
