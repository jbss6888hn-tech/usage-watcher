/**
 * PATCH a single file inside an existing GitHub Gist.
 *   gistId       — id of an already-created private gist
 *   filename     — e.g. "mac.json" / "win.json"
 *   contentJson  — string (already JSON.stringified)
 *   token        — GitHub PAT with `gist` scope
 *
 * Throws on non-2xx. Returns the parsed response body.
 */
export async function updateGistFile({ gistId, filename, contentJson, token }) {
  if (!gistId) throw new Error("gistId missing");
  if (!token) throw new Error("github token missing");

  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "usage-watcher/0.1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      files: {
        [filename]: { content: contentJson },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`gist PATCH failed: ${res.status} ${res.statusText} :: ${body.slice(0, 400)}`);
  }
  return res.json();
}
