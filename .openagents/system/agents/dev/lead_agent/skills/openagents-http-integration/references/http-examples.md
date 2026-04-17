# HTTP Examples

Use these examples as starting points. Keep the payload fields identical to the native `/v1/turns` contract.

## JavaScript `fetch`

```js
function resolveApiRoot(rawBaseUrl) {
  const trimmed = rawBaseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

const apiRoot = resolveApiRoot("http://127.0.0.1:8083");
const response = await fetch("http://127.0.0.1:8083/v1/turns", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  // Prefer one canonical API root, then append /turns explicitly.
  // This keeps both `http://host` and `http://host/v1` inputs working.
  // Example:
  // fetch(`${apiRoot}/turns`, { ... })
  body: JSON.stringify({
    agent: "support-agent",
    input: { text: "请帮我查一下退款规则" },
    thinking: { enabled: true, effort: "medium" },
  }),
});

if (!response.ok) {
  throw new Error(await response.text());
}

const turn = await response.json();
console.log(turn.output_text);
```

## JavaScript SSE streaming

```js
const apiRoot = resolveApiRoot("http://127.0.0.1:8083");
const response = await fetch(`${apiRoot}/turns`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Accept": "text/event-stream",
  },
  body: JSON.stringify({
    agent: "support-agent",
    input: { text: "请帮我查一下退款规则" },
    stream: true,
    thinking: { enabled: true, effort: "medium" },
  }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });

  let boundary = buffer.indexOf("\\n\\n");
  while (boundary >= 0) {
    const rawEvent = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 2);
    boundary = buffer.indexOf("\\n\\n");

    const lines = rawEvent.split("\\n").filter(Boolean);
    const eventName = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
    const dataText = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\\n");

    if (!eventName || !dataText) continue;
    const event = JSON.parse(dataText);
    console.log(eventName, event);
  }
}

const finalTurn = await fetch(`${apiRoot}/turns/${turnId}`, {
  headers: { Authorization: `Bearer ${apiKey}` },
}).then((res) => res.json());
```

## Python demo script

The repository keeps one Python demo under `sdk/python/http_turn_demo.py`. Use that script as the simplest runnable example.

## cURL

```bash
curl -X POST "http://127.0.0.1:8083/v1/turns" \
  -H "Authorization: Bearer <user_created_key>" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "support-agent",
    "input": {
      "text": "请总结当前客服问题"
    }
  }'
```
