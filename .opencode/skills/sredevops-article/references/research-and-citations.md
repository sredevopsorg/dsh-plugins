# Research and citations

## Source hierarchy

1. **Primary and authoritative** — official documentation, release notes, changelogs, API references, specifications, maintainer announcements, NVD/CVE records, regulator publications, RFCs, standards bodies.
2. **Primary but interested** — vendor engineering blogs describing their own product or incident. Useful and often detailed, but read for claims and bias.
3. **Independent technical analysis** — reputable engineering blogs, conference talks, academic papers, well-sourced reporting.
4. **Community signal** — GitHub issues, Reddit, Hacker News, social posts. Use to find problems and sentiment, not as the sole source of a factual claim.

Never cite a search-results snippet as if you read the page. Never cite a page whose content contradicts the claim you are making.

## Minimum sourcing

- **News or analysis:** two independent primary sources, or one primary source plus the official documentation that establishes the mechanism.
- **Tutorial:** one official source for each tool or API, plus a working example you can trace to documentation.
- **CVE or security incident:** the NVD record or the vendor advisory, plus the affected project's statement when one exists.
- **Opinion:** no minimum, but every factual premise needs a source. Label the judgment as judgment.

If you cannot meet the minimum, shrink the claims. A narrower article with solid sources beats a sweeping one held together by vibes.

## What to capture for each source

- The canonical URL, not a tracking or AMP variant. See the one `ref` exception under Links.
- The title and publisher.
- The publication or last-updated date.
- The version, commit, or release the claim applies to.
- Whether you read the whole page or only the relevant section.
- Whether the source is primary, secondary, or interested.

Use `web_fetch` to open the page when the claim matters. Search results are for discovery, not evidence.

## Dates, versions, and time

- Time-sensitive statements need a date or version: "as of Kubernetes 1.36", "in the 2026-09 advisory".
- Do not write "recently" or "just released" without a date.
- If the release date is in the future relative to the current date, say "scheduled" or "announced for", not "shipped".
- When a claim is likely to change, add an editor note saying what would update it.

## CVEs and security content

- Use the CVE ID, the affected versions, the fixed version, the attack vector, and the required privileges.
- Link to NVD and the vendor advisory. Do not link to exploit repositories.
- Do not publish working exploit payloads. Describe impact and remediation.
- If exploitation is active, say so only with a source that says so.
- Include the mitigation for people who cannot patch immediately.
- Do not soften severity to make a joke land.

## Code snippets

- Copy from official documentation or a source you actually read, and adapt the minimum necessary.
- Keep the snippet focused. Remove unrelated fields and comments.
- Never include real tokens, kubeconfigs, account IDs, internal hostnames, or customer data.
- Mark destructive commands and explain the blast radius.
- You have no shell. Never say "I ran this", "tested", or "verified in a cluster". If you did not execute it, say "not executed here" in the editor notes when it matters.
- Prefer commands that show context and namespace explicitly, for example `kubectl --context prod --namespace payments get pods`.

## Links

- Link descriptive text, never "here".
- Use the canonical URL, with no tracking or AMP variant. The one exception: append `?ref=sredevops.org` to vendor product and documentation links. If the URL already has a query string, append `&ref=sredevops.org` instead. Never add it to CVE/NVD, government, standards-body, RFC, or internal sredevops.org links, and preserve every other query parameter.
- Check that the link resolves to the page you describe. If it redirects, use the final canonical URL.
- Do not link to a page you have not opened unless you label it as something for the reader to verify.

## Quoting

- Quote only when the exact wording matters: a specification, an error message, a strong claim you are rebutting.
- Keep quotes under a few sentences and attribute them inline.
- Do not fabricate or "clean up" a quote. Use brackets for edits and ellipses for omissions.
- Paraphrase when the idea matters more than the wording.

## Common traps

- **The press-release trap:** a vendor announces a feature and the article repeats the benefits without checking availability, pricing, or limitations. Check the docs and the release notes.
- **The version trap:** a blog post describes behavior from an older release. Check the version the source applies to and the current stable release.
- **The benchmark trap:** a vendor publishes a benchmark with no methodology. Either explain the conditions or do not use the number.
- **The "everyone knows" trap:** a claim that sounds obvious but has no source. Cut it or find one.
- **The future-date trap:** an announcement for a future release described as available. Use "announced", "preview", or "scheduled".
- **The AI-summary trap:** a search result or generated summary that misstates the source. Open the source.

## When sources conflict

- Prefer the primary source and the more recent version.
- State the conflict and what each side claims. Do not average them.
- If the conflict cannot be resolved, say what is known and what is not.

## When you cannot verify

Say so plainly in the body or editor notes:

> This claim comes from the vendor's announcement; the feature is not yet in the public docs, so treat the timeline as unconfirmed.

That sentence is worth more than a confident paragraph built on nothing.
