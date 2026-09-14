import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { VirtualizedMessageList } from "../components/VirtualizedMessageList";
import { MarkdownBody } from "../components/MarkdownBody";
import { I18nContext } from "../hooks/useI18n";

function MessageRow({ id, large, streaming }: { id: number; large: boolean; streaming: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const text = `### 消息 ${id}\n\n` + "用于检查行高的正文，宽度变化时应重新换行，不应覆盖下一条。".repeat(large ? 28 : 2)
    + (expanded ? "\n\n展开后的详细内容。".repeat(40) : "");
  return <article className={`chat-assistant-message${streaming ? " is-streaming" : ""}`}>
    <button onClick={() => setExpanded((value) => !value)}>{expanded ? "收起" : "展开"}消息 {id}</button>
    <MarkdownBody isStreaming={streaming}>{text}</MarkdownBody>
  </article>;
}

function Fixture() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [ids, setIds] = useState(() => Array.from({ length: 100 }, (_, index) => index));
  const [large, setLarge] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [result, setResult] = useState("尚未检查");
  const inspect = () => {
    const nodes = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>("[data-index]") ?? []);
    const overlaps: string[] = [];
    const rows = nodes.map((node) => ({ index: node.dataset.index, rect: node.getBoundingClientRect() }));
    for (let index = 1; index < rows.length; index++) {
      const overlap = rows[index - 1].rect.bottom - rows[index].rect.top;
      if (overlap > 1) overlaps.push(`${rows[index - 1].index}/${rows[index].index}: ${overlap.toFixed(1)}px`);
    }
    const container = scrollRef.current?.firstElementChild?.nextElementSibling?.getBoundingClientRect();
    const firstRow = rows.find((row) => row.index === "0");
    const headerOffset = firstRow && container ? firstRow.rect.top - container.top : null;
    setResult(JSON.stringify({ mounted: rows.length, overlaps, headerOffset, width: scrollRef.current?.clientWidth }));
  };
  const scrollTo = (position: "top" | "middle" | "bottom") => {
    const node = scrollRef.current;
    if (node) node.scrollTop = position === "top" ? 0 : position === "middle" ? node.scrollHeight / 2 : node.scrollHeight;
  };
  return <I18nContext.Provider value={{ locale: "zh-CN", setLocale: () => {}, supportedLocales: [], t: (key) => key }}>
    <h1>聊天虚拟列表回归夹具</h1>
    <div className="controls">
      <button onClick={() => setLarge((value) => !value)}>切换正文长度</button>
      <button onClick={() => setStreaming((value) => !value)}>切换流式状态</button>
      <button onClick={() => setNarrow((value) => !value)}>切换列宽</button>
      <button onClick={() => setHeaderHeight((value) => value ? 0 : 96)}>切换顶部组件</button>
      <button onClick={() => setIds((current) => Array.from({ length: 30 }, (_, index) => current[0] - 30 + index).concat(current))}>加载更早消息</button>
      <button onClick={() => scrollTo("top")}>滚动到顶部</button>
      <button onClick={() => scrollTo("middle")}>滚动到中间</button>
      <button onClick={() => scrollTo("bottom")}>滚动到底部</button>
      <button onClick={inspect}>检查布局</button>
    </div>
    <output aria-label="布局检查结果">{result}</output>
    <section aria-label="聊天消息列表" ref={scrollRef} className="fixture-scroll" style={{ width: narrow ? 350 : 900 }}>
      <div style={{ height: headerHeight, background: "#dce7ef" }}>{headerHeight > 0 ? "顶部扩展组件" : null}</div>
      <VirtualizedMessageList scrollElementRef={scrollRef} headerHeight={headerHeight}
        itemKeys={ids.map((id) => `message-${id}`)}
        items={ids.map((id) => <MessageRow key={id} id={id} large={large} streaming={streaming} />)} />
    </section>
  </I18nContext.Provider>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
