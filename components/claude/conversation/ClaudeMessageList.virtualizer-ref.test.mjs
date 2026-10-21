import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * D1 + S1 — the Claude transcript list must hand its virtualizer to the
 * caller, and it must place rows in the same coordinate space as the pi list.
 *
 * D1: ChatWindow reads layout out of `messageVirtualizerRef` to build the
 * minimap adapter (components/ChatWindow.tsx:439-450) and ChatMinimap bails at
 * `totalHeight() <= 0` (components/ChatMinimap.tsx:210). `ClaudeMessageList`
 * declared the prop but never destructured it, so under the claude kit the ref
 * stayed null, every adapter query answered 0, and the minimap drew nothing —
 * switching kits silently switched off the navigation landmarks.
 *
 * S1: the header is a preceding SIBLING inside the scroll container
 * (ChatWindow.tsx:893). The pi list tells the virtualizer about it with
 * `scrollMargin` (VirtualizedMessageList.tsx:70); the claude list instead added
 * paddingTop AND a +headerHeight container height, counting the header twice,
 * so every row sat headerHeight below where the virtualizer thought it was and
 * `getOffsetForIndex` — what a minimap click scrolls to — was off by the same
 * amount. Fixing D1 without S1 makes the misplacement reachable.
 *
 * These are render-layer assertions, not source-shape assertions: a
 * render-phase write, a StrictMode double-invoke, and a cleanup that nulls the
 * wrong instance all read the same and differ only once effects run. So this
 * file boots React for real, on a DOM minimal enough to commit and nothing
 * more — no layout, no CSS, no ResizeObserver callbacks, no bubbling. Elements
 * carry exactly the box numbers TanStack Virtual reads. If a second suite ever
 * wants "a DOM", the right move is a real one (jsdom/happy-dom) as a
 * devDependency, not growing this file.
 *
 * ORDER IS PART OF THE TEST: installStubDom() must run BEFORE react-dom/client
 * is imported — that entry sniffs `typeof document` at module scope to choose
 * the isomorphic layout effect, and importing it first silently disables every
 * effect in the tree (which would make these assertions vacuously pass).
 */

class StubNode {
  constructor(nodeType) {
    this.nodeType = nodeType;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.style = {};
    this.listeners = new Map();
    this.isConnected = false;
  }

  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get nextSibling() {
    const parent = this.parentNode;
    if (!parent) return null;
    return parent.childNodes[parent.childNodes.indexOf(this) + 1] ?? null;
  }
  get textContent() { return this.childNodes.map((child) => child.textContent ?? "").join(""); }
  set textContent(value) {
    this.childNodes = [];
    if (value !== "") this.appendChild(new StubText(String(value)));
  }

  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, reference) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    node.isConnected = this.isConnected;
    const at = reference ? this.childNodes.indexOf(reference) : -1;
    if (at < 0) this.childNodes.push(node);
    else this.childNodes.splice(at, 0, node);
    return node;
  }
  removeChild(node) {
    const at = this.childNodes.indexOf(node);
    if (at >= 0) this.childNodes.splice(at, 1);
    node.parentNode = null;
    return node;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  dispatchEvent(event) {
    for (const handler of this.listeners.get(event.type) ?? []) handler(event);
    return true;
  }

  contains(node) {
    for (let current = node; current; current = current.parentNode) {
      if (current === this) return true;
    }
    return false;
  }
  getRootNode() {
    // Recursive rather than a `let cursor = this` walk: aliasing `this` to a
    // local is an eslint error here, and the walk is two levels in practice.
    const rootOf = (node) => (node.parentNode ? rootOf(node.parentNode) : node);
    return rootOf(this);
  }

  getBoundingClientRect() {
    return {
      top: 0, left: 0,
      width: this.offsetWidth ?? 0, height: this.offsetHeight ?? 0,
      bottom: this.offsetHeight ?? 0, right: this.offsetWidth ?? 0,
      x: 0, y: 0,
    };
  }
  getClientRects() { return [this.getBoundingClientRect()]; }
  matches() { return false; }
  closest() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() {}
  blur() {}
}

