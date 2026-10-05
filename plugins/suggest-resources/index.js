/**
 * suggest-resources — a Host plugin that recommends capabilities for a task.
 *
 * Registers the model-facing `suggest_resources` tool, which ranks tools,
 * plugins, MCP servers, and skills against a description of what the user
 * wants to do. Suggestions are advisory: this plugin never enables, installs,
 * or connects anything, and it never appends session events.
 *
 * Deliberately dependency-free. A workspace-linked plugin cannot resolve bare
 * `@deepseek-ai/*` specifiers unless its manifest declares them as
 * peerDependencies, so this file imports nothing but its own catalog and
 * registers a raw tool definition instead of using `defineTool`.
 */

import { MCP_SERVERS, PLUGIN_SEEDS } from './catalog.js';

/** The one service this plugin cannot work without. */
export const inject = ['tools'];

const TOOL_NAME = 'suggest_resources';
const MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client';
const KINDS = ['tool', 'plugin', 'mcp', 'skill'];

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const NO_MATCH_LIMIT = 3;
const DEFAULT_MAX_TASK_CHARS = 4000;
const MIN_MAX_TASK_CHARS = 64;
const MAX_FIELD_CHARS = 200;
const MAX_OUTPUT_CHARS = 12000;
/**
 * Sits in the unused gap between TOOL_GOAL (2400) and TOOL_WORKFLOW (2600).
 * `systemPrompt.getSectionOrder()` returns undefined for names it does not
 * know, and `section()` rejects a non-finite order, so a literal is required.
 */
const PROMPT_SECTION_ORDER = 2450;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'then', 'than',
  'them', 'they', 'their', 'there', 'here', 'when', 'what', 'which', 'while',
  'have', 'has', 'had', 'was', 'were', 'are', 'not', 'but', 'you', 'your',
  'our', 'its', 'can', 'could', 'would', 'should', 'will', 'just', 'any',
  'all', 'some', 'each', 'every', 'about', 'over', 'under', 'out', 'off',
  'use', 'using', 'used', 'get', 'got', 'make', 'made', 'need', 'needs',
  'want', 'wants', 'how', 'why', 'who', 'also', 'via', 'per', 'one', 'two'
]);

const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;

