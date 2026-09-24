// The one place that shells out to `gh`. Injectable so tests never touch the network.

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export interface CommandRunner {
  run(args: string[], opts?: { cwd?: string; env?: Record<string, string> }): Promise<CommandResult>;
}

export class GhCommandRunner implements CommandRunner {
  async run(args: string[], opts?: { cwd?: string; env?: Record<string, string> }): Promise<CommandResult> {
    const proc = Bun.spawn(["gh", ...args], {
      cwd: opts?.cwd,
      env: opts?.env ? { ...process.env, ...opts.env } : undefined,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, code };
  }
}

export interface GhIssue {
  number: number;
  title: string;
  body: string;
  labels: { name: string }[];
  comments: GhComment[];
}

export interface GhComment {
  id: number;
  author: string;
  authorAssociation: string;
  body: string;
  createdAt: string;
}

export interface CreatePrOptions {
  repo: string;
  base: string;
  head: string;
  title: string;
  body: string;
  draft?: boolean;
}

export interface GhPr {
  number: number;
  url: string;
  state: string;
  headRefName: string;
  isDraft: boolean;
  closingIssuesReferences?: { number: number }[];
}

class GhError extends Error {
  constructor(
    args: string[],
    public readonly result: CommandResult,
  ) {
    super(`gh ${args.join(" ")} failed (${result.code}): ${result.stderr.trim()}`);
  }
}

export class GitHub {
  constructor(private readonly runner: CommandRunner = new GhCommandRunner()) {}

  private async exec(args: string[]): Promise<CommandResult> {
    const result = await this.runner.run(args);
    if (result.code !== 0) throw new GhError(args, result);
    return result;
  }

  async listIssuesByLabel(repo: string, label: string): Promise<GhIssue[]> {
    const result = await this.exec([
      "issue",
      "list",
      "--repo",
      repo,
      "--label",
      label,
      "--state",
      "open",
      "--json",
      "number,title,body,labels,comments",
    ]);
    return JSON.parse(result.stdout || "[]");
  }

  async getIssue(repo: string, number: number): Promise<GhIssue> {
    const result = await this.exec([
      "issue",
      "view",
      String(number),
      "--repo",
      repo,
      "--json",
      "number,title,body,labels,comments",
    ]);
    return JSON.parse(result.stdout);
  }

  async listOpenIssues(repo: string): Promise<GhIssue[]> {
    const result = await this.exec([
      "issue",
      "list",
      "--repo",
      repo,
      "--state",
      "open",
      "--json",
      "number,title,body,labels,comments",
      "--limit",
      "200",
    ]);
    return JSON.parse(result.stdout || "[]");
  }

  // Returns the new comment's id, parsed from the URL `gh` prints
  // (…#issuecomment-123456), so callers that need to edit it later (status
  // comments) can hold onto it.
  async commentIssue(repo: string, number: number, body: string): Promise<number | undefined> {
    const result = await this.exec(["issue", "comment", String(number), "--repo", repo, "--body", body]);
    const match = result.stdout.trim().match(/issuecomment-(\d+)/);
    return match ? Number(match[1]) : undefined;
  }

  async editComment(repo: string, commentId: number, body: string): Promise<void> {
    // `gh issue comment` can only edit the caller's last comment; a specific one needs the API.
    await this.exec(["api", "-X", "PATCH", `repos/${repo}/issues/comments/${commentId}`, "-f", `body=${body}`]);
  }

  async addLabels(repo: string, number: number, labels: string[]): Promise<void> {
    if (labels.length === 0) return;
    await this.exec(["issue", "edit", String(number), "--repo", repo, "--add-label", labels.join(",")]);
  }

  async removeLabels(repo: string, number: number, labels: string[]): Promise<void> {
    if (labels.length === 0) return;
    await this.exec(["issue", "edit", String(number), "--repo", repo, "--remove-label", labels.join(",")]);
  }

  async setStateLabel(repo: string, number: number, current: string[], next: string): Promise<void> {
    const toRemove = current.filter((l) => l !== next);
    if (toRemove.length) await this.removeLabels(repo, number, toRemove);
    if (!current.includes(next)) await this.addLabels(repo, number, [next]);
  }

  async closeIssue(repo: string, number: number): Promise<void> {
    await this.exec(["issue", "close", String(number), "--repo", repo]);
  }

  async reopenIssue(repo: string, number: number): Promise<void> {
    await this.exec(["issue", "reopen", String(number), "--repo", repo]);
  }