class StubElement extends StubNode {
  constructor(tag, ownerDocument) {
    super(1);
    this.tagName = tag.toUpperCase();
    this.nodeName = this.tagName;
    this.namespaceURI = "http://www.w3.org/1999/xhtml";
    this.ownerDocument = ownerDocument ?? null;
    // Box numbers, so nothing divides by an undefined height (React warns on
    // NaN styles). offsetHeight is the ROW default: TanStack's default
    // measureElement reads it when no ResizeObserver entry arrives, and 120
    // matches estimateSize so both kits measure identically. The scroll
    // container overrides it to its viewport height.
    this.offsetWidth = 900;
    this.offsetHeight = 120;
    this.clientWidth = 900;
    this.clientHeight = 600;
    this.scrollWidth = 900;
    this.scrollHeight = 5000;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.scrollTo = () => {};
  }
}

class StubText extends StubNode {
  constructor(data) { super(3); this.data = data; this.nodeName = "#text"; }
  get textContent() { return this.data; }
  set textContent(value) { this.data = String(value); }
}

class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function installStubDom() {
  const restored = new Map();
  const define = (name, value) => {
    if (!restored.has(name)) restored.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };

  const documentElement = new StubElement("html", null);
  const window = {
    document: null,
    ResizeObserver: StubResizeObserver,
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
    setInterval: (...args) => setInterval(...args),
    clearInterval: (...args) => clearInterval(...args),
    requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    addEventListener() {},
    removeEventListener() {},
    getComputedStyle: () => ({}),
    innerWidth: 1440,
    innerHeight: 900,
    scrollX: 0,
    scrollY: 0,
    performance,
    // React reads these off the container's defaultView, not off globalThis.
    HTMLIFrameElement: class extends StubElement {},
    HTMLInputElement: class extends StubElement {},
    HTMLTextAreaElement: class extends StubElement {},
    HTMLSelectElement: class extends StubElement {},
  };

  const document = {
    nodeType: 9,
    documentElement,
    defaultView: window,
    ownerDocument: null,
    visibilityState: "visible",
    activeElement: documentElement,
    fullscreenElement: null,
    createElement: (tag) => new StubElement(tag, document),
    createElementNS: (_namespace, tag) => new StubElement(tag, document),
    createTextNode: (data) => new StubText(data),
    createComment: (data) => Object.assign(new StubNode(8), { nodeName: "#comment", data }),
    createDocumentFragment: () => new StubNode(11),
    contains: (node) => documentElement.contains(node),
    addEventListener() {},
    removeEventListener() {},
    getSelection: () => null,
  };
  documentElement.ownerDocument = document;
  window.document = document;

  define("window", window);
  define("document", document);
  define("navigator", { userAgent: "node", platform: "linux", maxTouchPoints: 0 });
  define("HTMLElement", StubElement);
  define("Element", StubElement);
  define("Node", StubNode);
  define("Text", StubText);
  define("DocumentFragment", StubNode);
  define("ResizeObserver", StubResizeObserver);
  define("MutationObserver", class { observe() {} disconnect() {} takeRecords() { return []; } });
  define("requestAnimationFrame", window.requestAnimationFrame);
  define("cancelAnimationFrame", window.cancelAnimationFrame);
  define("getComputedStyle", window.getComputedStyle);
  // React.act() refuses to run without this flag.
  define("IS_REACT_ACT_ENVIRONMENT", true);