const DEFAULTS = Object.freeze({
  limit: DEFAULT_LIMIT,
  kinds: KINDS,
  mcpServers: [],
  extraPlugins: [],
  promptSection: true,
  maxTaskChars: DEFAULT_MAX_TASK_CHARS
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(error) {
  if (error instanceof Error && typeof error.message === 'string') return error.message;
  return String(error);
}

/** Read one localized string from a `LocalizedText` (plain string or `{ en, ... }`). */
function localizedText(value) {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return undefined;
  if (typeof value.en === 'string') return value.en;
  for (const entry of Object.values(value)) {
    if (typeof entry === 'string') return entry;
  }
  return undefined;
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => typeof entry === 'string');
}

function truncateField(text) {
  if (typeof text !== 'string') return '';
  if (text.length <= MAX_FIELD_CHARS) return text;
  return `${text.slice(0, MAX_FIELD_CHARS - 1)}…`;
}

function compareStrings(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function tokenize(text) {
  const found = new Set();
  if (typeof text !== 'string' || text.length === 0) return found;
  for (const match of text.toLowerCase().matchAll(TOKEN_PATTERN)) {
    const token = match[0];
    if (token.length >= 3 && !STOPWORDS.has(token)) found.add(token);
  }
  return found;
}

/** Merge user-supplied catalogue entries over the built-ins, keyed by `name`. */
function mergeCatalogue(base, extra) {
  const byName = new Map();
  for (const entry of base) {
    if (isRecord(entry) && typeof entry.name === 'string') byName.set(entry.name, entry);
  }
  for (const entry of extra) {
    if (!isRecord(entry) || typeof entry.name !== 'string') continue;
    byName.set(entry.name, { ...(byName.get(entry.name) ?? {}), ...entry });
  }
  return [...byName.values()];
}

/** Compact, paste-ready hint for connecting one MCP server. */
function mcpAction(server) {
  const parts = [`serverName: ${server.name}`];
  if (typeof server.transport === 'string') parts.push(`transport: ${server.transport}`);
  if (typeof server.command === 'string') parts.push(`command: ${server.command}`);
  if (Array.isArray(server.args) && server.args.length > 0) {
    parts.push(`args: ${JSON.stringify(server.args)}`);
  }
  if (typeof server.url === 'string') parts.push(`url: ${server.url}`);
  if (typeof server.envHint === 'string') {
    parts.push(`env: { ${server.envHint}: !!js process.env.${server.envHint} }`);
  }
  return `'${MCP_CLIENT_PACKAGE}' row -> { ${parts.join(', ')} }`;
}

/** Resolve the row config, ignoring malformed values instead of failing activation. */
export function resolveConfig(raw) {
  const config = {
    limit: DEFAULTS.limit,
    kinds: [...DEFAULTS.kinds],
    mcpServers: [],
    extraPlugins: [],
    promptSection: DEFAULTS.promptSection,
    maxTaskChars: DEFAULTS.maxTaskChars
  };
  if (!isRecord(raw)) return config;

  if (Number.isInteger(raw.limit) && raw.limit >= 1 && raw.limit <= MAX_LIMIT) {
    config.limit = raw.limit;
  }
  if (Array.isArray(raw.kinds)) {
    const picked = KINDS.filter((kind) => raw.kinds.includes(kind));
    if (picked.length > 0) config.kinds = picked;
  }
  if (Array.isArray(raw.mcpServers)) config.mcpServers = raw.mcpServers.filter(isRecord);
  if (Array.isArray(raw.extraPlugins)) config.extraPlugins = raw.extraPlugins.filter(isRecord);
  if (typeof raw.promptSection === 'boolean') config.promptSection = raw.promptSection;
  if (Number.isInteger(raw.maxTaskChars) && raw.maxTaskChars >= MIN_MAX_TASK_CHARS) {
    config.maxTaskChars = raw.maxTaskChars;
  }
  return config;
}

/** Score one candidate against the task tokens; highest field weight per token wins. */
export function scoreCandidate(taskTokens, candidate) {
  const nameTokens = tokenize(candidate.id);
  const titleTokens = tokenize(candidate.title);
  const tagTokens = tokenize(candidate.tags.join(' '));
  const descriptionTokens = tokenize(candidate.description);

  let score = 0;
  const why = new Set();
  for (const token of taskTokens) {
    let weight = 0;
    if (nameTokens.has(token)) weight = 3;
    if (titleTokens.has(token) && weight < 2) weight = 2;
    if (tagTokens.has(token) && weight < 2) weight = 2;
    if (descriptionTokens.has(token) && weight < 1) weight = 1;
    if (weight === 0) continue;
    score += weight;
    why.add(token);
  }
  return { score, why: [...why].sort(compareStrings).slice(0, 4) };
}

function makeCandidate(fields) {
  return {
    kind: fields.kind,
    source: fields.source,
    id: fields.id,
    title: fields.title,
    description: fields.description ?? '',
    state: fields.state,
    tags: asStringArray(fields.tags),
    action: fields.action
  };
}

function gatherTools(ctx, agent, notes) {
  const candidates = [];
  try {
    for (const schema of ctx.tools.schemas(agent)) {
      if (!isRecord(schema) || typeof schema.name !== 'string') continue;
      if (schema.name === TOOL_NAME) continue;
      candidates.push(
        makeCandidate({
          kind: 'tool',
          source: 'available',
          id: schema.name,
          title: schema.name,
          description: typeof schema.description === 'string' ? schema.description : '',
          state: 'available',
          action: 'already available'
        })
      );
    }
  } catch (error) {
    notes.push(`tools unavailable: ${errorMessage(error)}`);
  }
  return candidates;
}

async function gatherPlugins(ctx, config, notes) {
  // Higher precedence wins a duplicate id: row > bundle > seed.
  const byId = new Map();
  const add = (candidate, precedence) => {
    const existing = byId.get(candidate.id);
    if (existing === undefined || precedence > existing.precedence) {
      byId.set(candidate.id, { candidate, precedence });
    }
  };

  for (const seed of [...PLUGIN_SEEDS, ...config.extraPlugins]) {
    if (!isRecord(seed) || typeof seed.spec !== 'string') continue;
    add(
      makeCandidate({
        kind: 'plugin',
        source: 'seed',
        id: seed.spec,
        title: seed.spec,
        description: typeof seed.description === 'string' ? seed.description : '',
        state: 'installable',
        tags: seed.tags,
        action: `plugin_manager install_bundle target="${seed.spec}"`
      }),
      1
    );
  }

  const manager = ctx.get('pluginManager');
  if (manager === undefined) {
    notes.push('pluginManager unavailable: plugin inventory not searched');
    return [...byId.values()].map((entry) => entry.candidate);
  }

  try {
    const rows = await manager.listPlugins();
    for (const row of rows) {
      if (!isRecord(row) || typeof row.moduleName !== 'string') continue;
      const id = row.patchId ?? row.entryId ?? row.moduleName;
      const meta = isRecord(row.meta) ? row.meta : {};
      const state = row.enabled === true
        ? `enabled${typeof row.fiberPhase === 'string' ? ` (${row.fiberPhase})` : ''}`
        : 'disabled';
      const readOnly = row.readOnlyReason;
      add(
        makeCandidate({
          kind: 'plugin',
          source: 'row',
          id: String(id),
          title: localizedText(meta.title) ?? row.moduleName,
          description: localizedText(meta.description) ?? '',
          state,
          action: typeof readOnly === 'string'
            ? `read-only (${readOnly})`
            : `plugin_manager set_plugin target="${String(id)}" enabled=true`
        }),
        3
      );
    }
  } catch (error) {
    notes.push(`plugin rows unavailable: ${errorMessage(error)}`);
  }

  try {
    const bundles = await manager.listBundles();
    for (const bundle of bundles) {
      if (!isRecord(bundle) || typeof bundle.name !== 'string') continue;
      const meta = isRecord(bundle.meta) ? bundle.meta : {};
      let state = 'available';
      if (bundle.enabled === true) state = 'selected';
      else if (bundle.installed === true) state = 'installed, not selected';
      else if (bundle.optional === true) state = 'available to install';
      const action = bundle.enabled === true
        ? 'already selected'
        : bundle.installed === true
          ? `plugin_manager set_bundle target="${bundle.name}" enabled=true`
          : `plugin_manager install_bundle target="${bundle.name}"`;
      add(
        makeCandidate({
          kind: 'plugin',
          source: 'bundle',
          id: bundle.name,
          title: localizedText(meta.title) ?? bundle.name,
          description:
            localizedText(meta.description) ??
            (typeof bundle.description === 'string' ? bundle.description : ''),
          state,
          action
        }),
        2
      );
    }
  } catch (error) {
    notes.push(`bundles unavailable: ${errorMessage(error)}`);
  }

  return [...byId.values()].map((entry) => entry.candidate);
}

function gatherMcp(ctx, agent, config, notes) {
  const byName = new Map();
  const add = (candidate, precedence) => {
    const existing = byName.get(candidate.id);
    if (existing === undefined || precedence > existing.precedence) {
      byName.set(candidate.id, { candidate, precedence });
    }
  };

  try {
    for (const schema of ctx.tools.schemas(agent)) {
      if (!isRecord(schema) || typeof schema.name !== 'string') continue;
      const match = /^mcp__([A-Za-z0-9_-]+)__/.exec(schema.name);
      if (match === null) continue;
      const server = match[1];
      add(
        makeCandidate({
          kind: 'mcp',
          source: 'connected',
          id: server,
          title: server,
          description: `Connected MCP server exposing ${schema.name}.`,
          state: 'connected',
          action: 'already connected'
        }),
        3
      );
    }
  } catch (error) {
    notes.push(`MCP tool scan unavailable: ${errorMessage(error)}`);
  }

  try {
    const loader = ctx.get('loader');
    if (loader !== undefined) {
      for (const entry of loader.entries()) {
        const options = isRecord(entry) ? entry.options : undefined;
        if (!isRecord(options) || options.name !== MCP_CLIENT_PACKAGE) continue;
        const rowConfig = isRecord(options.config) ? options.config : {};
        const server =
          typeof rowConfig.serverName === 'string'
            ? rowConfig.serverName
            : typeof options.id === 'string'
              ? options.id
              : 'unnamed';
        add(
          makeCandidate({
            kind: 'mcp',
            source: 'configured',
            id: server,
            title: server,
            description: `Configured MCP client row (${MCP_CLIENT_PACKAGE}).`,
            state: 'configured',
            action: 'already configured'
          }),
          2
        );
      }
    }
  } catch (error) {
    notes.push(`MCP rows unavailable: ${errorMessage(error)}`);
  }

  for (const server of mergeCatalogue(MCP_SERVERS, config.mcpServers)) {
    if (typeof server.name !== 'string') continue;
    add(
      makeCandidate({
        kind: 'mcp',
        source: 'catalog',
        id: server.name,
        title: server.name,
        description: typeof server.description === 'string' ? server.description : '',
        state: server.archived === true ? 'available (archived)' : 'available to connect',
        tags: server.tags,
        action: mcpAction(server)
      }),
      1
    );
  }

  return [...byName.values()].map((entry) => entry.candidate);
}

async function gatherSkills(ctx, agent, signal, notes) {
  const skills = ctx.get('skills');
  if (skills === undefined) {
    notes.push('skills service unavailable: skill suggestions skipped');
    return [];
  }
  const candidates = [];
  try {
    const options = { scope: agent };
    const cwd = agent?.session?.header?.cwd;
    if (typeof cwd === 'string') options.cwd = cwd;
    if (signal !== undefined) options.signal = signal;
    for (const skill of await skills.list(options)) {
      if (!isRecord(skill) || typeof skill.name !== 'string') continue;
      // The `skill` tool only loads model-invocable skills, so user-only ones are not actionable.
      if (skill.invocation?.modelInvocable !== true) continue;
      const when = typeof skill.whenToUse === 'string' ? skill.whenToUse : '';
      candidates.push(
        makeCandidate({
          kind: 'skill',
          source: 'available',
          id: skill.name,
          title: skill.name,
          description: typeof skill.description === 'string' ? skill.description : when,
          state: 'available',
          tags: when === '' ? [] : [when],
          action: `skill name="${skill.name}"`
        })
      );
    }
  } catch (error) {
    notes.push(`skills unavailable: ${errorMessage(error)}`);
  }
  return candidates;
}

/** Rank one category, falling back to a small unfiltered view when nothing matches. */
function rankKind(candidates, taskTokens, limit) {
  const scored = [];
  for (const candidate of candidates) {
    const { score, why } = scoreCandidate(taskTokens, candidate);
    if (score > 0) scored.push({ candidate, score, why });
  }
  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return compareStrings(left.candidate.id, right.candidate.id);
  });

  const selected = scored.slice(0, limit).map((entry) => ({
    ...entry.candidate,
    title: truncateField(entry.candidate.title),
    description: truncateField(entry.candidate.description),
    why: entry.why,
    score: entry.score
  }));

  if (selected.length === 0) {
    const fallback = [...candidates]
      .sort((left, right) => compareStrings(left.id, right.id))
      .slice(0, NO_MATCH_LIMIT);
    for (const candidate of fallback) {
      selected.push({
        ...candidate,
        title: truncateField(candidate.title),
        description: truncateField(candidate.description),
        why: [],
        score: 0,
        reason: 'no keyword match'
      });
    }
  }

  return { selected, omitted: Math.max(0, scored.length - selected.length) };
}

