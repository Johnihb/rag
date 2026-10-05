/**
 * Minimal, dependency-free Markdown renderer for chat messages.
 *
 * Design note: this builds DOM nodes directly and never assigns innerHTML.
 * Model output is untrusted input, so parsing straight into HTML would let a
 * stray <script> or an onerror= attribute execute in the page. Every literal
 * character ends up in a text node, and the only attributes we ever set are
 * href/rel/target on links that passed a protocol allow-list.
 *
 * Supported: headings, bold, italic, strikethrough, inline code, fenced and
 * indented code blocks, ordered/unordered/nested lists, blockquotes, links,
 * horizontal rules, and hard line breaks.
 */

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const MAX_LIST_DEPTH = 6;

/* ------------------------------------------------------------------ */
/* DOM helpers                                                         */
/* ------------------------------------------------------------------ */

/** Create an element, optionally with text content. */
function el(tag, text) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  return node;
}

/** Create a <br> run, used to preserve meaningful single newlines. */
function lineBreak() {
  return document.createElement("br");
}

/**
 * Append literal text, turning newlines into <br>. We rely on <br> rather than
 * white-space: pre-wrap so paragraph spacing stays under our control.
 */
function appendPlain(frag, text) {
  const parts = text.split("\n");
  parts.forEach((part, index) => {
    if (index > 0) frag.append(lineBreak());
    if (part) frag.append(document.createTextNode(part));
  });

  return frag;
}

/**
 * Build a link, but only for safe protocols. Anything else (javascript:,
 * data:, vbscript:) degrades to plain text instead of becoming clickable.
 */
function link(label, href) {
  let url;
  try {
    url = new URL(href, window.location.origin);
  } catch {
    return appendPlain(document.createDocumentFragment(), label);
  }

  if (!SAFE_PROTOCOLS.has(url.protocol)) {
    return appendPlain(document.createDocumentFragment(), label);
  }

  const anchor = el("a", label);
  anchor.href = url.href;
  // Only same-origin links open in a new tab; external ones stay put.
  if (url.origin !== window.location.origin) {
    anchor.target = "_blank";
    // noopener stops the new tab from reaching back through window.opener.
    anchor.rel = "noopener noreferrer";
  }
  return anchor;
}

/* ------------------------------------------------------------------ */
/* Inline parsing                                                      */
/* ------------------------------------------------------------------ */

// One pass over the string. Alternatives are ordered so that ** is matched
// before *, and code spans are matched before anything else can consume their
// contents.
//
// The emphasis branches require a non-space character just inside the markers.
// Without that, arithmetic like "2 * 3 * 4" would render 3 as italic, which is
// exactly the kind of noise this renderer exists to remove.
const INLINE_PATTERN =
  /(`+)([\s\S]*?)\1|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|(?<![\w*])\*(?=\S)([^*\n]+?\S)\*(?![\w*])|(?<![\w_])_(?=\S)([^_\n]+?\S)_(?![\w_])|\[([^\]\n]*)\]\(([^)\s]+)\)/g;

function renderInline(text) {
  const frag = document.createDocumentFragment();
  let cursor = 0;
  let match;

  INLINE_PATTERN.lastIndex = 0;

  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > cursor) {
      appendPlain(frag, text.slice(cursor, match.index));
    }

    if (match[1]) {
      // Fenced inline code: rendered literally, no nested formatting.
      const code = el("code");
      code.textContent = match[2].trim();
      frag.append(code);
    } else if (match[3] !== undefined) {
      frag.append(el("strong", match[3]));
    } else if (match[4] !== undefined) {
      frag.append(el("strong", match[4]));
    } else if (match[5] !== undefined) {
      frag.append(el("del", match[5]));
    } else if (match[6] !== undefined) {
      frag.append(el("em", match[6]));
    } else if (match[7] !== undefined) {
      frag.append(el("em", match[7]));
    } else if (match[8] !== undefined) {
      frag.append(link(match[8], match[9]));
    }

    cursor = INLINE_PATTERN.lastIndex;
  }

  if (cursor < text.length) {
    appendPlain(frag, text.slice(cursor));
  }

  return frag;
}

/* ------------------------------------------------------------------ */
/* List parsing                                                        */
/* ------------------------------------------------------------------ */

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

/** Turn a tree of {ordered, children} nodes into real <ul>/<ol> elements. */
function renderListNode(node) {
  const list = el(node.ordered ? "ol" : "ul");

  for (const child of node.children) {
    const item = el("li");

    if (child.leaf !== undefined) {
      item.append(renderInline(child.leaf));
    } else {
      // A nested list lives inside its parent <li>, per normal markdown.
      item.append(renderListNode(child));
    }

    list.append(item);
  }

  return list;
}

/**
 * Build a (possibly nested) list from a flat run of list items.
 * Items carry their indent width, so deeper indentation becomes a sublist.
 */
function buildList(items) {
  const root = { ordered: items[0].ordered, children: [] };
  const stack = [{ node: root, indent: items[0].indent }];

  for (const item of items) {
    // Pop back out to the enclosing level when indentation decreases.
    while (stack.length > 1 && item.indent < stack[stack.length - 1].indent) {
      stack.pop();
    }

    let current = stack[stack.length - 1].node;

    // Step deeper for each extra indent level, bounded so a malformed
    // response cannot build an unbounded structure.
    while (
      item.indent > stack[stack.length - 1].indent &&
      stack.length < MAX_LIST_DEPTH
    ) {
      const sub = { ordered: item.ordered, children: [] };
      current.children.push(sub);
      stack.push({ node: sub, indent: item.indent });
      current = sub;
    }

    current.children.push({ leaf: item.content });
  }

  return renderListNode(root);
}

/* ------------------------------------------------------------------ */
/* Block parsing                                                       */
/* ------------------------------------------------------------------ */

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const HEADING = /^\s*(#{1,6})\s+(.*)$/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
const INDENTED_CODE = /^(?: {4}|\t)(.*)$/;

// A line that starts one of these ends the paragraph being collected.
const BLOCK_START = /^(?:\s*(?:`{3,}|~{3,})| {0,3}#{1,6}\s|\s*(?:-{3,}|\*{3,}|_{3,})\s*$|\s*>|\s*(?:[-*+]|\d+[.)])\s+)/;

