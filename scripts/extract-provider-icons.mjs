#!/usr/bin/env node
/**
 * One-off generator for components/provider-icons.tsx.
 *
 * Why: @lobehub/icons declares @lobehub/ui + antd as peerDependencies, so npm
 * auto-installs them (plus @emoji-mart/react via @lobehub/ui) in every consumer
 * tree. @emoji-mart/react only peers react<=18, which clashes with pi-web's
 * react 19 and triggers ERESOLVE warnings that pi-web's own `overrides` cannot
 * fix (npm only honors overrides from the *root* package.json). The icons are
 * plain SVG React components, so we vendor the ~30 that ProviderIcon.tsx needs
 * and drop the @lobehub/icons dependency entirely.
 *
 * Regenerate (when a newer @lobehub/icons is wanted):
 *   npm i --no-save @lobehub/icons@latest
 *   node scripts/extract-provider-icons.mjs
 *
 * This reads the installed package's compiled es/ modules, renders each icon
 * with react-dom/server, and emits a self-contained TSX file. Do not edit the
 * generated file by hand.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PKG_ES = path.join(ROOT, "node_modules", "@lobehub", "icons", "es");
const TMP = path.join(ROOT, ".tmp-provider-icons");
const OUT = path.join(ROOT, "components", "provider-icons.tsx");

// (brand, kind) pairs imported by components/ProviderIcon.tsx
const ICONS = [
  ["Anthropic", "Mono"],
  ["OpenAI", "Mono"],
  ["Google", "Color"],
  ["DeepSeek", "Color"],
  ["Groq", "Mono"],
  ["Mistral", "Color"],
  ["Moonshot", "Mono"],
  ["Minimax", "Color"],
  ["Fireworks", "Color"],
  ["HuggingFace", "Color"],
  ["Cerebras", "Color"],
  ["OpenRouter", "Mono"],
  ["XAI", "Mono"],
  ["Cloudflare", "Color"],
  ["Vercel", "Mono"],
  ["GithubCopilot", "Mono"],
  ["Aws", "Color"],
  ["Azure", "Color"],
  ["Kimi", "Color"],
  ["Qwen", "Color"],
  ["Zhipu", "Color"],
  ["Cohere", "Color"],
  ["Perplexity", "Color"],
  ["Together", "Color"],
  ["Grok", "Mono"],
  ["AntGroup", "Color"],
  ["Nvidia", "Color"],
  ["OpenCode", "Mono"],
  ["XiaomiMiMo", "Mono"],
  ["ZAI", "Mono"],
];

// The published es/ files are bundler-only ESM ("type" absent). Rewrite them to
// CJS so plain node can require() them, mirroring the original relative layout
// under .tmp-provider-icons/.
function toCjs(src) {
  src = src.replace(/^'use client';\s*/, "");
  src = src.replace(
    /import \{ kebabCase \} from ['"]es-toolkit['"];/,
    'const kebabCase = (s) => s.toLowerCase().replace(/\\s+/g, "-");',
  );
  src = src.replace(
    /import \{([\s\S]*?)\} from ['"]([^'"]+)['"];/g,
    (_m, names, mod) => {
      const mapped = names
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((p) => {
          const [orig, alias] = p.split(/\s+as\s+/).map((s) => s.trim());
          return alias ? `${orig}: ${alias}` : orig;
        })
        .join(", ");
      return `const { ${mapped} } = require(${JSON.stringify(mod)});`;
    },
  );
  src = src.replace(
    /import ([A-Za-z_$][\w$]*) from ['"]([^'"]+)['"];/g,
    (_m, name, mod) => `const ${name} = require(${JSON.stringify(mod)}).default;`,
  );
  src = src.replace(/export default ([A-Za-z_$][\w$]*);/g, "module.exports = $1;");
  src = src.replace(/export var ([A-Za-z_$][\w$]*)/g, "var $1");
  return src;
}

const ATTR_JSX = {
  "fill-rule": "fillRule",
  "clip-rule": "clipRule",
  "stop-color": "stopColor",
  "stop-opacity": "stopOpacity",
  "flood-color": "floodColor",
  "flood-opacity": "floodOpacity",
  "gradient-units": "gradientUnits",
  "gradient-transform": "gradientTransform",
  "color-interpolation-filters": "colorInterpolationFilters",
};
const DROP_ATTRS = new Set(["xmlns", "width", "height", "style", "viewBox"]);

