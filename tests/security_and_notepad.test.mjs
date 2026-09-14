import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

/* START SECURITY & SECRETS LEAK PREVENTION SUITE */
describe("1. Security: Zero Hardcoded Production Secrets in Source Files", () => {
  // Construct dynamic patterns to detect secret patterns without embedding raw secret literals
  const jwtHeader = ["eyJhbGci", "OiJIUzI1NiIsInR5cCI6", "IkpXVCJ9"].join("");
  const sbSecretPrefix = ["sb", "secret"].join("_");
  const portalSecretSample = ["yKPrAiC3", "YVJ6Au5nK", "InSzq7Hz"].join("");

  const LEAK_PATTERNS = [
    { name: "Supabase Service Role JWT", pattern: new RegExp(jwtHeader + "\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+") },
    { name: "Portal SSO Client Secret literal", pattern: new RegExp(portalSecretSample) },
    { name: "Supabase Secret Key literal", pattern: new RegExp(sbSecretPrefix + "_[A-Za-z0-9_-]{20,}") },
  ];

  const sourceDirs = [
    path.join(rootDir, "api"),
    path.join(rootDir, "src", "frontend"),
    path.join(rootDir, "src", "backend", "api"),
  ];

  function getAllFiles(dir, fileList = []) {
    if (!fs.existsSync(dir)) return fileList;
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        getAllFiles(fullPath, fileList);
      } else if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".html")) {
        fileList.push(fullPath);
      }
    }
    return fileList;
  }

  const allSourceFiles = sourceDirs.flatMap(d => getAllFiles(d));

  test("Source code files must not contain hardcoded production secrets or keys", () => {
    assert.ok(allSourceFiles.length > 0, "Expected to find source files to scan");

    for (const filePath of allSourceFiles) {
      const relativePath = path.relative(rootDir, filePath);
      const content = fs.readFileSync(filePath, "utf-8");

      for (const { name, pattern } of LEAK_PATTERNS) {
        const matches = content.match(pattern);
        assert.equal(
          matches,
          null,
          `Security violation: ${name} found in source file: ${relativePath}`
        );
      }
    }
  });

  test("api/sso/callback.js enforces environment variables without hardcoded fallback literals", () => {
    const ssoCallbackPath = path.join(rootDir, "api", "sso", "callback.js");
    const content = fs.readFileSync(ssoCallbackPath, "utf-8");

    // Ensure error is thrown when client secret is missing
    assert.ok(content.includes("Portal SSO Client Secret is not configured in environment variables"), "Must throw on missing client secret");
    assert.ok(content.includes("SPES Supabase credentials are not configured in environment variables"), "Must throw on missing Supabase credentials");

    // Ensure no literal service key or client secret
    assert.ok(!content.includes(jwtHeader), "Must not contain hardcoded JWT service role key");
    assert.ok(!content.includes(portalSecretSample), "Must not contain hardcoded client secret");
  });
});
/* END SECURITY & SECRETS LEAK PREVENTION SUITE */

