---
name: github-actions-security-audit
description: >
  Audit GitHub Actions workflows for security vulnerabilities and apply
  remediations based on GitHub's official Secure use reference. Detects
  script injection, unsafe pull_request_target/workflow_run checkout, overly
  permissive GITHUB_TOKEN permissions, unpinned third-party actions, secret
  mishandling, self-hosted runner risks, and missing supply-chain controls;
  then proposes or applies fixes.
whenToUse: >
  Use when reviewing or hardening .github/workflows/ files, responding to a
  security finding in CI/CD, preparing a repository for public contribution,
  or performing a supply-chain security review of GitHub Actions.
metadata:
  source: https://docs.github.com/en/actions/reference/security/secure-use
  scope: github-actions, github-workflows, supply-chain-security
---

# GitHub Actions & Workflows Security Audit

Audit and remediate GitHub Actions workflows using the controls in GitHub's
[Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use).
This skill turns the reference into an executable review: inspect workflow
files, flag concrete anti-patterns, and produce fixes.

## Audit workflow

Work through the checklist below for every file under `.github/workflows/`.
For each finding, record the file, line, severity, and a minimal remediation.

### 1. Secrets and `GITHUB_TOKEN` permissions

**What to check**
- `permissions:` is declared at the workflow or job level; the default is not
  left wide open.
- The workflow-level default is read-only for `contents` (or stricter), and
  write permissions are granted only to the specific jobs that need them.
- Secrets are not stored as plaintext in workflow files; non-secret sensitive
  values are masked with `::add-mask::`.
- Structured data (JSON, XML, YAML blobs) is not used as a secret, because
  redaction becomes unreliable.
- Secrets are individually registered; derived values (JWTs, transformed or
  encoded values) are also registered as secrets so they are redacted if they
  appear in logs.
- Environment secrets that require approval use `environment:` with required
  reviewers where appropriate.

**Remediation**
- Add an explicit top-level `permissions:` block. Start from `contents: read`
  and add `actions`, `checks`, `pull-requests`, `id-token`, etc. only per job.
- Replace inline secret interpolation with environment variables or an action
  input that receives the secret as an argument.
- Remove plaintext sensitive values; move them to repository, organization, or
  environment secrets and reference them via `${{ secrets.NAME }}`.
- Add `::add-mask::` for any sensitive value generated during the run that is
  not already a secret.

### 2. Script injection

**What to check**
- Untrusted context values are not interpolated directly into `run:` shell
  scripts. High-risk contexts include:
  - `github.event.pull_request.title`
  - `github.event.pull_request.body`
  - `github.event.issue.title`
  - `github.event.issue.body`
  - `github.event.comment.body`
  - `github.head_ref`
  - `github.event.pull_request.head.ref`
  - Any other value an external contributor can set.
- The workflow uses an action with the value passed as an argument, or an
  intermediate environment variable, instead of inline interpolation.


**Remediation**
- Preferred: move the logic into a JavaScript action and pass the context value
  as an input.
- For inline scripts: assign the value to an `env:` variable and reference the
  environment variable inside the script, quoting it.
  ```yaml
  env:
    TITLE: ${{ github.event.pull_request.title }}
  run: |
    if [[ "$TITLE" =~ ^octocat ]]; then
      echo "PR title starts with 'octocat'"
    fi
  ```
- Never use `${{ ... }}` directly inside a `run:` block with untrusted data.

### 3. Untrusted code checkout (`pull_request_target`, `workflow_run`)

**What to check**
- `pull_request_target` or `workflow_run` is used.
- The workflow checks out PR code, fork code, or any code from a repository not
  under your control inside the privileged workflow.
- The workflow passes artifacts from `workflow_run` to privileged steps without
  validation.

**Remediation**
- If privileged context is not required, remove `pull_request_target` or
  `workflow_run` and use `pull_request` or another unprivileged trigger.
