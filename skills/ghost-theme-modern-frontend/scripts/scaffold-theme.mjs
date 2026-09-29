#!/usr/bin/env node
/**
 * scaffold-theme.mjs
 *
 * Generate a Ghost theme that is wired for a modern build pipeline:
 *   - Vite for bundling (hashed filenames + manifest -> Handlebars partials)
 *   - Tailwind CSS for styling (v4, @tailwindcss/vite)
 *   - optional React islands for progressive enhancement
 *
 * The generated theme is intentionally GScan-clean out of the box: the
 * generated `partials/vite_assets/*.hbs` placeholders are valid Handlebars
 * before the first `npm run build`, and Vite is configured (`assetsDir: "."`)
 * so it never emits `assets/built/assets/**`, which GScan warns about.
 *
 * Usage:
 *   node scaffold-theme.mjs --name my-theme [--out DIR] [--react] [--no-tailwind] [--force]
 *
 * No dependencies: plain Node (>=18) with node:fs.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `
scaffold-theme.mjs — create a Vite + Tailwind Ghost theme

Usage:
  node scaffold-theme.mjs --name <theme-name> [options]

Options:
  --name <name>     Theme name, kebab-case (required). Also the directory name.
  --out <dir>       Parent directory to create the theme in (default: .)
  --react           Add React islands (@vitejs/plugin-react, react, react-dom)
  --no-tailwind     Skip Tailwind CSS (plain CSS with Vite only)
  --force           Write into an existing non-empty directory
  --help            Show this message

Examples:
  node scaffold-theme.mjs --name my-theme
  node scaffold-theme.mjs --name my-theme --out ./themes --react
`;

function parseArgs(argv) {
  const args = { name: null, out: ".", react: false, tailwind: true, force: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case "--name":
        args.name = argv[++i];
        break;
      case "--out":
        args.out = argv[++i];
        break;
      case "--react":
        args.react = true;
        break;
      case "--no-tailwind":
        args.tailwind = false;
        break;
      case "--force":
        args.force = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        if (token.startsWith("--")) throw new Error(`Unknown option: ${token}`);
        if (!args.name) args.name = token;
    }
  }
  return args;
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP.trimStart());
    return;
  }
  if (!args.name) {
    process.stderr.write("error: --name is required\n\n" + HELP.trimStart());
    process.exitCode = 1;
    return;
  }
  if (!KEBAB.test(args.name)) {
    process.stderr.write(
      `error: theme name "${args.name}" must be kebab-case (lowercase letters, digits, single hyphens)\n`,
    );
    process.exitCode = 1;
    return;
  }

  const themeDir = path.resolve(args.out, args.name);
  if (fs.existsSync(themeDir) && fs.readdirSync(themeDir).length > 0 && !args.force) {
    process.stderr.write(
      `error: ${themeDir} exists and is not empty (pass --force to write into it)\n`,
    );
    process.exitCode = 1;
    return;
  }

  const files = buildFiles(args);
  for (const [rel, content] of Object.entries(files)) {
    const dest = path.join(themeDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content, "utf8");
    process.stdout.write(`  + ${rel}\n`);
  }

  const pkgName = args.name;
  process.stdout.write(`
Created Ghost theme "${pkgName}" at ${themeDir}

Next steps:
  cd ${path.relative(process.cwd(), themeDir) || "."}
  npm install
  npm run build      # writes assets/built/** and partials/vite_assets/*.hbs
  npm run dev        # Vite dev server (see README for wiring it into Ghost)
  npm test           # build + GScan validation
  npm run zip        # build + package dist/${pkgName}.zip for upload

Upload the zip at Ghost Admin -> Settings -> Design -> Change theme.
`);
}

// ---------------------------------------------------------------------------
// File tree
// ---------------------------------------------------------------------------

function buildFiles(args) {
  const { name, react, tailwind } = args;
  const files = {};

  files["package.json"] = packageJson({ name, react, tailwind });
  files["vite.config.js"] = viteConfig({ react, tailwind });
  files["lib/vite/ghost-manifest-partials.js"] = ghostManifestPartials();
  files["scripts/zip.mjs"] = zipScript();
  files[".gitignore"] = gitignore();
  files["README.md"] = readme({ name, react, tailwind });

  // Source assets (input to Vite)
  files["assets/css/index.css"] = tailwind
    ? tailwindEntryCss()
    : plainEntryCss();
  files["assets/js/index.js"] = entryJs({ react });
  if (react) {
    files["assets/js/islands.jsx"] = reactIslands();
    files["assets/js/islands/ReadingProgress.jsx"] = readingProgressIsland();
  }

  // Generated-at-build-time placeholders (keep them valid before the first build)
  files["partials/vite_assets/head.hbs"] =
    '{{!-- Generated by `npm run build` (lib/vite/ghost-manifest-partials.js). Do not edit. --}}\n';
  files["partials/vite_assets/foot.hbs"] =
    '{{!-- Generated by `npm run build` (lib/vite/ghost-manifest-partials.js). Do not edit. --}}\n';

  // Partials
  files["partials/header.hbs"] = headerPartial();
  files["partials/footer.hbs"] = footerPartial();
  files["partials/navigation.hbs"] = navigationPartial();
  files["partials/pagination.hbs"] = paginationPartial();
  files["partials/card.hbs"] = cardPartial();

  // Templates
  files["default.hbs"] = defaultTemplate();
  files["index.hbs"] = indexTemplate();
  files["post.hbs"] = postTemplate({ react });
  files["page.hbs"] = pageTemplate();
  files["tag.hbs"] = tagTemplate();
  files["author.hbs"] = authorTemplate();
  files["error.hbs"] = errorTemplate();

  return files;
}

// ---------------------------------------------------------------------------
// Config files
// ---------------------------------------------------------------------------

function packageJson({ name, react, tailwind }) {
  const devDependencies = {
    vite: "^7.0.0",
    archiver: "^7.0.1",
  };
  if (tailwind) {
    devDependencies["tailwindcss"] = "^4.1.0";
    devDependencies["@tailwindcss/vite"] = "^4.1.0";
    devDependencies["@tailwindcss/typography"] = "^0.5.16";
  }
  if (react) {
    devDependencies["@vitejs/plugin-react"] = "^5.0.0";
    devDependencies["react"] = "^19.0.0";
    devDependencies["react-dom"] = "^19.0.0";
  }

  const pkg = {
    name,
    description: `A Ghost theme for ${name}, built with Vite${tailwind ? " and Tailwind CSS" : ""}.`,
    version: "0.1.0",
    license: "MIT",
    author: {
      name: "Your Name",
      email: "you@example.com",
      url: "https://example.com",
    },
    keywords: ["ghost", "ghost-theme", "vite", ...(tailwind ? ["tailwindcss"] : []), ...(react ? ["react"] : [])],
    engines: {
      ghost: ">=5.0.0",
    },
    type: "module",
    scripts: {
      dev: "vite",
      build: "vite build",
      test: "npm run build && npx --yes gscan .",
      zip: "node scripts/zip.mjs",
    },
    browserslist: ["defaults"],
    devDependencies,
    config: {
      posts_per_page: 12,
      card_assets: true,
      // Ghost has no fixed size vocabulary: every `size="..."` used in a template
      // must be declared here. These are Casper's canonical names/widths.
      image_sizes: {
        xxs: { width: 30 },
        xs: { width: 100 },
        s: { width: 300 },
        m: { width: 600 },
        l: { width: 1000 },
        xl: { width: 2000 },
      },
      custom: {
        accent_color: {
          type: "color",
          default: "#2563eb",
          description: "Accent colour used for links and buttons",
        },
        show_cover_image: {
          type: "boolean",
          default: true,
          description: "Show the cover image on the home page",
        },
        header_layout: {
          type: "select",
          options: ["Left aligned", "Centered"],
          default: "Left aligned",
          description: "How the site header is aligned",
        },
      },
    },
  };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

function viteConfig({ react, tailwind }) {
  const imports = ['import { defineConfig } from "vite";'];
  if (tailwind) imports.push('import tailwindcss from "@tailwindcss/vite";');
  if (react) imports.push('import react from "@vitejs/plugin-react";');
  imports.push('import ghostManifestPartials from "./lib/vite/ghost-manifest-partials.js";');

  const plugins = ['    ghostManifestPartials("assets/built/manifest.json", "partials/vite_assets/head.hbs", "partials/vite_assets/foot.hbs"),'];
  if (react) plugins.push("    react(),");
  if (tailwind) plugins.push("    tailwindcss(),");

  return `${imports.join("\n")}

export default defineConfig({
  // Ghost serves theme assets from a hashed URL, so every emitted URL must be relative.
  base: "./",
  publicDir: false,
  build: {
    outDir: "assets/built",
    // Do NOT emit assets/built/assets/** — GScan warns about that nesting.
    assetsDir: ".",
    emptyOutDir: true,
    // Hashed filenames are useless to Handlebars, so emit a manifest and turn it
    // into static partials the theme can include.
    manifest: "manifest.json",
    rollupOptions: {
      input: "assets/js/index.js",
    },
  },
  plugins: [
${plugins.join("\n")}
  ],
});
`;
}

function ghostManifestPartials() {
  return `import fs from "node:fs";

/**
 * Vite plugin: ghost-manifest-partials
 *
 * Ghost cannot read Vite's manifest.json at render time, so after every build
 * this plugin rewrites two Handlebars partials that contain plain <link>/<script>
 * tags pointing at the hashed files:
 *
 *   partials/vite_assets/head.hbs  -> <link rel="stylesheet"> + <link rel="preload">
 *   partials/vite_assets/foot.hbs  -> <script type="module">
 *
 * Include them from default.hbs with {{> "vite_assets/head"}} / {{> "vite_assets/foot"}}.
 * Handlebars escaping is safe here: {{asset "built/..."}} is resolved by Ghost,
 * which also appends its own cache-busting hash.
 */