  return () => {
    for (const [name, descriptor] of restored) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}

/** A scroll container that reports a fixed viewport and content height. */
function makeScrollElement({ clientHeight = 600, scrollHeight = 5000, scrollTop = 0 } = {}) {
  // ownerDocument matters: Virtualizer._willUpdate() resolves targetWindow
  // through scrollElement.ownerDocument.defaultView and throws on null.
  const element = new StubElement("div", globalThis.document ?? null);
  element.offsetHeight = clientHeight;
  element.clientHeight = clientHeight;
  element.scrollHeight = scrollHeight;
  element.scrollTop = scrollTop;
  element.isConnected = true;
  return element;
}

/** A mounted host element, attached to the stub document so React can commit. */
function makeHost() {
  const host = globalThis.document.createElement("div");
  host.isConnected = true;
  globalThis.document.documentElement.appendChild(host);
  return host;
}

/**
 * ChatWindow's minimap adapter (components/ChatWindow.tsx:439-450), rebuilt
 * from a virtualizer ref. Duplicated because ChatWindow is a 3.4k-line client
 * component with server-side dependencies this harness cannot import — the
 * last test below pins the real source so the duplication cannot go stale.
 */
function buildMinimapAdapter(virtualizerRef) {
  return {
    getOffsetForIndex: (itemIndex) => virtualizerRef.current?.getOffsetForIndex(itemIndex)?.[0] ?? 0,
    sizeFor: (itemIndex) => {
      const v = virtualizerRef.current;
      if (!v) return 0;
      const cached = v.measurementsCache[itemIndex];
      return cached?.size ?? v.options.estimateSize?.(itemIndex) ?? 0;
    },
    totalHeight: () => virtualizerRef.current?.getTotalSize() ?? 0,
  };
}

installStubDom();

const { createJiti } = await import("jiti");
const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const React = await jiti.import("react");
const { createRoot } = await jiti.import("react-dom/client");
const act = React.act;
const { ClaudeMessageList, publishVirtualizer } = await jiti.import("./ClaudeMessageList.tsx");
const { VirtualizedMessageList } = await jiti.import("../../VirtualizedMessageList.tsx");
const { ChatMinimap } = await jiti.import("../../ChatMinimap.tsx");

const ROW_COUNT = 12;
const HEADER = 40;

function makeProps(virtualizerRef, headerHeight = HEADER) {
  const scrollElement = makeScrollElement();
  return {
    scrollElementRef: { current: scrollElement },
    scrollElement,
    items: Array.from({ length: ROW_COUNT }, (_unused, index) =>
      React.createElement("div", null, "row " + index)),
    itemKeys: Array.from({ length: ROW_COUNT }, (_unused, index) => "k" + index),
    virtualizerRef,
    headerHeight,
  };
}

async function mountList(Component, props) {
  const host = makeHost();
  const root = createRoot(host);
  await act(async () => { root.render(React.createElement(Component, props)); });
  return { host, root };
}

/** Depth-first search for the stable hook ChatMinimap puts on its markers. */
function minimapMarkers(host) {
  const found = [];
  const walk = (node) => {
    for (const child of node.childNodes ?? []) {
      if (child.attributes?.has?.("data-minimap-node-index")) {
        found.push(child.getAttribute("data-minimap-node-index"));
      }
      walk(child);
    }
  };
  walk(host);
  return found;
}

function rowNode(host, index) {
  let found = null;
  const walk = (node) => {
    if (!found && node.attributes?.get?.("data-index") === String(index)) found = node;
    for (const child of node.childNodes ?? []) walk(child);
  };
  walk(host);
  return found;
}

/**
 * Where a row actually sits inside the scroll container: the header sibling
 * (a real flow-space block of headerHeight above the list) plus the row's
 * offset within the list box (its padding-box top plus translateY).
 */
function documentOffset(host, index, headerHeight) {
  const node = rowNode(host, index);
  if (!node) return NaN;
  const translateY = Number(String(node.style.transform ?? "").match(/translateY\(([-\d.]+)px\)/)?.[1] ?? NaN);
  const wrapperPaddingTop = Number(String(node.parentNode?.style?.paddingTop ?? "").replace("px", "") || "0");
  return headerHeight + wrapperPaddingTop + translateY;
}
test("publishes the virtualizer so ChatWindow's minimap adapter reports a real height", async () => {
  const virtualizerRef = { current: null };
  const props = makeProps(virtualizerRef);
  const { root } = await mountList(ClaudeMessageList, props);

  assert.notEqual(virtualizerRef.current, null, "the ref must hold the list's virtualizer after mount");
  const adapter = buildMinimapAdapter(virtualizerRef);
  // The exact predicate ChatMinimap.tsx:210 uses to decide whether to draw
  // anything: 0 means "no landmarks", which is what the claude kit hit.
  assert.ok(adapter.totalHeight() > 0, "totalHeight() must be > 0, got " + adapter.totalHeight());
  for (const index of [0, 3, ROW_COUNT - 1]) {
    assert.ok(adapter.sizeFor(index) > 0, "sizeFor(" + index + ") must be > 0");
  }
  const offsets = Array.from({ length: ROW_COUNT }, (_unused, index) => adapter.getOffsetForIndex(index));
  assert.ok(offsets.every((value) => typeof value === "number"), "offsets must resolve to numbers");
  await act(async () => root.unmount());
});

test("survives StrictMode's simulated unmount and still leaves the ref published", async () => {
  const virtualizerRef = { current: null };
  const props = makeProps(virtualizerRef);
  const host = makeHost();
  const root = createRoot(host);
  const tree = React.createElement(React.StrictMode, null, React.createElement(ClaudeMessageList, props));
  await act(async () => { root.render(tree); });

  // React 19 dev tears every effect down and re-runs it after mount. A
  // render-phase publish has nothing to re-run after that teardown, so the ref
  // would end up null exactly when the minimap asks.
  assert.notEqual(virtualizerRef.current, null, "StrictMode must not leave the ref null");
  const first = virtualizerRef.current;
  await act(async () => { root.render(tree); });
  assert.equal(virtualizerRef.current, first, "re-publishing is idempotent: same instance, not a new one");
  await act(async () => root.unmount());
  assert.equal(virtualizerRef.current, null, "unmount must not leave an expired instance behind");
});

test("publishes during the commit, before a sibling can measure", async () => {
  // ChatMinimap is a sibling mounted AFTER the list (ChatWindow.tsx:1421) and
  // its first measure runs in a layout effect. With a passive effect the ref
  // would still be null at that point and landmarks would stay missing until
  // the next scroll or resize — a gap the pi list does not have because it
  // writes the ref during render.
  const virtualizerRef = { current: null };
  const props = makeProps(virtualizerRef);
  const seen = [];
  function Sibling() {
    React.useLayoutEffect(() => { seen.push(virtualizerRef.current); }, []);
    return React.createElement("div", null, "probe");
  }
  const host = makeHost();
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(React.Fragment, null,
      React.createElement(ClaudeMessageList, props),
      React.createElement(Sibling),
    ));
  });
  assert.equal(seen.length, 1, "the sibling layout effect ran");
  assert.notEqual(seen[0], null, "the ref must be published before a later sibling measures");
  assert.equal(seen[0], virtualizerRef.current, "and it must be the live instance");
  await act(async () => root.unmount());
});

