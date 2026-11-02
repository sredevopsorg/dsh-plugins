/** Small text helpers shared by the executor and the tool definitions. */

/** Bound a string to a head/tail budget, marking the omitted middle explicitly. */
export function truncateOutput(text, maxChars) {
  const value = typeof text === 'string' ? text : String(text ?? '');
  if (!Number.isFinite(maxChars) || maxChars < 1 || value.length <= maxChars) return value;

  const omitted = value.length - maxChars;
  const marker = `\n…[entire: ${omitted} characters omitted; narrow the request or raise maxOutputChars]…\n`;
  const budget = Math.max(2, maxChars - marker.length);
  const head = Math.max(1, Math.ceil(budget * 0.6));
  const tail = Math.max(0, budget - head);
  return `${value.slice(0, head)}${marker}${tail === 0 ? '' : value.slice(-tail)}`;
}

/** Keep only the tail of a long diagnostic string. */
export function tailText(text, maxChars = 4_000) {
  const value = typeof text === 'string' ? text : String(text ?? '');
  if (value.length <= maxChars) return value;
  return `…[${value.length - maxChars} characters omitted]…\n${value.slice(-maxChars)}`;
}

/**
 * Format a successful CLI invocation for the model: stdout, then a stderr
 * section only when the command actually wrote diagnostics.
 */
export function formatResult(result, maxChars) {
  const stdout = typeof result?.stdout === 'string' ? result.stdout.trimEnd() : '';
  const stderr = typeof result?.stderr === 'string' ? result.stderr.trimEnd() : '';
  let text = stdout === '' ? '(no output)' : stdout;
  if (stderr !== '') text += `\n\n[stderr]\n${stderr}`;
  return truncateOutput(text, maxChars);
}

/** Normalize an unknown thrown value into a message string. */
export function errorMessage(error) {
  if (error instanceof Error && typeof error.message === 'string') return error.message;
  return String(error);
}

/** A one-line, bounded description of an argv for prompts and errors. */
export function describeArgv(binary, args) {
  const parts = [binary, ...(Array.isArray(args) ? args : [])].map((part) => {
    const value = String(part ?? '');
    return value === '' || /[\s"']/u.test(value) ? JSON.stringify(value) : value;
  });
  return tailText(parts.join(' '), 300);
}