function renderBlocks(source) {
  const lines = String(source).replace(/\r\n?/g, "\n").split("\n");
  const frag = document.createDocumentFragment();
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    /* ---- Fenced code block: consume verbatim until the closing fence ---- */
    const fence = line.match(FENCE);
    if (fence) {
      const marker = fence[1];
      const body = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`).test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // step over the closing fence (or run off the end)

      const pre = el("pre");
      const code = el("code");
      if (fence[2]) code.dataset.language = fence[2];
      code.textContent = body.join("\n");
      pre.append(code);
      frag.append(pre);
      continue;
    }

    /* ---- Horizontal rule. Checked before lists so --- is not a bullet. ---- */
    if (RULE.test(line)) {
      frag.append(el("hr"));
      i += 1;
      continue;
    }

    /* ---- Heading ---- */
    const heading = line.match(HEADING);
    if (heading) {
      // Cap at h4 so a chat message cannot visually outrank the page title.
      const level = Math.min(heading[1].length, 4);
      const node = el(`h${level}`);
      node.append(renderInline(heading[2].trim()));
      frag.append(node);
      i += 1;
      continue;
    }

    /* ---- Blockquote: gather the run, then recurse on the stripped text ---- */
    if (QUOTE.test(line)) {
      const quoted = [];
      while (i < lines.length) {
        const quotedLine = lines[i].match(QUOTE);
        if (!quotedLine) break;
        quoted.push(quotedLine[1]);
        i += 1;
      }
      const quote = el("blockquote");
      quote.append(renderBlocks(quoted.join("\n")));
      frag.append(quote);
      continue;
    }

    /* ---- Indented code block (4 spaces) ---- */
    if (INDENTED_CODE.test(line)) {
      const body = [];
      while (i < lines.length) {
        const indented = lines[i].match(INDENTED_CODE);
        if (!indented) {
          // A blank line inside an indented block is preserved, but only if
          // more indented code follows.
          const next = lines[i + 1];
          if (lines[i].trim() === "" && next && INDENTED_CODE.test(next)) {
            body.push("");
            i += 1;
            continue;
          }
          break;
        }
        body.push(indented[1]);
        i += 1;
      }
      const pre = el("pre");
      const code = el("code");
      code.textContent = body.join("\n");
      pre.append(code);
      frag.append(pre);
      continue;
    }

    /* ---- List: collect items plus their continuation lines ---- */
    const firstItem = line.match(LIST_ITEM);
    if (firstItem) {
      const items = [];

      while (i < lines.length) {
        const item = lines[i].match(LIST_ITEM);
        if (item) {
          items.push({
            indent: item[1].replace(/\t/g, "    ").length,
            ordered: /\d/.test(item[2]),
            content: item[3],
          });
          i += 1;
          continue;
        }

        // Lazy continuation: an unindented plain line under a list item is
        // appended to that item rather than ending the list.
        if (lines[i].trim() && !BLOCK_START.test(lines[i]) && items.length) {
          items[items.length - 1].content += `\n${lines[i].trim()}`;
          i += 1;
          continue;
        }

        break;
      }

      frag.append(buildList(items));
      continue;
    }

    /* ---- Paragraph: consume until a blank line or a new block starts ---- */
    const paragraph = [line.trim()];
    i += 1;
    while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i])) {
      paragraph.push(lines[i].trim());
      i += 1;
    }

    const para = el("p");
    para.append(renderInline(paragraph.join("\n")));
    frag.append(para);
  }

  return frag;
}

/**
 * Parse a markdown string into a DocumentFragment, ready to insert.
 * @param {string} source
 * @returns {DocumentFragment}
 */
export function renderMarkdown(source) {
  return renderBlocks(source);
}