export function apply(ctx, config) {
  const settings = resolveConfig(config);
  const disposers = [];

  const tool = {
    name: TOOL_NAME,
    description:
      'Suggest tools, plugins, MCP servers, and skills that could accomplish a task. Searches the capabilities available in this session plus the ones this deployment supplies but has not enabled, and returns the closest matches with the terms that matched. Use it when a task seems to need a capability you do not currently have, before reporting that it is impossible.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        task: {
          type: 'string',
          description: 'What the user wants to accomplish, in their words or a summary of it.'
        },
        kinds: {
          type: 'array',
          items: { type: 'string', enum: KINDS },
          description: 'Which categories to search. Defaults to all of them.'
        },
        limit: {
          type: 'integer',
          description: `Maximum suggestions per category, 1-${MAX_LIMIT}. Defaults to ${DEFAULT_LIMIT}.`
        }
      },
      required: ['task']
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [
        { type: 'text', text: typeof value === 'string' ? value : String(value) }
      ]
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Suggest resources',
      kind: 'read',
      rawInput: args
    }),
    async execute(args, exec) {
      const input = isRecord(args) ? args : {};
      const rawTask = typeof input.task === 'string' ? input.task.trim() : '';
      if (rawTask === '') throw new Error('task must be a non-empty string');

      const taskTruncated = rawTask.length > settings.maxTaskChars;
      const task = taskTruncated ? rawTask.slice(0, settings.maxTaskChars) : rawTask;

      let limit = settings.limit;
      if (Number.isInteger(input.limit) && input.limit >= 1 && input.limit <= MAX_LIMIT) {
        limit = input.limit;
      }

      let kinds = settings.kinds;
      if (Array.isArray(input.kinds)) {
        const picked = KINDS.filter((kind) => input.kinds.includes(kind));
        if (picked.length > 0) kinds = picked;
      }

      const notes = [];
      if (taskTruncated) notes.push(`task truncated to ${settings.maxTaskChars} characters`);
      const taskTokens = tokenize(task);
      const agent = exec?.agent;

      const candidatesByKind = {
        tool: kinds.includes('tool') ? gatherTools(ctx, agent, notes) : [],
        plugin: kinds.includes('plugin') ? await gatherPlugins(ctx, settings, notes) : [],
        mcp: kinds.includes('mcp') ? gatherMcp(ctx, agent, settings, notes) : [],
        skill: kinds.includes('skill')
          ? await gatherSkills(ctx, agent, exec?.signal, notes)
          : []
      };

      const counts = {};
      const suggestions = [];
      const omitted = {};
      for (const kind of KINDS) {
        if (!kinds.includes(kind)) continue;
        const candidates = candidatesByKind[kind];
        counts[kind] = candidates.length;
        const ranked = rankKind(candidates, taskTokens, limit);
        suggestions.push(...ranked.selected);
        if (ranked.omitted > 0) omitted[kind] = ranked.omitted;
      }

      const result = { task, taskTruncated, counts, suggestions, omitted, notes };

      let serialized = JSON.stringify(result);
      if (serialized.length > MAX_OUTPUT_CHARS) {
        result.truncated = true;
        result.notes.push(`output truncated to ${MAX_OUTPUT_CHARS} characters`);
        while (suggestions.length > 0 && JSON.stringify(result).length > MAX_OUTPUT_CHARS) {
          suggestions.pop();
        }
        serialized = JSON.stringify(result);
      }
      return serialized;
    }
  };

  disposers.push(ctx.tools.register(tool));

  if (settings.promptSection) {
    const systemPrompt = ctx.get('systemPrompt');
    if (systemPrompt !== undefined) {
      disposers.push(
        systemPrompt.section({
          name: 'suggest-resources',
          order: PROMPT_SECTION_ORDER,
          text: ({ scope }) =>
            ctx.tools.get(TOOL_NAME, scope) === undefined
              ? ''
              : `When a task appears to need a capability that is not in your current tool list, call ${TOOL_NAME} before reporting that you cannot do it.`
        })
      );
    }
  }

  return () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // Teardown must not mask the first failure with a later one.
      }
    }
  };
}