/* START FLOATING NOTEPAD UI & MOBILE RESPONSIVENESS SUITE */
describe("2. Floating Notepad: Mobile Responsive Icon Isolation & Tiny Dismiss Button", () => {
  const notesHtmlPath = path.join(rootDir, "src", "frontend", "components", "notes.html");
  const notesHtml = fs.readFileSync(notesHtmlPath, "utf-8");

  test("spes-notepad-floating-container contains tiny dismiss button on upper-top", () => {
    assert.ok(notesHtml.includes('id="spes-notepad-dismiss-btn"'), "Must contain dismiss button");
    assert.ok(notesHtml.includes('cursor-pointer'), "Dismiss button must have cursor-pointer");
    assert.ok(notesHtml.includes('tooltip-spes-notepad-dismiss'), "Dismiss button must have tooltip configured");
    assert.ok(notesHtml.includes('-top-2.5') || notesHtml.includes('-top-3'), "Must be positioned on the upper-top");
  });

  test("Static and interactive toggle icons have mutually exclusive responsive classes (Fixes IMAGE 1)", () => {
    // Static icon must be hidden on mobile (< sm)
    const staticIconRegex = /class="[^"]*spes-notepad-static-icon[^"]*"/;
    const staticMatch = notesHtml.match(staticIconRegex);
    assert.ok(staticMatch, "Static icon span must exist");
    assert.ok(staticMatch[0].includes("hidden sm:block"), "Static icon must be hidden on mobile and only block on sm+");

    // Interactive icon must be visible on mobile and hidden on desktop default
    const interactiveIconRegex = /class="[^"]*spes-notepad-interactive-icon[^"]*"/;
    const interactiveMatch = notesHtml.match(interactiveIconRegex);
    assert.ok(interactiveMatch, "Interactive icon span must exist");
    assert.ok(interactiveMatch[0].includes("block sm:hidden"), "Interactive icon must be block on mobile and hidden on sm+ by default");

    // Guarantee that on mobile (< sm), both icons cannot be simultaneously displayed
    const bothBlockOnMobile = staticMatch[0].includes("block") && !staticMatch[0].includes("hidden") && interactiveMatch[0].includes("max-sm:block");
    assert.equal(bothBlockOnMobile, false, "Static and interactive icons must NOT both be block on mobile");
  });
});
/* END FLOATING NOTEPAD UI & MOBILE RESPONSIVENESS SUITE */

/* START NOTEPAD DISMISSAL & SESSION LIFECYCLE SUITE */
describe("3. Notepad Dismissal State & Session Lifecycle", () => {
  test("notepad.js checks spes_notepad_dismissed in localStorage", () => {
    const notepadJsPath = path.join(rootDir, "src", "frontend", "assets", "js", "components", "notepad.js");
    const notepadJs = fs.readFileSync(notepadJsPath, "utf-8");

    assert.ok(notepadJs.includes("spes_notepad_dismissed"), "notepad.js must check or store spes_notepad_dismissed");
    assert.ok(notepadJs.includes("dismissNotepad"), "notepad.js must contain dismissNotepad handler");
    assert.ok(notepadJs.includes("spes-notepad-dismiss-btn"), "notepad.js must bind dismiss button click");
  });

  test("Logout clears spes_notepad_dismissed across all authentication handlers", () => {
    const guardJs = fs.readFileSync(path.join(rootDir, "src", "frontend", "assets", "js", "rbac", "guard.js"), "utf-8");
    assert.ok(
      guardJs.includes('localStorage.removeItem("spes_notepad_dismissed")'),
      "guard.js logout must remove spes_notepad_dismissed"
    );

    const presenceJs = fs.readFileSync(path.join(rootDir, "src", "frontend", "assets", "js", "components", "presence.js"), "utf-8");
    assert.ok(
      presenceJs.includes('localStorage.removeItem("spes_notepad_dismissed")'),
      "presence.js logout must remove spes_notepad_dismissed"
    );
  });

  test("Login cleans up spes_notepad_dismissed to restore notepad for returning staff", () => {
    const authJs = fs.readFileSync(path.join(rootDir, "src", "backend", "api", "auth.js"), "utf-8");
    assert.ok(
      authJs.includes('localStorage.removeItem("spes_notepad_dismissed")'),
      "auth.js loginImplementor must clear spes_notepad_dismissed"
    );

    const ssoCallbackJs = fs.readFileSync(path.join(rootDir, "api", "sso", "callback.js"), "utf-8");
    assert.ok(
      ssoCallbackJs.includes("localStorage.removeItem('spes_notepad_dismissed')"),
      "api/sso/callback.js must clear spes_notepad_dismissed in SSO redirect"
    );

    const loginHandlerJs = fs.readFileSync(path.join(rootDir, "src", "frontend", "assets", "js", "components", "login-handler.js"), "utf-8");
    assert.ok(
      loginHandlerJs.includes('localStorage.removeItem("spes_notepad_dismissed")'),
      "login-handler.js must clear spes_notepad_dismissed upon sign in"
    );
  });
});
/* END NOTEPAD DISMISSAL & SESSION LIFECYCLE SUITE */
