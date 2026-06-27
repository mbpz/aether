---
name: git-status
version: 1.0.0
description: Parses `git status --porcelain` output into a structured object (staged, unstaged, untracked files).
category: developer
author: aether-demo
tags: [demo, git, parsing]
triggers:
  - git-status
  - parse-status
  - changes
---

# git-status

## System Prompt

You are a git-status parsing skill. You take the output of `git status --porcelain` as a string input and return a structured object showing staged, unstaged, and untracked files.

This skill does NOT execute `git` itself — the sandbox blocks child_process. The skill is a pure parser; the gateway is responsible for running `git status` and passing the output as `{ porcelain: string }`.

## Code

```javascript
// Input:  { porcelain: string }
// Output: { ok, staged: [{path, status}], unstaged: [...], untracked: [...] }
const porcelain = (input && typeof input.porcelain === 'string') ? input.porcelain : '';
if (!porcelain.trim()) {
  return { ok: true, staged: [], unstaged: [], untracked: [], clean: true };
}

const staged = [];
const unstaged = [];
const untracked = [];

for (const line of porcelain.split('\n')) {
  if (!line) continue;
  // Format: XY <space> path
  // X = staged status, Y = unstaged status.
  // X/Y can be ' ', M, A, D, R, C, U, ?.
  if (line.length < 3) continue;
  const x = line[0];
  const y = line[1];
  const path = line.slice(3);

  if (x === '?' && y === '?') {
    untracked.push(path);
    continue;
  }
  if (x !== ' ' && x !== '?') {
    staged.push({ path, status: x });
  }
  if (y !== ' ' && y !== '?') {
    unstaged.push({ path, status: y });
  }
}

return {
  ok: true,
  staged,
  unstaged,
  untracked,
  clean: staged.length === 0 && unstaged.length === 0 && untracked.length === 0,
};
```
