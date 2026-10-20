/** The backend owns inference; only a short validated title crosses this boundary. */
export async function requestTitle(description: string, model: string | null, signal: AbortSignal): Promise<string | null> {
  const response = await fetch("/api/title", {
    method: "POST", headers: { "content-type": "application/json" }, signal,
    body: JSON.stringify({ description: description.slice(0, 4000).replace(/[\uD800-\uDBFF]$/, ""), ...(model ? { model } : {}) }),
  });
  if (!response.ok) throw new Error(`Title generation failed (HTTP ${response.status})`);
  const body: unknown = await response.json();
  const title = body && typeof body === "object" && "title" in body && typeof body.title === "string" ? body.title.trim() : "";
  return title && title.length <= 200 && !/[<>\r\n]/u.test(title) ? title : null;
}
