import { describe, expect, test } from "bun:test";
import { GitHub } from "../src/github";

describe("GitHub.editComment", () => {
  test("PATCHes the comment by id via the API (gh issue comment has no --edit <id>)", async () => {
    const calls: string[][] = [];
    const gh = new GitHub({
      run: async (args: string[]) => {
        calls.push(args);
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    await gh.editComment("o/r", 42, "hello");
    expect(calls).toEqual([["api", "-X", "PATCH", "repos/o/r/issues/comments/42", "-f", "body=hello"]]);
  });
});
