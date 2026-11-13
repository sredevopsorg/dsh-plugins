# Chilean Spanish voice

## Who reads it

SREs, platform engineers, DevOps practitioners, developers, and security people across Chile, Spain, and LATAM. Many read English documentation all day. They do not need technical terms translated into unfamiliar Spanish; they need the prose to sound like a competent colleague explaining the problem, not like a translated press release.

## Register

- `tú`, not `vos`, not `vosotros`. Verb forms follow `tú`: "tienes", "puedes", "corres".
- Conversational but professional. Contractions and short sentences are welcome.
- Neutral enough for Spain and LATAM. Avoid Chile-only syntax that would confuse a reader in Madrid, and Spain-only vocabulary that would confuse a reader in Santiago.
- The reader is smart. Do not over-explain basic concepts, and do not pad with "básicamente" or "en pocas palabras".
- Direct address is fine: "si tu clúster hace esto, revisa aquello".

## Chilean seasoning

Use at most two expressions per article, and zero is fine. Use them only when the piece is informal, including a new draft whose brief asks for a casual register:

- `fome` — boring, lame.
- `al tiro` — right away.
- `cachurear` — tinker with, dig through.
- `penca` — mediocre, bad quality.
- `darse la lata` — go to the trouble.
- `harto` — a lot (informal).
- `bacán` — cool (dated; use sparingly, if at all).

Do not use:

- `weón`, `weona`, `conchetumare`, or any insult or profanity.
- `po` as a filler in every sentence.
- Forced local references that have nothing to do with the topic.
- Slang in headings, security warnings, remediation steps, or code comments.

If removing the expression would not change the meaning, it is decoration. Use it only if it earns its place.

## Technical terms

- Keep product names, API kinds, CLI commands, flags, and file paths in English.
- For ordinary nouns, the glossary is the tie-breaker: use its preferred Spanish form on first mention, and the English form when that is what the reader will see in the docs. Pick one per article and stay consistent.
- One short first-use gloss is allowed when it prevents confusion: "la confiabilidad (reliability)". Do not gloss every term.
- Kubernetes resource kinds keep their English names and capitalization: `Deployment`, `Service`, `Ingress`, `Node`, `Pod`.

## Grammar and style

- Prefer active voice: "el scheduler reintenta el pod", not "el pod es reintentado por el scheduler".
- Prefer verbs to noun piles: "despliega la aplicación", not "realiza el despliegue de la aplicación".
- Cut `realizar`, `permitir`, `contar con`, `a nivel de`, `en base a`, and `el mismo` when a simpler verb works.
- Avoid the redundant `se` passive when the agent is clear: "Kubernetes elimina el pod", not "el pod es eliminado por Kubernetes".
- Avoid gerund chains: "mediante la utilización de..." becomes "usando...".
- Do not start every paragraph with a connective (`Además`, `Por otro lado`, `Sin embargo`).
- One idea per paragraph. Short paragraphs read better on mobile.
- Use `se` for impersonal statements when needed: "se recomienda actualizar".

## Typography

- Sentence case in headings: only the first word and proper nouns capitalized.
- `«»` for quoted terms; `“”` for nested quotes. Keep the source's usage when it is consistent.
- `¿` and `¡` at the start of questions and exclamations.
- Decimal comma and thousands point in prose: `1,5 %`, `35.000 CVE`. Keep code, version numbers, and identifiers exactly as written.
- Percent sign attached to the number, as the site does: `70%`.
- Dates: `12 de noviembre de 2026`. Times: 24-hour format.
- Currency: use the source's currency and formatting. `USD 4.000 millones` is fine; do not convert.
- Raya (`—`) for parenthetical asides, not a hyphen with spaces.
- No emoji unless the source uses them.

## False friends and common slips

| Avoid | Use |
|---|---|
| ordenador | computador, equipo |
| fichero | archivo |
| móvil (for phone) | celular |
| link (in prose) | enlace (but `link` is acceptable in technical contexts) |
| aplicación (for a K8s app) | aplicación, app |
| actualmente (for "currently") | hoy, en este momento |
| eventualmente (for "eventually") | finalmente, con el tiempo |
| introducir (for "introduce a feature") | presentar, incorporar |
| soportar (for "support a version") | ser compatible con, admitir |
| remover (for "remove") | quitar, eliminar |
| backup | respaldo (but `backup` is common in ops prose) |
| deploy (as a noun) | despliegue |
| performance | rendimiento |
| latency | latencia |
| reliability | confiabilidad |
| resilience | resiliencia |
| observability | observabilidad |
| troubleshooting | diagnóstico, resolución de problemas |

## Examples

Bad (translated-sounding):
> Es importante destacar que, en el vertiginoso mundo actual, la implementación de una estrategia de observabilidad robusta permite desbloquear el potencial de los clústeres.

Good:
> Tu clúster ya te está diciendo qué se rompió. El problema es que nadie configuró las alertas para escucharlo.

Bad (forced slang):
> Weón, el operador está mal configurado, po. Cachai que hay que reinstalarlo al tiro.

Good (light touch):
> El operador está mal configurado. Otra vez. Al tiro se nota en los eventos del namespace.

Bad (over-literal):
> El pod está siendo reiniciado por el kubelet debido a que el liveness probe está fallando.

Good:
> El kubelet reinicia el pod porque el liveness probe está fallando.

## Humor

- Dry, situational, and aimed at the problem, not the reader.
- Chilean humor can be self-deprecating about operational pain: the 3 a.m. page, the YAML that looked fine in staging, the vendor slide that promised otherwise.
- Do not explain the joke. Do not stack three jokes in a row. One sharp line is enough.
- Never joke about a real incident's victims, a security breach's affected users, or a person's mistake.