export default function ghostManifestPartials(manifestPath, headPath, footPath) {
  return {
    name: "vite-plugin-ghost-manifest-partials",
    apply: "build",
    closeBundle() {
      if (!fs.existsSync(manifestPath)) return;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

      let head = "{{!-- Generated by lib/vite/ghost-manifest-partials.js during a Vite build. Do not edit. --}}\\n";
      let foot = "{{!-- Generated by lib/vite/ghost-manifest-partials.js during a Vite build. Do not edit. --}}\\n";

      for (const entry of Object.values(manifest)) {
        if (!entry.file || !entry.file.endsWith(".js")) continue;

        head += \`<link rel="preload" as="script" href="{{asset "built/\${entry.file}"}}">\\n\`;

        for (const css of entry.css ?? []) {
          head += \`<link rel="stylesheet" href="{{asset "built/\${css}"}}">\\n\`;
        }

        foot += \`<script type="module" src="{{asset "built/\${entry.file}"}}"></script>\\n\`;
      }

      fs.writeFileSync(headPath, head, "utf8");
      fs.writeFileSync(footPath, foot, "utf8");
      console.log(\`✓ wrote \${headPath} and \${footPath}\`);
    },
  };
}
`;
}

function zipScript() {
  return `#!/usr/bin/env node
/**
 * Build the theme, then zip exactly the files Ghost needs.
 *
 * node_modules, lib/, scripts/, source assets, and dev config are NOT shipped:
 * Ghost only needs compiled assets, templates, partials, members templates,
 * the locale files, and package.json.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import archiver from "archiver";

const themeRoot = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(themeRoot, "package.json"), "utf8"));
const outDir = path.join(themeRoot, "dist");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, \`\${pkg.name}.zip\`);

execFileSync("npm", ["run", "build"], { stdio: "inherit", cwd: themeRoot });

const include = ["assets/built", "partials", "members", "locales", "package.json"];
const globs = ["*.hbs"];
// Static assets that Vite does not process but templates reference via
// {{asset "images/..."}} / {{asset "fonts/..."}} must still ship.
const extraDirs = ["assets/images", "assets/fonts", "assets/icons"];

const output = fs.createWriteStream(outFile);
const archive = archiver("zip", { zlib: { level: 9 } });

await new Promise((resolve, reject) => {
  output.on("close", resolve);
  archive.on("error", reject);
  archive.pipe(output);

  for (const entry of include) {
    const abs = path.join(themeRoot, entry);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isDirectory()) archive.directory(abs, entry);
    else archive.file(abs, { name: entry });
  }
  for (const entry of extraDirs) {
    const abs = path.join(themeRoot, entry);
    if (fs.existsSync(abs)) archive.directory(abs, entry);
  }
  for (const glob of globs) {
    archive.glob(glob, { cwd: themeRoot, ignore: ["node_modules/**", "dist/**", "assets/built/**"] });
  }
  archive.finalize();
});

console.log(\`✓ \${path.relative(themeRoot, outFile)} (\${(fs.statSync(outFile).size / 1024).toFixed(1)} kB)\`);
`;
}

function gitignore() {
  return `node_modules/
dist/
assets/built/
partials/vite_assets/*.hbs
!partials/vite_assets/.keep
.DS_Store
*.log
`;
}

function readme({ name, react, tailwind }) {
  return `# ${name}

A Ghost theme built with Vite${tailwind ? ", Tailwind CSS" : ""}${react ? ", and React islands" : ""}.

## Layout

| Path | Purpose |
|---|---|
| \`*.hbs\` | Ghost templates (\`default.hbs\` is the layout; the rest set \`{{!< default}}\`) |
| \`partials/\` | Reusable Handlebars partials (including \`vite_assets/\`, generated) |
| \`assets/css/\`, \`assets/js/\` | Source files compiled by Vite |
| \`assets/built/\` | Vite output that Ghost serves — generated, git-ignored |
| \`lib/vite/\` | Build-time Vite plugins (not shipped in the zip) |
| \`scripts/zip.mjs\` | Packages only shippable files into \`dist/${name}.zip\` |

## Commands

\`\`\`bash
npm install
npm run dev     # Vite dev server with HMR
npm run build   # compile to assets/built + regenerate partials/vite_assets/*.hbs
npm test        # build, then validate the theme with GScan
npm run zip     # build and produce dist/${name}.zip for upload
\`\`\`

## Installing into Ghost

1. \`npm run zip\`
2. Ghost Admin → Settings → Design → Change theme → Upload theme → \`dist/${name}.zip\`

## Local development against a running Ghost

\`npm run build\` then symlink this directory into \`content/themes/\`:

\`\`\`bash
ln -s "$PWD" /path/to/ghost/content/themes/${name}
\`\`\`

Ghost caches templates; restart Ghost (or use \`ghost restart\`) after changing \`.hbs\`
files, because Ghost reads templates from disk rather than from the Vite dev server.

${tailwind ? `## Tailwind

Tailwind v4 is wired through \`@tailwindcss/vite\`. Content sources are declared in
\`assets/css/index.css\` with \`@source\` globs that include the \`.hbs\` templates, so
utility classes used only inside Handlebars are still generated.
` : ""}${react ? `## React islands

\`assets/js/islands.jsx\` finds every \`[data-island]\` element and mounts the matching
component into it. Templates opt in with markup, e.g.:

\`\`\`hbs
<div data-island="ReadingProgress"></div>
\`\`\`

React never renders the document — Ghost still server-renders all content, so SEO,
members features, and routing keep working.
` : ""}`;
}

// ---------------------------------------------------------------------------
// Asset sources
// ---------------------------------------------------------------------------

function tailwindEntryCss() {
  return `@import "tailwindcss";
@plugin "@tailwindcss/typography";

/* Tailwind v4 scans these sources for class names. The .hbs globs matter:
   classes live in Handlebars templates, not only in JS. */
@source "../../*.hbs";
@source "../../partials/**/*.hbs";
@source "../../members/**/*.hbs";
@source "../js/**/*.{js,jsx}";

@theme {
  --color-accent: oklch(0.55 0.2 260);
}

/* Ghost injects --gh-font-body / --gh-font-heading when a custom font is
   selected in Admin; falling back keeps the theme self-contained. GScan warns
   if a theme never consumes them. */
@layer base {
  body {
    font-family: var(--gh-font-body, ui-sans-serif, system-ui, sans-serif);
  }
  h1, h2, h3, h4, h5, h6 {
    font-family: var(--gh-font-heading, var(--gh-font-body, ui-sans-serif, system-ui, sans-serif));
  }
}

/* Ghost renders post content into .gh-content; style it with the typography
   plugin so editor output (cards, headings, lists, embeds) looks right. */
@layer components {
  .gh-content {
    @apply prose prose-slate max-w-none dark:prose-invert;
  }
  .gh-content :where(figure) {
    @apply my-8;
  }
  .gh-content :where(figcaption) {
    @apply mt-2 text-center text-sm text-slate-500;
  }
}

/* Ghost's wide/full editor cards. GScan reports these as *errors* when a theme
   does not style them, so they are not optional. */
.kg-width-wide {
  width: min(85vw, 1100px);
  max-width: none;
  margin-inline: auto;
}
.kg-width-full {
  width: 100vw;
  max-width: none;
  margin-left: calc(50% - 50vw);
}
`;
}

function plainEntryCss() {
  return `:root {
  --color-accent: #2563eb;
}

body {
  margin: 0;
  font-family: var(--gh-font-body, system-ui, -apple-system, "Segoe UI", sans-serif);
  line-height: 1.6;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--gh-font-heading, var(--gh-font-body, system-ui, sans-serif));
}

.site-wrapper {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.site-main {
  flex: 1;
  width: 100%;
  max-width: 64rem;
  margin: 0 auto;
  padding: 2.5rem 1rem;
}

/* Ghost's wide/full editor cards — GScan errors if these are unstyled. */
.kg-width-wide {
  width: min(85vw, 1100px);
  max-width: none;
  margin-inline: auto;
}

.kg-width-full {
  width: 100vw;
  max-width: none;
  margin-left: calc(50% - 50vw);
}
`;
}

function entryJs({ react }) {
  const lines = [
    "/** Vite entry point. Import every global stylesheet and script here. */",
    'import "../css/index.css";',
    "",
  ];
  if (react) {
    lines.push('import "./islands.jsx";');
    lines.push("");
  }
  lines.push("// Non-React progressive enhancement goes here.");
  lines.push("");
  return lines.join("\n");
}

function reactIslands() {
  return `import { createRoot } from "react-dom/client";
import ReadingProgress from "./islands/ReadingProgress.jsx";

/**
 * Island registry.
 *
 * A template opts in by rendering a mount point:
 *   <div data-island="ReadingProgress"></div>
 *
 * Scalars can be passed safely through data attributes (Handlebars escapes
 * attribute values):
 *   <div data-island="ReadingProgress" data-target=".gh-content"></div>
 *
 * Larger payloads should come from the Content API or a
 * <script type="application/json"> block — see
 * references/react-islands.md in the skill bundle.
 */
const registry = {
  ReadingProgress,
};

for (const el of document.querySelectorAll("[data-island]")) {
  const name = el.dataset.island;
  const Component = registry[name];
  if (!Component) {
    console.warn(\`[islands] unknown island: \${name}\`);
    continue;
  }
  const props = { ...el.dataset };
  createRoot(el).render(<Component {...props} />);
}
`;
}

function readingProgressIsland() {
  return `import { useEffect, useState } from "react";

/**
 * A dependency-free example island: a reading-progress bar.
 * It reads the rendered Ghost content rather than receiving data as props,
 * which is the cheapest way to add interactivity to a Handlebars theme.
 */
export default function ReadingProgress({ target = ".gh-content" }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const node = document.querySelector(target);
    if (!node) return undefined;

    const onScroll = () => {
      const start = node.offsetTop;
      const total = node.offsetHeight - window.innerHeight;
      const seen = window.scrollY - start;
      setProgress(total <= 0 ? 100 : Math.min(100, Math.max(0, (seen / total) * 100)));
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [target]);

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: "0 0 auto 0",
        height: "3px",
        width: \`\${progress}%\`,
        background: "var(--color-accent, #2563eb)",
        transition: "width 80ms linear",
        zIndex: 50,
      }}
    />
  );
}
`;
}

// ---------------------------------------------------------------------------
// Partials
// ---------------------------------------------------------------------------

function headerPartial() {
  return `<header class="site-header border-b border-slate-200 dark:border-slate-800">
    <div class="mx-auto flex w-full max-w-5xl items-center justify-between gap-6 px-4 py-4{{#match @custom.header_layout "=" "Centered"}} flex-col text-center{{/match}}">
        <a class="site-title text-lg font-semibold tracking-tight" href="{{@site.url}}">
            {{#if @site.logo}}
                <img class="site-logo max-h-8" src="{{img_url @site.logo size="s"}}" alt="{{@site.title}}">
            {{else}}
                {{@site.title}}
            {{/if}}
        </a>
        {{> "navigation"}}
        {{!-- Ghost's native search: any element with data-ghost-search opens the modal
             (Cmd/Ctrl+K also works). No JS of your own is required. --}}
        <button class="gh-search shrink-0 rounded border border-slate-200 p-2 dark:border-slate-700" type="button" data-ghost-search aria-label="{{t "Search"}}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <circle cx="11" cy="11" r="7"></circle>
                <path d="m20 20-3.5-3.5"></path>
            </svg>
        </button>
        {{#if @site.members_enabled}}
            <div class="site-members flex items-center gap-3">
                {{#if @member}}
                    <a class="text-sm" href="#/portal/account">{{t "Account"}}</a>
                {{else}}
                    <a class="text-sm" href="#/portal/signin">{{t "Sign in"}}</a>
                    <a class="rounded bg-accent px-3 py-1.5 text-sm text-white" href="#/portal/signup">{{t "Subscribe"}}</a>
                {{/if}}
            </div>
        {{/if}}
    </div>
</header>
`;
}

function navigationPartial() {
  return `{{!-- Overrides Ghost's default navigation markup.

     Ghost loads this file for BOTH the primary and secondary navigations, so
     both branches must be handled here. Do NOT call {{navigation}} from inside
     this partial: this file *is* the navigation template, and calling it again
     recurses.

     Available inside the loop: {{label}}, {{url}}, {{current}}, {{slug}}.
     The same data is exposed globally as @site.navigation / @site.secondary_navigation. --}}
{{#if isSecondary}}
    <ul class="site-nav-secondary flex flex-wrap items-center gap-4 text-xs">
        {{#foreach navigation}}
            <li class="nav-{{slug}}{{#if current}} nav-current{{/if}}">
                <a href="{{url absolute="true"}}">{{label}}</a>
            </li>
        {{/foreach}}
    </ul>
{{else}}
    <ul class="site-nav-list flex flex-wrap items-center gap-5 text-sm">
        {{#foreach navigation}}
            <li class="nav-{{slug}}{{#if current}} nav-current font-semibold{{/if}}">
                <a href="{{url absolute="true"}}">{{label}}</a>
            </li>
        {{/foreach}}
    </ul>
{{/if}}
`;
}

function paginationPartial() {
  return `{{!-- Overrides Ghost's default pagination markup.

     A fully translatable theme needs this file: without it, the built-in
     "Newer/Older Posts" text cannot be translated. Ghost loads it wherever
     {{pagination}} is used. --}}
<nav class="pagination mt-12 flex items-center justify-between gap-4 text-sm" role="navigation">
    {{#if prev}}
        <a class="newer-posts font-medium" href="{{page_url prev}}">&larr; {{t "Newer Posts"}}</a>
    {{/if}}
    <span class="page-number text-slate-500">{{t "Page {page} of {pages}" page=page pages=pages}}</span>
    {{#if next}}
        <a class="older-posts font-medium" href="{{page_url next}}">{{t "Older Posts"}} &rarr;</a>
    {{/if}}
</nav>
`;
}

function footerPartial() {
  return `<footer class="site-footer border-t border-slate-200 dark:border-slate-800">
    <div class="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between dark:text-slate-400">
        <p>&copy; {{date format="YYYY"}} <a href="{{@site.url}}">{{@site.title}}</a></p>
        <nav aria-label="{{t "Secondary navigation"}}">
            {{navigation type="secondary"}}
        </nav>
        <p><a href="https://ghost.org" rel="noopener">{{t "Powered by Ghost"}}</a></p>
    </div>
</footer>
`;
}

function cardPartial() {
  return `<article class="post-card group flex flex-col overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
    {{#if feature_image}}
        <a class="post-card-image block overflow-hidden" href="{{url}}">
            <img
                class="h-48 w-full object-cover transition-transform duration-300 group-hover:scale-105"
                src="{{img_url feature_image size="m"}}"
                srcset="{{img_url feature_image size="s"}} 300w,
                        {{img_url feature_image size="m"}} 600w,
                        {{img_url feature_image size="l"}} 1000w"
                sizes="(max-width: 640px) 100vw, 50vw"
                alt="{{#if feature_image_alt}}{{feature_image_alt}}{{else}}{{title}}{{/if}}"
                loading="lazy"
            >
        </a>
    {{/if}}
    <div class="post-card-content flex flex-1 flex-col gap-3 p-5">
        <h2 class="post-card-title text-xl font-semibold leading-snug">
            <a href="{{url}}">{{title}}</a>
        </h2>
        <p class="post-card-excerpt text-slate-600 dark:text-slate-400">{{excerpt words="24"}}</p>
        <div class="post-card-meta mt-auto flex items-center gap-2 text-xs text-slate-500">
            {{#primary_author}}
                {{#if profile_image}}
                    <img class="h-6 w-6 rounded-full" src="{{img_url profile_image size="xxs"}}" alt="{{name}}" loading="lazy">
                {{/if}}
                <a href="{{url}}">{{name}}</a>
            {{/primary_author}}
            <span aria-hidden="true">&middot;</span>
            <time datetime="{{date format="YYYY-MM-DD"}}">{{date format="D MMM YYYY"}}</time>
            {{#if reading_time}}
                <span aria-hidden="true">&middot;</span>
                <span>{{reading_time}}</span>
            {{/if}}
        </div>
    </div>
</article>
`;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function defaultTemplate() {
  return `<!DOCTYPE html>
<html lang="{{@site.locale}}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{meta_title}}</title>

    {{!-- Vite output: stylesheets and module preloads (generated at build time). --}}
    {{> "vite_assets/head"}}

    {{!-- Ghost injects meta tags, portal assets, code injection, and card styles here. --}}
    {{ghost_head}}
</head>
<body class="{{body_class}} bg-white text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
    <div class="site-wrapper flex min-h-screen flex-col"{{#if @custom.accent_color}} style="--color-accent: {{@custom.accent_color}}"{{/if}}>
        {{> "header"}}

        <main id="site-main" class="site-main mx-auto w-full max-w-5xl flex-1 px-4 py-10">
            {{{body}}}
        </main>

        {{> "footer"}}
    </div>

    {{!-- Vite output: module scripts (generated at build time). --}}
    {{> "vite_assets/foot"}}

    {{ghost_foot}}
</body>
</html>
`;
}

function indexTemplate() {
  return `{{!< default}}
{{!-- Context: index (home, paginated post list, and any custom route using this template). --}}

{{#if @custom.show_cover_image}}
    {{#if @site.cover_image}}
        <section class="site-hero -mx-4 mb-10 overflow-hidden rounded-lg">
            <img
                class="h-64 w-full object-cover sm:h-80"
                src="{{img_url @site.cover_image size="l"}}"
                srcset="{{img_url @site.cover_image size="m"}} 600w,
                        {{img_url @site.cover_image size="l"}} 1000w,
                        {{img_url @site.cover_image size="xl"}} 2000w"
                sizes="100vw"
                alt="{{@site.title}}"
            >
        </section>
    {{/if}}
{{/if}}

<header class="mb-10">
    <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">{{@site.title}}</h1>
    {{#if @site.description}}
        <p class="mt-2 text-lg text-slate-600 dark:text-slate-400">{{@site.description}}</p>
    {{/if}}
</header>

{{#if posts}}
    <div class="post-feed grid gap-8 sm:grid-cols-2">
        {{#foreach posts}}
            {{> "card"}}
        {{/foreach}}
    </div>
    {{pagination}}
{{else}}
    <p class="text-slate-600 dark:text-slate-400">{{t "No posts yet."}}</p>
{{/if}}
`;
}

function postTemplate({ react }) {
  return `{{!< default}}
{{!-- Context: post — a single published post. --}}
{{#post}}

${react ? '<div data-island="ReadingProgress" data-target=".gh-content"></div>\n' : ""}<article class="post-full {{post_class}} mx-auto max-w-3xl">
    <header class="post-full-header mb-8">
        <h1 class="post-full-title text-3xl font-bold tracking-tight sm:text-4xl">{{title}}</h1>

        {{#if custom_excerpt}}
            <p class="post-full-excerpt mt-4 text-lg text-slate-600 dark:text-slate-400">{{custom_excerpt}}</p>
        {{/if}}

        <div class="post-full-meta mt-6 flex flex-wrap items-center gap-3 text-sm text-slate-500">
            {{#primary_author}}
                <a class="font-medium" href="{{url}}">{{name}}</a>
            {{/primary_author}}
            <time datetime="{{date format="YYYY-MM-DD"}}">{{date format="D MMMM YYYY"}}</time>
            {{#if reading_time}}
                <span aria-hidden="true">&middot;</span>
                <span>{{reading_time}}</span>
            {{/if}}
            {{#if primary_tag}}
                <span aria-hidden="true">&middot;</span>
                <a href="{{primary_tag.url}}">{{primary_tag.name}}</a>
            {{/if}}
        </div>
    </header>

    {{#if feature_image}}
        <figure class="post-full-image mb-8">
            <img
                class="w-full rounded-lg"
                src="{{img_url feature_image size="l"}}"
                srcset="{{img_url feature_image size="m"}} 600w,
                        {{img_url feature_image size="l"}} 1000w,
                        {{img_url feature_image size="xl"}} 2000w"
                sizes="(max-width: 768px) 100vw, 768px"
                alt="{{#if feature_image_alt}}{{feature_image_alt}}{{else}}{{title}}{{/if}}"
            >
            {{#if feature_image_caption}}
                <figcaption class="mt-2 text-sm text-slate-500">{{feature_image_caption}}</figcaption>
            {{/if}}
        </figure>
    {{/if}}

    <section class="post-full-content">
        <div class="gh-content">
            {{content}}
        </div>
    </section>

    {{#if tags}}
        <footer class="post-full-tags mt-10 flex flex-wrap gap-2">
            {{#foreach tags}}
                <a class="rounded-full border border-slate-200 px-3 py-1 text-xs dark:border-slate-700" href="{{url}}">{{name}}</a>
            {{/foreach}}
        </footer>
    {{/if}}

    {{#if @site.comments_enabled}}
        <section class="post-full-comments mt-12">
            {{comments}}
        </section>
    {{/if}}

    <nav class="post-full-nav mt-12 grid gap-4 border-t border-slate-200 pt-8 sm:grid-cols-2 dark:border-slate-800">
        {{#prev_post}}
            <a class="prev-post" href="{{url}}">
                <span class="block text-xs uppercase tracking-wide text-slate-500">{{t "Previous"}}</span>
                <span class="font-medium">{{title}}</span>
            </a>
        {{/prev_post}}
        {{#next_post}}
            <a class="next-post sm:text-right" href="{{url}}">
                <span class="block text-xs uppercase tracking-wide text-slate-500">{{t "Next"}}</span>
                <span class="font-medium">{{title}}</span>
            </a>
        {{/next_post}}
    </nav>
</article>
{{/post}}
`;
}

function pageTemplate() {
  return `{{!< default}}
{{!-- Context: page — a static page (About, Contact, ...). --}}
{{#post}}
<article class="page-full {{post_class}} mx-auto max-w-3xl">
    {{!-- Ghost 5.x lets editors hide a page's title/feature image; honouring this
         flag is required by GScan. --}}
    {{#if @page.show_title_and_feature_image}}
        <header class="mb-8">
            <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">{{title}}</h1>
            {{#if custom_excerpt}}
                <p class="mt-4 text-lg text-slate-600 dark:text-slate-400">{{custom_excerpt}}</p>
            {{/if}}
        </header>

        {{#if feature_image}}
            <figure class="mb-8">
                <img
                    class="w-full rounded-lg"
                    src="{{img_url feature_image size="l"}}"
                    alt="{{#if feature_image_alt}}{{feature_image_alt}}{{else}}{{title}}{{/if}}"
                >
            </figure>
        {{/if}}
    {{/if}}

    <section class="page-full-content">
        <div class="gh-content">{{content}}</div>
    </section>
</article>
{{/post}}
`;
}

function tagTemplate() {
  return `{{!< default}}
{{!-- Context: tag — a tag archive. --}}
{{#tag}}
<header class="tag-header mb-10">
    <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">{{name}}</h1>
    {{#if description}}
        <p class="mt-2 text-lg text-slate-600 dark:text-slate-400">{{description}}</p>
    {{/if}}
    {{#if ../pagination.total}}
        <p class="mt-2 text-sm text-slate-500">{{plural ../pagination.total empty="No posts" singular="% post" plural="% posts"}}</p>
    {{/if}}
</header>
{{/tag}}

{{#if posts}}
    <div class="post-feed grid gap-8 sm:grid-cols-2">
        {{#foreach posts}}
            {{> "card"}}
        {{/foreach}}
    </div>
    {{pagination}}
{{else}}
    <p class="text-slate-600 dark:text-slate-400">{{t "No posts in this tag yet."}}</p>
{{/if}}
`;
}

function authorTemplate() {
  return `{{!< default}}
{{!-- Context: author — an author archive. --}}
{{#author}}
<header class="author-header mb-10 flex items-center gap-5">
    {{#if profile_image}}
        <img class="h-16 w-16 rounded-full object-cover" src="{{img_url profile_image size="s"}}" alt="{{name}}">
    {{/if}}
    <div>
        <h1 class="text-3xl font-bold tracking-tight">{{name}}</h1>
        {{#if bio}}<p class="mt-2 text-slate-600 dark:text-slate-400">{{bio}}</p>{{/if}}
        <p class="mt-2 text-sm text-slate-500">
            {{plural ../pagination.total empty="No posts" singular="% post" plural="% posts"}}
            {{#if location}} &middot; {{location}}{{/if}}
            {{#if website}} &middot; <a href="{{website}}" rel="noopener">{{website}}</a>{{/if}}
        </p>
    </div>
</header>
{{/author}}

{{#if posts}}
    <div class="post-feed grid gap-8 sm:grid-cols-2">
        {{#foreach posts}}
            {{> "card"}}
        {{/foreach}}
    </div>
    {{pagination}}
{{else}}
    <p class="text-slate-600 dark:text-slate-400">{{t "No posts by this author yet."}}</p>
{{/if}}
`;
}

function errorTemplate() {
  return `{{!-- Context: error — used for every 4xx/5xx response.

     Deliberately standalone: Ghost's docs say error templates should not extend
     default.hbs and should not use theme helpers (the only exception is
     {{asset}}), because a helper failure while rendering an error produces a
     misleading report. Inline styles also keep this page readable when the
     asset pipeline itself is what broke. --}}
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{statusCode}} — {{message}}</title>
    <style>
        :root { color-scheme: light dark; }
        body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
            background: Canvas;
            color: CanvasText;
        }
        .error-message { max-width: 32rem; padding: 2rem; text-align: center; }
        .error-code { margin: 0; font-size: 4rem; line-height: 1; }
        .error-description { margin-top: 1rem; font-size: 1.125rem; opacity: 0.75; }
        .error-link {
            display: inline-block;
            margin-top: 2rem;
            padding: 0.6rem 1.25rem;
            border-radius: 0.375rem;
            background: CanvasText;
            color: Canvas;
            text-decoration: none;
        }
    </style>
</head>
<body>
    <section class="error-message">
        <h1 class="error-code">{{statusCode}}</h1>
        <p class="error-description">{{message}}</p>
        <a class="error-link" href="{{@site.url}}">Go to the homepage</a>
    </section>
</body>
</html>
`;
}

main();
