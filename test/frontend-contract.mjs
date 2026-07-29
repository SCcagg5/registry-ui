import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = join(root, "src", "public");
const index = readFileSync(join(publicRoot, "index.html"), "utf8");
const app = readFileSync(join(publicRoot, "assets", "js", "app.js"), "utf8");
const api = readFileSync(join(publicRoot, "assets", "js", "api.js"), "utf8");
const iconsCSS = readFileSync(join(publicRoot, "assets", "css", "icons.css"), "utf8");
const style = readFileSync(join(publicRoot, "assets", "css", "style.css"), "utf8");
const backend = readFileSync(join(root, "src", "main.go"), "utf8");

for (const stylesheet of ["icons.css", "tokens.css", "base.css", "style.css", "ui.css"]) {
  assert.match(index, new RegExp(`assets/css/${stylesheet.replace(".", "\\.")}`));
}

for (const id of [
  "versionBadge",
  "viewHeader",
  "backBtn",
  "viewTitle",
  "viewMeta",
  "searchField",
  "searchInput",
  "tagToolbarActions",
  "content",
  "toast",
  "confirmOverlay"
]) {
  assert.match(index, new RegExp(`id="${id}"`), `missing #${id}`);
}

assert.match(api, /new URL\("\.\.\/\.\.\/", script\.src\)/, "API base must remain relative to its script");
assert.doesNotMatch(app, /testMode|built-in demo/i, "frontend must use the configured registry in every environment");
assert.match(index, /<main class="container main">/, "legacy Registry UI main layout must be preserved");
assert.doesNotMatch(index, /class="panel toolbar"/, "the obsolete toolbar panel must be removed");
assert.match(index, /<section id="viewHeader" class="view-header hidden"/, "non-root views need a borderless contextual header");
assert.match(index, /<section id="content" class="panel content"/, "legacy Registry UI content panel must be preserved");
assert.match(index, /class="container head"[\s\S]*id="searchField"[\s\S]*id="searchInput"/, "repository and tag search must live in the main header");
assert.doesNotMatch(index, /mdi-magnify|class="field-label"/, "list search must not show a label or magnifier");
assert.match(index, /<a class="brand" href="#\/" aria-label="Registry UI home">/, "the icon and title must link to the hash root without an absolute path");
assert.doesNotMatch(index, /Container image\s+browser/i, "the obsolete brand subtitle must be removed everywhere");
assert.doesNotMatch(index, /rel="preload"/, "CSS mask icons must not be preloaded as credential-mismatched images");
assert.match(app, /viewHeader\.classList\.toggle\("hidden", isRepositories\)/, "the contextual view header must disappear on root navigation");
assert.match(app, /const isSearchableList = isRepositories \|\| isTags;/, "repository and tag lists must both be searchable");
assert.match(app, /searchField\.classList\.toggle\("hidden", !isSearchableList\)/, "search must be hidden only outside list navigation");
assert.match(app, /searchInput\.placeholder = isTags \? "Tag" : "Image or namespace"/, "tag navigation needs its own search prompt");
assert.doesNotMatch(index, /id="rootBtn"|id="breadcrumbLine"|storage-switcher/, "S3 Browser navigation must not replace Registry UI navigation");
assert.match(index, /mdi-cube-outline/, "Registry UI must use its own container-image identity");
assert.ok(index.indexOf('id="versionBadge"') < index.indexOf('class="container head"'), "release tag must be placed above the main header row");
assert.doesNotMatch(app, /function renderBreadcrumbs\(/, "frontend must not introduce S3 Browser breadcrumbs");
assert.match(app, /function footer\(/, "legacy Registry UI footer controls must be preserved");
assert.match(app, /table-navigation[\s\S]*<div class="table-wrap">/, "repository navigation must precede the table");
assert.match(app, /"repositories",[\s\S]*"table-navigation"/, "repository page-size control must identify repositories");
assert.match(app, /state\.tagsCursor,[\s\S]*"tags-more",[\s\S]*"tags",[\s\S]*"table-navigation"[\s\S]*<div class="table-wrap">/, "tag count and page-size navigation must precede the tags table");
assert.match(app, /incoming\.length === 1 && !state\.tagsCursor/, "a repository with one tag must bypass the tags page");
assert.match(app, /data-action="select-platform"/, "multi-platform details need an in-page platform selector");
assert.match(app, /selectedImageIndex/, "platform selection must remain local frontend state");
assert.doesNotMatch(app, /\.map\(renderImageDetail\)/, "only one platform detail may be rendered at a time");
assert.match(app, /renderTagToolbar\(detail\)/, "tag size and digest must be rendered below the toolbar title");
assert.match(app, /tagToolbarActions\.innerHTML/, "download and delete actions must live in the tag toolbar");
assert.match(app, />Download OCI</, "the toolbar must name the OCI archive explicitly");
assert.match(api, /function dockerDownloadURL\(/, "the selected platform needs a Docker archive endpoint");
assert.match(app, /class="btn small docker-download"/, "the Docker download must sit below the media-type badge");
assert.match(backend, /writeDockerArchive/, "the backend must produce a Docker image archive");
assert.match(backend, /"manifest\.json"/, "the Docker image archive must include its load manifest");
assert.match(backend, /mux\.Handle\("\/api\/download\/docker"/, "the Docker archive route must be registered");
assert.match(app, /<span>Size<\/span>/, "the toolbar size label must be concise");
assert.doesNotMatch(app, /Cumulative size/, "the old cumulative-size label must be removed");
assert.doesNotMatch(app, /summary-card|summary-grid|summaryItem\(/, "the old tag summary grids must be removed");
assert.match(app, /formatBytesText\(image\.size\)/, "architecture buttons must expose each image size");
assert.match(app, /platform-button-author/, "architecture buttons must expose the author");
assert.match(app, /platform-button-date/, "architecture buttons must expose the creation date");
assert.match(app, /class="image-title-row"[\s\S]*<h3>[\s\S]*class="badge"/, "the media-type badge must sit next to the selected platform name");
assert.doesNotMatch(app, /Choose one image to inspect|platform-selector-copy/, "platform helper copy must be removed");
assert.match(app, /Total image content across distinct tag digests and every platform/, "repository size must describe its complete scope");
assert.match(app, /class="runtime-label-grid"/, "runtime settings and labels must share a one-third/two-thirds row");
assert.match(app, /function renderNumberedValues\(/, "environment and build args need numbered source views");
assert.ok(app.indexOf("<h4>Build args</h4>") < app.indexOf("<h4>Environment</h4>"), "build args must precede environment");
assert.match(app, /<h4>Exposed<\/h4>[\s\S]*renderExposedPorts\(image\.exposedPorts\)/, "exposed ports need a dedicated compact column");
assert.match(app, /function highlightConfigAssignment\(/, "environment and build args must be syntax colored");
assert.doesNotMatch(app, /OCI content|renderSizeBreakdown|oci-strip/, "the standalone OCI content section must be removed");
assert.match(app, /function renderDockerHistoryEditor\(/, "Dockerfile and image history must be merged");
assert.match(app, /function renderInstructionMetadata\(/, "each instruction needs structured size and date metadata");
assert.match(app, /history-meta-total/, "the first Dockerfile metadata column must show cumulative size");
assert.match(app, /history-meta-change/, "Dockerfile metadata needs a separate signed size-change column");
assert.match(app, /history-meta-header/, "Dockerfile size and date columns need a heading");
assert.match(app, /<h4>Dockerfile<\/h4>/, "the merged section title must be Dockerfile");
assert.doesNotMatch(app, /section-note|Instructions remain in OCI order/, "the explanatory paragraph below Dockerfile must be removed");
assert.doesNotMatch(app, /class="docker-history-head"/, "the history view must not restore the old table-style heading");
assert.doesNotMatch(app, /<d[dt]>/, "history size and date must not use definition-table labels");
assert.doesNotMatch(app, />Inferred</, "FROM must not be presented with a misleading inferred-size badge");
assert.match(app, /data-action="copy-dockerfile"/, "the reconstructed Dockerfile needs a clean copy action");
assert.match(app, /function buildDockerfileLines\(/, "Dockerfile formatting must be isolated from history metadata");
assert.doesNotMatch(app, /dockerLineMeta|class="docker-meta"/, "dates and sizes must not be mixed into selectable Dockerfile code");
assert.match(style, /\.docker-source-ln[\s\S]*user-select:\s*none;/, "Dockerfile line numbers must not be copied with source");
assert.match(style, /\.history-meta[\s\S]*user-select:\s*none;/, "history metadata must not be copied with Dockerfile code");
assert.match(app, /class="docker-source-pane"[\s\S]*class="docker-history-meta-pane"/, "source and fixed metadata must render as sibling panes");
assert.doesNotMatch(app, /class="docker-history-grid"/, "the metadata must not live inside the horizontally scrolling source grid");
assert.match(style, /\.docker-history-body\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*var\(--history-meta-width\);[\s\S]*overflow:\s*hidden;/, "the Dockerfile body must keep metadata outside horizontal overflow");
assert.match(style, /--history-columns:\s*4\.75rem 5\.25rem 9\.25rem;/, "Dockerfile headings and values must share fixed compact column widths");
assert.match(style, /\.history-meta-total,[\s\S]*text-align:\s*right;/, "Dockerfile size units must align at the right edge");
assert.match(style, /\.history-meta\s*\{[\s\S]*align-self:\s*start;/, "layer size and date must stay on the first visual source line");
assert.match(style, /\.docker-source-pane\s*\{[\s\S]*overflow-x:\s*auto;[\s\S]*overflow-y:\s*hidden;/, "horizontal scrolling must belong to the source pane only");
assert.match(style, /\.docker-history-meta-pane\s*\{[\s\S]*overflow:\s*hidden;[\s\S]*border-left:\s*1px solid #d8dee4;/, "fixed metadata needs one continuous divider");
assert.match(style, /\.docker-history-body\s*\{[\s\S]*border-radius:\s*8px;/, "the Dockerfile body must retain rounded lower corners");
assert.doesNotMatch(app, /docker-source-header/, "column headings must not reserve a blank row inside the code table");
assert.match(style, /\.history-meta-slot\s*\{[\s\S]*--history-row-lines,\s*1\)/, "metadata slots must preserve the full height of multiline and empty source rows");
assert.match(style, /\.history-meta\s*\{[\s\S]*border:\s*0;/, "individual metadata rows must not draw fragmented dividers");
assert.match(style, /\.docker-source-block\s*\{[\s\S]*overflow:\s*visible;/, "individual Dockerfile instructions must not expose their own scrollbar");
assert.match(app, /class="history-meta-header-size">Size<\/span>[\s\S]*class="history-meta-header-change"[\s\S]*class="history-meta-header-date">Date<\/span>/, "Size must label the cumulative column before the change column");
assert.match(app, /class="history-meta-header"[\s\S]*class="docker-history-body"/, "Size and Date headings must sit above the bordered Dockerfile body");
assert.match(style, /\.docker-source-ln\s*\{[\s\S]*position:\s*sticky;[\s\S]*left:\s*0;/, "Dockerfile line numbers must stay fixed during horizontal scrolling");
assert.match(style, /\.history-meta-total,[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*2ch;/, "history numbers and units must use stable independent columns");
assert.match(app, /amount\.toFixed\(1\)/, "every non-zero byte size must retain one decimal place");
assert.match(app, /text:\s*"0 B"/, "zero bytes must remain the sole no-decimal exception");
assert.match(style, /\.history-meta-change\.is-positive[\s\S]*#15803d/, "positive size changes must be green");
assert.match(style, /\.history-meta-change\.is-negative[\s\S]*#b42318/, "negative size changes must be red");
assert.match(app, /if \(!Number\.isFinite\(size\) \|\| size === 0\) return "";/, "zero size changes must render as an empty cell");
assert.match(style, /\.runtime-label-grid[\s\S]*minmax\(260px,\s*1fr\)[\s\S]*minmax\(0,\s*2fr\)/, "runtime and labels must use a one-third/two-thirds split");
assert.match(style, /\.config-source-grid[\s\S]*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\)\s*minmax\(7rem,\s*\.24fr\)/, "build args and environment need equal columns followed by a thin exposed-port column");
assert.match(style, /\.kv-table[\s\S]*grid-template-columns:\s*fit-content\(52%\)\s*minmax\(0,\s*1fr\)/, "key columns must adapt to their longest visible label");
assert.match(app, /function renderTypedValue\(/, "runtime and label values need type-aware rendering");
assert.match(style, /\.typed-string,[\s\S]*\.typed-number,[\s\S]*\.typed-boolean,/, "runtime and label value types need distinct syntax colors");
assert.match(app, /class="toolbar-digest digest-row"/, "detail digests must reuse the toolbar digest layout");
assert.match(style, /\.digest-row[\s\S]*display:\s*flex;/, "detail digest rows must share a compact aligned layout");
assert.match(style, /\.digest-row > span:first-child[\s\S]*flex:\s*0 0 7\.25rem;/, "detail digest hashes must start at the same position");
assert.match(style, /\.toolbar-digest code[\s\S]*overflow-wrap:\s*anywhere;/, "image and config digests must be shown in full");
assert.match(app, /config-code-lines[\s\S]*config-code-row[\s\S]*config-line-number[\s\S]*config-line-code/, "environment and build args need numbered wrapping code rows");
assert.match(style, /\.config-source\s*\{[\s\S]*overflow:\s*hidden;/, "environment and build args must not expose a horizontal scrollbar");
assert.match(style, /\.config-line-code[\s\S]*overflow-wrap:\s*anywhere;[\s\S]*white-space:\s*pre-wrap;/, "long environment and build-arg values must wrap onto additional visual lines");
assert.match(style, /\.config-line-number[\s\S]*user-select:\s*none;/, "wrapped config line numbers must remain non-selectable");
assert.match(style, /\.version[\s\S]*left:\s*\.08rem;/, "the version badge must float at the far-left page edge");
assert.match(style, /\.back-btn[\s\S]*border:\s*0;/, "the back button must not have an outline");
assert.match(style, /\.platform-selector[\s\S]*border:\s*0;/, "the platform selector must not have a border");
assert.match(style, /#selectedPlatformDetail\s*\{\s*border:\s*0;/, "the selected platform detail must not have a border");
assert.match(style, /\.history-title-row[\s\S]*border-top:\s*0;/, "there must be no divider before Dockerfile");
assert.match(style, /\.docker-string\s*\{[^}]*color:\s*#b45309;/, "Dockerfile string literals must be orange");
assert.match(style, /\.history-meta-header[\s\S]*background:\s*transparent;[\s\S]*border:\s*0;/, "Dockerfile column headings must have no bar, background, or outline");
assert.match(style, /\.history-meta-header-size\s*\{[\s\S]*grid-column:\s*1;[\s\S]*text-align:\s*center;/, "Size must be centered above the cumulative-size column");
assert.match(style, /\.history-meta-header-date\s*\{[\s\S]*grid-column:\s*3;[\s\S]*text-align:\s*center;/, "Date must be centered above the date column");
assert.match(style, /\.docker-download\s*\{[\s\S]*position:\s*relative;[\s\S]*top:\s*0;/, "the Docker archive download button must keep its original vertical alignment");
assert.match(app, /class="btn small copy-dockerfile-btn"/, "the Dockerfile copy action needs its own positioning hook");
assert.match(style, /\.copy-dockerfile-btn\s*\{[\s\S]*position:\s*relative;[\s\S]*top:\s*\.15rem;/, "the Copy Dockerfile button must sit slightly below the Dockerfile title");
assert.match(style, /\.build-line[\s\S]*position:\s*absolute;/, "the release build line must be absolutely positioned");
assert.match(style, /\.tag-toolbar-actions \.btn \.mdi,[\s\S]*top:\s*\.1em;/, "download, delete, and Dockerfile action icons need the requested baseline correction");
assert.doesNotMatch(style, /\.summary-card|\.summary-grid|\.oci-strip/, "removed summary and OCI sections must not leave stale styles");
assert.match(app, /HEALTHCHECK \$\{options\[0\]\} \\\\/, "HEALTHCHECK options must use Dockerfile continuations");
assert.match(backend, /imageContentSizes/, "backend must expose a consistent layer/config size breakdown");
assert.match(backend, /dockerHealthcheckInstruction/, "BuildKit healthcheck history must be normalized");
assert.match(backend, /org\.opencontainers\.image\.base\.name/, "standard OCI base-image names should be used when retained");
assert.match(backend, /ManifestSize/, "manifest and index sizes must remain available in API metadata");
assert.match(backend, /for _, item := range root\.Envelope\.Manifests[\s\S]*totalSize \+= childSize/, "repository totals must include every platform image");
assert.match(style, /\.head-search input[\s\S]*font-size:\s*\.875rem;/, "search inputs must use the 14px UI text size");
assert.match(app, /class="table-date"/, "repository and tag dates need a dedicated aligned style");
assert.match(style, /\.table-date[\s\S]*font-family:\s*var\(--font-mono\);[\s\S]*font-variant-numeric:\s*tabular-nums;/, "Created and Last updated values must use monospaced tabular characters");
assert.match(style, /\.item-name,[\s\S]*font-weight:\s*400;/, "row text must use S3 Browser's normal weight");
assert.doesNotMatch(app, /<svg\b/, "frontend icons must use the shared local MDI layer");
assert.ok(!existsSync(join(root, "src", "Dockerfile")), "application Dockerfile must not live in src/");
assert.ok(existsSync(join(root, "test", "browser", "Dockerfile")), "test/browser/Dockerfile is required");

const iconNames = new Set();
for (const match of index.matchAll(/\bmdi-([a-z0-9-]+)/g)) iconNames.add(match[1]);
for (const match of app.matchAll(/icon\("([a-z0-9-]+)"/g)) iconNames.add(match[1]);
iconNames.delete("spin");

for (const name of iconNames) {
  assert.match(iconsCSS, new RegExp(`\\.mdi-${name}\\s*\\{`), `missing CSS mapping for mdi-${name}`);
}

for (const match of iconsCSS.matchAll(/url\("\.\.\/icons\/mdi\/([^"]+)"\)/g)) {
  const path = join(publicRoot, "assets", "icons", "mdi", match[1]);
  assert.ok(existsSync(path), `missing local icon ${match[1]}`);
}

for (const path of walk(publicRoot)) {
  const extension = extname(path).toLowerCase();
  if (![".html", ".css", ".js"].includes(extension)) continue;
  const source = readFileSync(path, "utf8");
  assert.doesNotMatch(source, /https?:\/\/|\/\/cdn\./, `external frontend asset in ${path}`);
}

for (const path of walk(root)) {
  assert.notEqual(extname(path).toLowerCase(), ".hcl", `unexpected HCL file ${path}`);
}

console.log(`frontend contract ok (${iconNames.size} shared icons checked)`);

function walk(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}
