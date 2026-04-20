import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 3000);
const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:3001";

const html = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Create Job</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4efe7;
        --surface: rgba(255, 252, 246, 0.95);
        --surface-strong: #fffdfa;
        --line: rgba(98, 74, 48, 0.16);
        --text: #2d2318;
        --muted: #6f6457;
        --accent: #b96a2e;
        --accent-strong: #995421;
        --danger: #b42318;
        --success: #127b53;
        --font-display: Georgia, "Times New Roman", serif;
        --font-body: Arial, sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: var(--font-body);
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(185, 106, 46, 0.16), transparent 30%),
          linear-gradient(180deg, #efe6d9 0%, var(--bg) 30%, #f6f1e9 100%);
      }

      .shell {
        width: min(760px, calc(100vw - 24px));
        margin: 0 auto;
        padding: 20px 0 32px;
      }

      .hero {
        padding: 20px 20px 18px;
      }

      .eyebrow {
        margin: 0 0 10px;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: var(--accent);
      }

      h1 {
        margin: 0;
        font-family: var(--font-display);
        font-size: clamp(2.2rem, 5vw, 3.6rem);
        line-height: 0.95;
        max-width: 10ch;
      }

      .hero-copy {
        margin: 12px 0 0;
        max-width: 52ch;
        line-height: 1.55;
        color: var(--muted);
      }

      .panel {
        margin: 0 20px;
        padding: 20px;
        border-radius: 28px;
        background: linear-gradient(180deg, var(--surface-strong), var(--surface));
        border: 1px solid var(--line);
        box-shadow: 0 18px 40px rgba(52, 36, 18, 0.08);
      }

      .grid {
        display: grid;
        gap: 14px;
      }

      label {
        display: grid;
        gap: 8px;
        color: var(--muted);
        font-size: 0.94rem;
      }

      input,
      textarea,
      button {
        width: 100%;
        border-radius: 16px;
        border: 1px solid rgba(123, 92, 56, 0.22);
        padding: 14px 16px;
        font: inherit;
        background: rgba(255, 255, 255, 0.84);
        color: var(--text);
      }

      textarea {
        min-height: 132px;
        resize: vertical;
      }

      button {
        border: none;
        background: var(--accent);
        color: white;
        font-weight: 700;
        cursor: pointer;
      }

      button:hover {
        background: var(--accent-strong);
      }

      .status {
        min-height: 24px;
        margin: 12px 0 0;
        font-size: 0.95rem;
      }

      .status.error {
        color: var(--danger);
      }

      .status.success {
        color: var(--success);
      }

      .response {
        margin: 16px 20px 0;
        padding: 18px;
        border-radius: 24px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.68);
      }

      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--text);
      }

      @media (max-width: 640px) {
        .shell {
          width: min(100vw, 100%);
          padding-top: 10px;
        }

        .hero,
        .panel,
        .response {
          margin-left: 16px;
          margin-right: 16px;
          padding-left: 16px;
          padding-right: 16px;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <header class="hero">
        <p class="eyebrow">New job</p>
        <h1>\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u0437\u0430\u044f\u0432\u043a\u0443</h1>
        <p class="hero-copy">
          \u0417\u0430\u043f\u043e\u043b\u043d\u0438\u0442\u0435 \u0444\u043e\u0440\u043c\u0443, \u0438 \u0437\u0430\u044f\u0432\u043a\u0430 \u0443\u0439\u0434\u0435\u0442 \u0432 \u043c\u043e\u0434\u0435\u0440\u0430\u0446\u0438\u044e \u0441\u043e \u0441\u0442\u0430\u0442\u0443\u0441\u043e\u043c pending_moderation. \u041d\u0430 \u043e\u0434\u043d\u043e\u0433\u043e \u0437\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u0430 \u0434\u0435\u0439\u0441\u0442\u0432\u0443\u0435\u0442 \u043b\u0438\u043c\u0438\u0442: \u043d\u0435 \u0431\u043e\u043b\u044c\u0448\u0435 3 \u0437\u0430\u044f\u0432\u043e\u043a \u0432 \u0434\u0435\u043d\u044c.
        </p>
      </header>

      <section class="panel">
        <form id="job-form" class="grid">
          <label>
            \u0427\u0442\u043e \u043d\u0443\u0436\u043d\u043e \u0441\u0434\u0435\u043b\u0430\u0442\u044c
            <textarea name="title" required></textarea>
          </label>

          <label>
            \u0410\u0434\u0440\u0435\u0441
            <input name="address" type="text" required />
          </label>

          <label>
            \u0426\u0435\u043d\u0430
            <input name="price" type="number" min="1" step="1" required />
          </label>

          <label>
            \u041a\u043e\u0433\u0434\u0430 \u043d\u0443\u0436\u043d\u043e
            <input name="whenNeeded" type="datetime-local" required />
          </label>

          <button type="submit">\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u0437\u0430\u044f\u0432\u043a\u0443</button>
          <p id="status" class="status"></p>
        </form>
      </section>

      <section class="response">
        <pre id="output">{}</pre>
      </section>
    </main>

    <script>
      const apiOrigin = ${JSON.stringify(apiOrigin)};
      const form = document.getElementById("job-form");
      const statusNode = document.getElementById("status");
      const output = document.getElementById("output");

      function render(data) {
        output.textContent = JSON.stringify(data, null, 2);
      }

      function setStatus(message, kind) {
        statusNode.textContent = message;
        statusNode.className = "status " + kind;
      }

      async function apiFetch(path, options) {
        const response = await fetch(apiOrigin + path, {
          credentials: "include",
          headers: {
            "content-type": "application/json"
          },
          ...options
        });

        const data = await response.json();
        render(data);
        return { response, data };
      }

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        setStatus("", "");

        const formData = new FormData(form);
        const title = String(formData.get("title") || "").trim();
        const address = String(formData.get("address") || "").trim();
        const price = Number(formData.get("price"));
        const whenNeeded = String(formData.get("whenNeeded") || "").trim();

        if (!title) {
          setStatus("\\u0417\\u0430\\u043f\\u043e\\u043b\\u043d\\u0438\\u0442\\u0435 \\u043f\\u043e\\u043b\\u0435 '\\u0447\\u0442\\u043e \\u043d\\u0443\\u0436\\u043d\\u043e \\u0441\\u0434\\u0435\\u043b\\u0430\\u0442\\u044c'.", "error");
          return;
        }

        if (!address) {
          setStatus("\\u0423\\u043a\\u0430\\u0436\\u0438\\u0442\\u0435 \\u0430\\u0434\\u0440\\u0435\\u0441.", "error");
          return;
        }

        if (!Number.isFinite(price) || price <= 0) {
          setStatus("\\u0426\\u0435\\u043d\\u0430 \\u0434\\u043e\\u043b\\u0436\\u043d\\u0430 \\u0431\\u044b\\u0442\\u044c \\u0431\\u043e\\u043b\\u044c\\u0448\\u0435 0.", "error");
          return;
        }

        if (!whenNeeded) {
          setStatus("\\u0423\\u043a\\u0430\\u0436\\u0438\\u0442\\u0435, \\u043a\\u043e\\u0433\\u0434\\u0430 \\u043d\\u0443\\u0436\\u043d\\u043e.", "error");
          return;
        }

        const sessionResult = await apiFetch("/auth/session", { method: "GET" });
        if (!sessionResult.data.authenticated) {
          setStatus("\\u0421\\u043d\\u0430\\u0447\\u0430\\u043b\\u0430 \\u043d\\u0443\\u0436\\u043d\\u043e \\u0432\\u043e\\u0439\\u0442\\u0438 \\u0432 Telegram auth flow.", "error");
          return;
        }

        const jobResult = await apiFetch("/jobs", {
          method: "POST",
          body: JSON.stringify({
            title,
            address,
            price,
            whenNeeded: new Date(whenNeeded).toISOString()
          })
        });

        if (!jobResult.response.ok) {
          setStatus(jobResult.data.error || "\\u041d\\u0435 \\u0443\\u0434\\u0430\\u043b\\u043e\\u0441\\u044c \\u0441\\u043e\\u0437\\u0434\\u0430\\u0442\\u044c \\u0437\\u0430\\u044f\\u0432\\u043a\\u0443.", "error");
          return;
        }

        setStatus("\\u0417\\u0430\\u044f\\u0432\\u043a\\u0430 \\u0441\\u043e\\u0437\\u0434\\u0430\\u043d\\u0430 \\u0438 \\u043e\\u0442\\u043f\\u0440\\u0430\\u0432\\u043b\\u0435\\u043d\\u0430 \\u0432 moderation queue.", "success");
        form.reset();
      });
    </script>
  </body>
</html>`;

createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true, service: "web" }));
    return;
  }

  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}).listen(port, () => {
  console.log(`[web] listening on http://localhost:${port}`);
});