  async createIssue(repo: string, title: string, body: string, labels: string[]): Promise<number> {
    const args = ["issue", "create", "--repo", repo, "--title", title, "--body", body];
    for (const l of labels) args.push("--label", l);
    const result = await this.exec(args);
    const match = result.stdout.trim().match(/\/issues\/(\d+)/);
    if (!match) throw new Error(`could not parse issue number from: ${result.stdout}`);
    return Number(match[1]);
  }

  async createPr(opts: CreatePrOptions): Promise<string> {
    const args = [
      "pr",
      "create",
      "--repo",
      opts.repo,
      "--base",
      opts.base,
      "--head",
      opts.head,
      "--title",
      opts.title,
      "--body",
      opts.body,
    ];
    if (opts.draft) args.push("--draft");
    const result = await this.exec(args);
    return result.stdout.trim().split("\n").pop() ?? "";
  }

  async listPrs(repo: string, opts?: { state?: string }): Promise<GhPr[]> {
    const result = await this.exec([
      "pr",
      "list",
      "--repo",
      repo,
      "--state",
      opts?.state ?? "open",
      "--json",
      "number,url,state,headRefName,isDraft,closingIssuesReferences",
      "--limit",
      "100",
    ]);
    return JSON.parse(result.stdout || "[]");
  }

  async findPrByHead(repo: string, head: string): Promise<GhPr | undefined> {
    const prs = await this.listPrs(repo, { state: "open" });
    return prs.find((p) => p.headRefName === head);
  }

  // Comments and review bodies on the PR, shaped like issue comments so the
  // same trust and command parsing applies. Empty when no PR exists yet.
  async prFeedback(repo: string, head: string): Promise<GhComment[]> {
    const result = await this.runner.run([
      "pr", "view", head, "--repo", repo, "--json", "comments,reviews",
    ]);
    if (result.code !== 0) return [];
    const data = JSON.parse(result.stdout || "{}") as {
      comments?: { author?: { login?: string }; authorAssociation: string; body: string; createdAt: string }[];
      reviews?: { author?: { login?: string }; authorAssociation: string; body: string; submittedAt: string }[];
    };
    const toComment = (c: { author?: { login?: string }; authorAssociation: string; body: string }, createdAt: string): GhComment => ({
      id: 0,
      author: c.author?.login ?? "",
      authorAssociation: c.authorAssociation,
      body: c.body,
      createdAt,
    });
    return [
      ...(data.comments ?? []).map((c) => toComment(c, c.createdAt)),
      ...(data.reviews ?? []).filter((r) => r.body).map((r) => toComment(r, r.submittedAt)),
    ];
  }

  // `ref` is a PR number or its head branch. Draft = the factory is working,
  // ready = a human's turn.
  async markReady(repo: string, ref: string | number, ready: boolean): Promise<void> {
    await this.exec(["pr", "ready", String(ref), "--repo", repo, ...(ready ? [] : ["--undo"])]);
  }

  async closePr(repo: string, number: number): Promise<void> {
    await this.exec(["pr", "close", String(number), "--repo", repo]);
  }

  async listLabels(repo: string): Promise<string[]> {
    const result = await this.exec(["label", "list", "--repo", repo, "--json", "name", "--limit", "200"]);
    const rows = JSON.parse(result.stdout || "[]") as { name: string }[];
    return rows.map((r) => r.name);
  }

  async ensureLabel(repo: string, name: string, color: string, description: string): Promise<void> {
    const result = await this.runner.run([
      "label",
      "create",
      name,
      "--repo",
      repo,
      "--color",
      color,
      "--description",
      description,
      "--force",
    ]);
    if (result.code !== 0 && !result.stderr.includes("already exists")) {
      throw new GhError(["label", "create", name], result);
    }
  }

  async currentLogin(): Promise<string> {
    const result = await this.exec(["api", "user", "--jq", ".login"]);
    return result.stdout.trim();
  }

  // Unlike the methods above, a failed `gh auth status` is an expected,
  // reportable outcome (doctor finding #13 wants a real check here), not an
  // exceptional one: so this calls the runner directly instead of `exec`,
  // which would throw.
  async authStatus(): Promise<{ ok: boolean; detail: string }> {
    const result = await this.runner.run(["auth", "status"]);
    const firstLine = (result.stdout + result.stderr).trim().split("\n")[0] ?? "";
    return { ok: result.code === 0, detail: firstLine || "gh auth status failed with no output" };
  }
}
