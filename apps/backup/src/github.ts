/** Minimal GitHub Git Data API client: commits several files in one commit. */

export interface GitHubOptions {
  repo: string; // owner/name
  token: string;
  branch?: string;
  fetch?: typeof fetch;
}

export function github({ repo, token, branch = "main", fetch: f = fetch }: GitHubOptions) {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await f(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "quemo-backup",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`GitHub ${method} ${path} failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  return {
    /** Text content of a file on the branch, or null if it doesn't exist. */
    async readText(path: string): Promise<string | null> {
      const res = await f(`https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.raw+json", "User-Agent": "quemo-backup" },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GitHub read ${path} failed: ${res.status}`);
      return res.text();
    },

    async commit(message: string, files: Record<string, Uint8Array | string>): Promise<string> {
      const ref = await call<{ object: { sha: string } }>("GET", `/git/ref/heads/${branch}`);
      const parent = await call<{ tree: { sha: string } }>("GET", `/git/commits/${ref.object.sha}`);
      const tree = [];
      for (const [path, content] of Object.entries(files)) {
        const blob = await call<{ sha: string }>("POST", "/git/blobs", {
          content: typeof content === "string" ? content : base64(content),
          encoding: typeof content === "string" ? "utf-8" : "base64",
        });
        tree.push({ path, mode: "100644", type: "blob", sha: blob.sha });
      }
      const newTree = await call<{ sha: string }>("POST", "/git/trees", { base_tree: parent.tree.sha, tree });
      const commit = await call<{ sha: string }>("POST", "/git/commits", { message, tree: newTree.sha, parents: [ref.object.sha] });
      await call("PATCH", `/git/refs/heads/${branch}`, { sha: commit.sha });
      return commit.sha;
    },
  };
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
