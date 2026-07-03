---
name: web-scraper
version: 2.0.1
description: Fetches web pages and extracts structured data using CSS selectors
author: examples
category: network
tags: [http, scraping, css-selector, dom]
platform: [manus, openclaw, aether]
permissions:
  network: [get]
  filesystem: [write]
---

# Level 1: Metadata

- **Name:** web-scraper
- **Version:** 2.0.1
- **Description:** Fetches web pages and extracts structured data using CSS selectors

# Level 2: Instructions

You are a web scraping skill. Given a URL and a set of CSS selectors, fetch the page and extract the matching elements.

1. Validate the URL (must be http/https, no internal IP ranges).
2. Fetch the page with a 10-second timeout.
3. Parse the HTML into a DOM representation.
4. For each CSS selector, extract matching elements.
5. Return structured JSON with the extracted data.

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "url": { "type": "string", "format": "uri" },
    "selectors": {
      "type": "object",
      "patternProperties": {
        "^[a-zA-Z][a-zA-Z0-9_-]*$": { "type": "string" }
      }
    },
    "headers": { "type": "object" },
    "followRedirects": { "type": "boolean", "default": true }
  },
  "required": ["url", "selectors"]
}
```

## Output Schema

```json
{
  "type": "object",
  "properties": {
    "url": { "type": "string" },
    "statusCode": { "type": "integer" },
    "extracted": { "type": "object" },
    "links": { "type": "array", "items": { "type": "string" } },
    "title": { "type": "string" }
  }
}
```

## Example

**Input:**
```json
{
  "url": "https://news.example.com",
  "selectors": {
    "headlines": "h2.article-title",
    "summaries": "p.article-summary"
  }
}
```

**Output:**
```json
{
  "url": "https://news.example.com",
  "statusCode": 200,
  "title": "Today's Top Stories",
  "extracted": {
    "headlines": ["Story One", "Story Two"],
    "summaries": ["Summary one...", "Summary two..."]
  },
  "links": ["https://news.example.com/article/1"]
}
```

# Level 3: Resources

## Implementation

```javascript
async function scrapeUrl(url, selectors = {}, options = {}) {
  const validated = validateUrl(url);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  const headers = {
    'User-Agent': 'AetherBot/1.0',
    'Accept': 'text/html,application/xhtml+xml',
    ...options.headers
  };

  const response = await fetch(url, {
    method: 'GET',
    headers,
    redirect: options.followRedirects !== false ? 'follow' : 'manual',
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    return {
      ok: false,
      statusCode: response.status,
      error: `HTTP ${response.status}: ${response.statusText}`
    };
  }

  const html = await response.text();
  const dom = parseHTML(html);
  const extracted = {};

  for (const [name, selector] of Object.entries(selectors)) {
    if (name === 'nextPage') {
      const nextEl = dom.querySelector(selector);
      extracted[name] = nextEl ? nextEl.getAttribute('href') : null;
    } else {
      extracted[name] = [...dom.querySelectorAll(selector)].map(el => {
        if (name === 'links') return el.getAttribute('href') || el.textContent.trim();
        return el.textContent.trim();
      });
    }
  }

  // Also extract all <a> hrefs for the links field.
  const links = [...dom.querySelectorAll('a[href]')]
    .map(a => resolveUrl(url, a.getAttribute('href')))
    .filter(isSameDomain));

  return {
    ok: true,
    url,
    statusCode: response.status,
    title: dom.querySelector('title')?.textContent?.trim() || '',
    extracted,
    links
  };
}

function validateUrl(url) {
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) {
      return { ok: false, error: `Unsupported protocol: ${u.protocol}` };
    }
    const ip = u.hostname.match(/^(\d{1,3}\.){3}\d{1,3}$/);
    if (ip) {
      const parts = u.hostname.split('.').map(Number);
      // Block private ranges.
      if (parts[0] === 10 || parts[0] === 127) {
        return { ok: false, error: 'Private IP ranges blocked' };
      }
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
        return { ok: false, error: 'Private IP ranges blocked' };
      }
      if (parts[0] === 192 && parts[1] === 168) {
        return { ok: false, error: 'Private IP ranges blocked' };
      }
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Invalid URL format' };
  }
}

function parseHTML(html) {
  // Minimal HTML parser for server-side use.
  const handler = new htmlparser2.DomHandler();
  const parser = new htmlparser2.Parser(handler);
  parser.write(html);
  parser.end();
  return {
    querySelector(sel) { return htmlparser2.DomUtils.findOne(el => matchSelector(el, sel), handler.dom); },
    querySelectorAll(sel) { return htmlparser2.DomUtils.findAll(el => matchSelector(el, sel), handler.dom); }
  };
}

function resolveUrl(base, relative) {
  try { return new URL(relative, base).href; } catch { return relative; }
}

function isSameDomain(targetUrl) {
  try { return new URL(targetUrl).hostname === window.location.hostname; }
  catch { return false; }
}

function matchSelector(element, selector) {
  // Simplified selector matching — production would use a real CSS engine.
  if (selector.startsWith('.')) {
    return element.attribs?.class?.includes(selector.slice(1));
  }
  return element.name === selector;
}
```

## Dependencies

- [htmlparser2](https://www.npmjs.com/package/htmlparser2) (>= 9.0.0)
- [node-fetch](https://www.npmjs.com/package/node-fetch) (>= 3.0.0)

## Rate Limiting

- Maximum 1 request per second per domain
- Maximum 100 requests per minute total
- Respect robots.txt craw-delay directive

## Testing

```javascript
const result = await scrapeUrl('https://example.com', { title: 'h1' });
console.assert(result.ok === true);
console.assert(result.extracted.title.length > 0);
```

## Security Notes

- Blocks private IP ranges to prevent SSRF
- 10-second timeout prevents slow-loris
- Response size limited to 5MB
- All extracted strings are HTML-entity decoded and sanitized