test("publishVirtualizer only clears the slot while it still holds its own instance", () => {
  const target = { current: null };
  const outgoing = { id: "outgoing" };
  const incoming = { id: "incoming" };

  const undoOutgoing = publishVirtualizer(target, outgoing);
  assert.equal(target.current, outgoing);
  // A kit swap commits the incoming list before the outgoing one unmounts, so
  // the outgoing teardown must not null what the incoming list just published.
  publishVirtualizer(target, incoming);
  undoOutgoing();
  assert.equal(target.current, incoming, "a stale teardown must not clobber the new instance");

  const undoIncoming = publishVirtualizer(target, incoming);
  undoIncoming();
  assert.equal(target.current, null, "the owning teardown does clear the slot");

  // No ref passed (the prop is optional): nothing to publish, and the teardown
  // the component still registers has to be safe to call.
  const undoNoTarget = publishVirtualizer(undefined, outgoing);
  assert.equal(typeof undoNoTarget, "function");
  assert.doesNotThrow(() => undoNoTarget());
});

test("row placement and adapter offsets match the pi list when headerHeight > 0", async () => {
  const runs = [];
  for (const [Component, label] of [[VirtualizedMessageList, "pi"], [ClaudeMessageList, "claude"]]) {
    const virtualizerRef = { current: null };
    const props = makeProps(virtualizerRef);
    const { host, root } = await mountList(Component, props);
    const adapter = buildMinimapAdapter(virtualizerRef);
    runs.push({
      label,
      root,
      virtualizer: virtualizerRef.current,
      offsets: Array.from({ length: ROW_COUNT }, (_unused, index) => adapter.getOffsetForIndex(index)),
      totalHeight: adapter.totalHeight(),
      // Where each row really is, read off the committed DOM.
      placed: Array.from({ length: ROW_COUNT }, (_unused, index) => documentOffset(host, index, HEADER)),
    });
  }
  const [pi, claude] = runs;

  assert.ok(pi.totalHeight > 0, "pi total height must be positive");
  assert.equal(claude.totalHeight, pi.totalHeight, "claude must report the same total height as pi");
  assert.deepEqual(claude.placed, pi.placed, "claude rows must land exactly where pi rows land");
  assert.deepEqual(claude.offsets, pi.offsets, "adapter offsets must match row for row");

  // align:"start" is the raw scroll-container coordinate of a row and must
  // equal where the DOM actually put it — the assertion that proves the header
  // is counted once, not twice (pre-fix claude: offset 40 vs placement 80).
  for (const run of runs) {
    const startAligned = run.virtualizer.getOffsetForIndex(0, "start")[0];
    assert.equal(startAligned, run.placed[0], run.label + ": align-start offset must equal real placement");
    assert.equal(startAligned, HEADER, run.label + ": the first row starts below the header, not at 0 or 2*HEADER");
  }

  // scrollToIndex must target the same scroll position in both kits: this is
  // what a minimap click does (ChatWindow.tsx:440 feeds getOffsetForIndex).
  const targets = runs.map((run) => {
    const writes = [];
    const element = run.virtualizer.scrollElement;
    const original = element.scrollTo;
    element.scrollTo = (options) => { writes.push(options.top); element.scrollTop = options.top; };
    run.virtualizer.scrollToIndex(5, { align: "start" });
    element.scrollTo = original;
    return writes[0];
  });
  assert.ok(Number.isFinite(targets[0]), "the pi scroll target must be a number");
  assert.equal(targets[1], targets[0], "scrollToIndex(5) must land on the same scrollTop in both kits");

  for (const run of runs) await act(async () => run.root.unmount());
});