function svgAttrsToJsx(attrStr, brand) {
  const out = {};
  for (const m of attrStr.matchAll(/([a-zA-Z0-9-]+)="([^"]*)"/g)) {
    const [name, value] = [m[1], m[2]];
    if (DROP_ATTRS.has(name)) continue;
    const jsxName = ATTR_JSX[name] ?? name;
    // Namespace any gradient ids referenced from the svg root (e.g. fill).
    out[jsxName] = value.includes("url(#")
      ? value.replace(/url\(#([^)]+)\)/g, (_x, id) => `url(#${ns(id, brand)})`)
      : value;
  }
  return out;
}

function ns(id, brand) {
  return `pi-${brand.toLowerCase()}-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

async function main() {
  rmSync(TMP, { recursive: true, force: true });

  const blocks = [];
  for (const [brand, kind] of ICONS) {
    const srcComp = path.join(PKG_ES, brand, "components", `${kind}.js`);
    const srcStyle = path.join(PKG_ES, brand, "style.js");
    const srcHook = path.join(PKG_ES, "hooks", "useFillId.js");

    const tmpComp = path.join(TMP, "es", brand, "components", `${kind}.js`);
    const tmpStyle = path.join(TMP, "es", brand, "style.js");
    const tmpHook = path.join(TMP, "es", "hooks", "useFillId.js");
    mkdirSync(path.dirname(tmpComp), { recursive: true });
    mkdirSync(path.dirname(tmpHook), { recursive: true });
    writeFileSync(
      tmpComp,
      toCjs(readFileSync(srcComp, "utf8")),
    );
    writeFileSync(
      tmpStyle,
      toCjs(readFileSync(srcStyle, "utf8")) + "\nmodule.exports = { TITLE };\n",
    );
    writeFileSync(
      tmpHook,
      toCjs(readFileSync(srcHook, "utf8")) +
        "\nmodule.exports = { useFillId, useFillIds };\n",
    );

    const mod = await import(`${pathToFileURL(tmpComp).href}?${brand}-${kind}`);
    const Icon = mod.default;
    const html = renderToStaticMarkup(createElement(Icon, { size: 16 }));

    const svg = html.match(/^<svg([^>]*)>([\s\S]*)<\/svg>$/);
    if (!svg) throw new Error(`No svg in ${brand}/${kind}`);
    const svgAttrs = svgAttrsToJsx(svg[1], brand);
    if (svgAttrs.viewBox && svgAttrs.viewBox !== "0 0 24 24") {
      throw new Error(`${brand}/${kind}: unexpected viewBox ${svgAttrs.viewBox}`);
    }
    delete svgAttrs.viewBox; // the factory hardcodes the viewBox
    // The factory component renders its own <title>; drop the one baked into
    // the extracted children to avoid duplicates in the DOM.
    let children = svg[2].replace(/<title>[^<]*<\/title>/, "");
    // Namespace gradient def ids + their url() references (unique per brand).
    for (const id of [...children.matchAll(/id="([^"]+)"/g)].map((m) => m[1])) {
      const renamed = ns(id, brand);
      children = children.split(`id="${id}"`).join(`id="${renamed}"`);
      children = children.split(`url(#${id})`).join(`url(#${renamed})`);
    }

    const opts = [];
    for (const [k, v] of Object.entries(svgAttrs)) {
      opts.push(`${k}: ${JSON.stringify(v)}`);
    }
    blocks.push(
      `export const ${brand}${kind}Icon = createProviderIcon(\n` +
        `  ${JSON.stringify(brand)},\n` +
        `  { ${opts.join(", ")} },\n` +
        `  <>${children}</>,\n` +
        `);\n`,
    );
  }

  const out = `// GENERATED FILE — do not edit by hand.
// Provider logos vendored from @lobehub/icons (see scripts/extract-provider-icons.mjs).
// @lobehub/icons peer-requires @lobehub/ui + antd, which npm auto-installs in
// consumer trees and drags in @emoji-mart/react (peer react<=18), producing
// ERESOLVE warnings under react 19. Vendoring the ~30 SVGs used by
// components/ProviderIcon.tsx lets pi-web drop that dependency.
import { memo } from "react";
import type { CSSProperties, ReactNode } from "react";

export type ProviderIconProps = {
  size?: number | string;
  style?: CSSProperties;
};

function createProviderIcon(
  title: string,
  opts: { fill?: string; fillRule?: "inherit" | "evenodd" | "nonzero" },
  children: ReactNode,
) {
  const Icon = ({ size = 16, style }: ProviderIconProps) => (
    <svg
      fill={opts.fill}
      fillRule={opts.fillRule}
      height={size}
      style={{ flex: "none", lineHeight: 1, ...style }}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      {children}
    </svg>
  );
  Icon.displayName = \`\${title}Icon\`;
  return memo(Icon);
}

${blocks.join("\n")}
`;

  writeFileSync(OUT, out);
  rmSync(TMP, { recursive: true, force: true });
  console.log(`Wrote ${OUT} (${blocks.length} icons)`);
}

await main();