- If privileged context is required, never check out untrusted code in that
  workflow. Split the workflow: process untrusted code in an unprivileged
  workflow, upload artifacts, and handle only validated results in the
  privileged `workflow_run` workflow.
- When `actions/checkout` is used with `pull_request_target`, ensure the ref is
  the base branch, not the PR head, unless you have explicitly reviewed the
  security implications. See GitHub's "Securely using pull_request_target"
  guidance.

### 4. Third-party actions and reusable workflows

**What to check**
- Every `uses:` reference is pinned to a full commit SHA, not a mutable tag or
  branch. Tags can be moved or deleted.
- Third-party actions are audited: their source has been reviewed for secret
  handling and network access.
- Reusable workflows from third parties follow the same review and pinning
  requirements.
- Dependabot is configured to keep action references up to date.

**Remediation**
- Pin all actions to a commit SHA. Example:
  ```yaml
  uses: owner/action@<full-40-character-sha>  # vX.Y.Z
  ```
- Enable Dependabot version updates for GitHub Actions.
- For unmaintained or suspicious actions, replace them with a locally audited
  action or an inline step.

### 5. Self-hosted runners

**What to check**
- A self-hosted runner is used on a **public** repository. This is almost
  always unsafe: any contributor can run code on the runner.
- A self-hosted runner on a private/internal repository may still be reachable
  by anyone who can fork the repository and open a PR.
- The runner machine holds long-lived credentials, SSH keys, or network access
  to sensitive services.

**Remediation**
- On public repositories, migrate to GitHub-hosted runners unless there is a
  hard requirement and a hardened, ephemeral, network-restricted environment
  is in place.
- On private repositories, use runner groups to isolate sensitive runners and
  restrict which repositories can use them.
- Remove unnecessary credentials from the runner host; prefer OIDC to cloud
  providers instead of long-lived secrets.

### 6. Supply-chain and repository controls

**What to check**
- Workflow files are protected by `CODEOWNERS`, so changes require review by a
  designated owner.
- CodeQL or GitHub Actions workflow scanning is enabled.
- OpenSSF Scorecard is used to continuously check workflow security.
- The repository does not allow GitHub Actions to create or approve pull
  requests unless absolutely necessary.
- OIDC is used for cloud authentication instead of long-lived cloud secrets.

**Remediation**
- Add `.github/workflows/` to `CODEOWNERS`.
- Enable CodeQL default setup and GitHub Actions scanning.
- Add an OpenSSF Scorecard workflow or run Scorecard regularly.
- Disable the "Allow GitHub Actions to create and approve pull requests"
  setting at the repository or organization level unless explicitly needed.
- Replace static cloud credentials with OIDC federation where supported.

## Output format

For each finding, produce:

```
File: .github/workflows/<name>.yml
Line: <line-number>
Severity: high | medium | low
Issue: <short description>
Evidence: <snippet>
Remediation: <exact YAML change or step-by-step instruction>
```

Group findings by category (secrets, injection, checkout, third-party actions,
runners, repository controls) and provide a summary table at the top.

## Remediation principles

- **Least privilege**: every token, permission, and credential should be scoped
  to the minimum required for the job.
- **Defense in depth**: combine permissions restrictions, pinning, CODEOWNERS,
  and scanning; no single control is sufficient.
- **Untrusted input is never code**: pass it through environment variables or
  action inputs; never interpolate it into scripts.
- **Privileged workflows never touch untrusted code**: separate privilege
  levels and validate artifacts across workflow boundaries.
- **Ephemeral, isolated compute for untrusted workloads**: GitHub-hosted
  runners are the safe default.

## References

- GitHub Docs, *Secure use reference*:
  https://docs.github.com/en/actions/reference/security/secure-use
- GitHub Docs, *Securely using pull_request_target* (linked from the secure
  use reference).
- OpenSSF Scorecard *Dangerous-Workflow* check.
- GitHub Security Lab, *Preventing pwn requests*.

