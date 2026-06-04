import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8"));

const ACTIVE_NAV =
  "underline underline-offset-4 decoration-2 decoration-spes-blue text-spes-blue dark:text-spes-yellow";

function applyHeaderFooterTokens(fragment, tokens) {
  return fragment
    .replaceAll("@@LOGO_HREF@@", tokens.LOGO_HREF)
    .replaceAll("@@LOGO_IMG_SRC@@", tokens.LOGO_IMG_SRC)
    .replaceAll("@@LOGIN_HREF@@", tokens.LOGIN_HREF)
    .replaceAll("@@CONTACT_HREF@@", tokens.CONTACT_HREF)
    .replaceAll("@@HASH_HOME@@", tokens.HASH_HOME)
    .replaceAll("@@HASH_PROGRAM@@", tokens.HASH_PROGRAM)
    .replaceAll("@@HASH_LEGAL@@", tokens.HASH_LEGAL)
    .replaceAll("@@NAV_HOME_ACTIVE@@", tokens.NAV_HOME_ACTIVE)
    .replaceAll("@@NAV_CONTACT_ACTIVE@@", tokens.NAV_CONTACT_ACTIVE);
}

function spesSitePartials() {
  const componentsDir = join(__dirname, "src/frontend/components");
  const headerPath = join(componentsDir, "header.html");
  const footerPath = join(componentsDir, "footer.html");
  const sidebarPath = join(componentsDir, "sidebar.html");

  return {
    name: "spes-site-partials",
    enforce: "pre",
    transformIndexHtml(html, ctx) {
      const hasHeader = html.includes("<!-- SPES:HEADER -->");
      const hasSidebar = html.includes("<!-- SPES:SIDEBAR -->");

      if (!hasHeader && !hasSidebar) return html;

      let result = html;

      // ── Sidebar injection ──
      if (hasSidebar) {
        const sidebar = readFileSync(sidebarPath, "utf8");
        result = result.replace("<!-- SPES:SIDEBAR -->", sidebar);
      }

      // ── Header + Footer injection ──
      if (hasHeader) {
        const filename = String(ctx.filename || ctx.path || "").replace(/\\/g, "/");
        const isContact =
          html.includes("<!-- SPES:PAGE:contact -->") ||
          filename.endsWith("/contact.html") ||
          filename.endsWith("contact.html");

        const indexHtml = "../../../index.html";
        const tokens = isContact
          ? {
              LOGO_HREF: indexHtml,
              LOGO_IMG_SRC: "../assets/img/logos/c_spes.png",
              LOGIN_HREF: "../login/index.html",
              CONTACT_HREF: "./contact.html",
              HASH_HOME: `${indexHtml}#home`,
              HASH_PROGRAM: `${indexHtml}#program-overview`,
              HASH_LEGAL: `${indexHtml}#legal-basis`,
              NAV_HOME_ACTIVE: "",
              NAV_CONTACT_ACTIVE: ACTIVE_NAV
            }
          : {
              LOGO_HREF: "#home",
              LOGO_IMG_SRC: "./src/frontend/assets/img/logos/c_spes.png",
              LOGIN_HREF: "./src/frontend/login/",
              CONTACT_HREF: "./src/frontend/components/",
              HASH_HOME: "#home",
              HASH_PROGRAM: "#program-overview",
              HASH_LEGAL: "#legal-basis",
              NAV_HOME_ACTIVE: "",
              NAV_CONTACT_ACTIVE: ""
            };

        const header = applyHeaderFooterTokens(readFileSync(headerPath, "utf8"), tokens);
        const footer = applyHeaderFooterTokens(readFileSync(footerPath, "utf8"), tokens);

        result = result
          .replace("<!-- SPES:HEADER -->", header)
          .replace("<!-- SPES:FOOTER -->", footer);
      }

      return result;
    }
  };
}


export default defineConfig({
  base: "./",
  envDir: join(__dirname, "src/backend"),
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version ?? "")
  },
  plugins: [
    spesSitePartials(), 
    tailwindcss(),
    {
      name: "remove-crossorigin",
      transformIndexHtml(html) {
        // Removes crossorigin attributes that cause file:// loading issues in some browsers
        return html.replace(/ (crossorigin|integrity)(="[^"]*")?/g, "");
      }
    }
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    reportCompressedSize: true,
    modulePreload: {
      polyfill: true
    },
    rollupOptions: {
      input: {
        landing:        resolve(__dirname, "index.html"),
        login:          resolve(__dirname, "src/frontend/login/index.html"),
        contact:        resolve(__dirname, "src/frontend/components/contact.html"),
        dashboard:      resolve(__dirname, "src/frontend/pages/dashboard/index.html"),
        implementors:   resolve(__dirname, "src/frontend/pages/implementors/index.html"),
        beneficiaries:  resolve(__dirname, "src/frontend/pages/beneficiaries/index.html"),
        roles:          resolve(__dirname, "src/frontend/pages/roles/index.html"),
        exports:        resolve(__dirname, "src/frontend/pages/exports/index.html"),
      }
    }
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts: true
  }
});