test("placement is unaffected when headerHeight is 0", async () => {
  // The header is usually absent; the fix must not shift anything then.
  const virtualizerRef = { current: null };
  const props = makeProps(virtualizerRef, 0);
  const { host, root } = await mountList(ClaudeMessageList, props);
  assert.equal(documentOffset(host, 0, 0), 0, "first row at the top with no header");
  // The adapter flattens to a number; the raw virtualizer answers "start".
  assert.equal(buildMinimapAdapter(virtualizerRef).getOffsetForIndex(0), 0);
  assert.equal(virtualizerRef.current.getOffsetForIndex(0, "start")[0], 0);
  await act(async () => root.unmount());
});

test("the whole chain renders minimap landmarks under the claude kit", async () => {
  const virtualizerRef = { current: null };
  const props = makeProps(virtualizerRef);
  const { root: listRoot } = await mountList(ClaudeMessageList, props);

  const adapter = {
    ...buildMinimapAdapter(virtualizerRef),
    // ChatWindow maps each visible message ref onto one rendered item; here
    // every row is one message, so the map is the identity.
    refToItemIndex: (refIndex) => refIndex,
    itemCount: ROW_COUNT,
  };
  const messages = Array.from({ length: ROW_COUNT }, (_unused, index) => index % 2 === 0
    ? { role: "user", content: "question " + index }
    : { role: "assistant", content: [{ type: "text", text: "answer " + index }] });

  const host = makeHost();
  const minimapRoot = createRoot(host);
  await act(async () => {
    minimapRoot.render(React.createElement(ChatMinimap, {
      messages,
      streamingMessage: null,
      scrollContainer: { current: props.scrollElement },
      messageRefs: { current: [] },
      virtualizer: adapter,
    }));
  });
  // measureNodes() is throttled to one pass per 150ms.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });

  const markers = minimapMarkers(host);
  assert.ok(markers.length > 0, "the minimap must draw landmarks, not return null");
  assert.equal(markers.length, ROW_COUNT, "one landmark per message with minimap content");

  await act(async () => minimapRoot.unmount());
  await act(async () => listRoot.unmount());
});

test("ChatWindow still builds the adapter this test rebuilds", async () => {
  const chatWindow = await readFile(new URL("../../ChatWindow.tsx", import.meta.url), "utf8");
  const pinned = [
    "totalHeight: () => messageVirtualizerRef.current?.getTotalSize() ?? 0,",
    "getOffsetForIndex: (itemIndex: number) => messageVirtualizerRef.current?.getOffsetForIndex(itemIndex)?.[0] ?? 0,",
    "virtualizerRef={messageVirtualizerRef}",
  ];
  for (const line of pinned) {
    assert.ok(chatWindow.includes(line), "ChatWindow no longer contains: " + line);
  }
  // ChatMinimap's early exit is the failure mode this fix is about.
  const minimap = await readFile(new URL("../../ChatMinimap.tsx", import.meta.url), "utf8");
  assert.ok(minimap.includes("if (v.totalHeight() <= 0) return;"), "ChatMinimap still gates on totalHeight()");
});
