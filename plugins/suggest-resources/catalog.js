/**
 * Static suggestion data for the suggest-resources plugin.
 *
 * This module deliberately has no imports so the bundle stays dependency-free.
 * Everything here is *seed* data: live inventory from `ctx.pluginManager` and
 * `ctx.tools` always takes precedence. Entries are suggestions, never actions.
 */

/**
 * Curated starter catalogue of Model Context Protocol servers.
 *
 * Source: https://modelcontextprotocol.io/examples — the official reference
 * servers. This list is a hand-maintained snapshot; the URL above is the
 * authority. Verify a server before connecting it.
 *
 * `transport`, `command`, and `args` are ready to paste into an
 * `@deepseek-ai/dsh-mcp-client` row. Placeholders in `args` must be replaced.
 * `envHint` names an environment variable only — never put a secret value in
 * configuration or in conversation text.
 */
export const MCP_SERVERS = [
  {
    name: 'filesystem',
    description:
      'Secure file operations (read, write, move, search) confined to directories you explicitly allow.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '<allowed-directory>'],
    tags: ['files', 'filesystem', 'read', 'write', 'search', 'directory', 'disk'],
    source: 'https://modelcontextprotocol.io/examples'
  },
  {
    name: 'fetch',
    description:
      'Fetch a URL and convert its content to markdown for efficient model consumption.',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    tags: ['web', 'fetch', 'http', 'url', 'scrape', 'markdown', 'page'],
    source: 'https://modelcontextprotocol.io/examples'
  },
  {
    name: 'git',
    description: 'Read, search, and manipulate a Git repository: log, diff, commit, branch.',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-git', '--repository', '<path-to-repo>'],
    tags: ['git', 'repository', 'commit', 'diff', 'branch', 'history', 'version-control'],
    source: 'https://modelcontextprotocol.io/examples'
  },
  {
    name: 'memory',
    description:
      'Knowledge-graph based persistent memory that survives across sessions.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    tags: ['memory', 'knowledge', 'graph', 'remember', 'persist', 'notes'],
    source: 'https://modelcontextprotocol.io/examples'
  },
  {
    name: 'sequentialthinking',
    description:
      'Dynamic, reflective problem-solving through an explicit sequence of thoughts.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequentialthinking'],
    tags: ['reasoning', 'thinking', 'planning', 'problem-solving', 'decompose'],
    source: 'https://modelcontextprotocol.io/examples'
  },
  {
    name: 'time',
    description: 'Current time and timezone conversion.',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-time'],
    tags: ['time', 'date', 'timezone', 'clock', 'convert'],
    source: 'https://modelcontextprotocol.io/examples'
  },
  {
    name: 'everything',
    description:
      'Reference and test server exposing prompts, resources, and tools; useful for validating an MCP connection.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
    tags: ['test', 'reference', 'demo', 'diagnostic', 'example'],
    source: 'https://modelcontextprotocol.io/examples'
  },
  {
    name: 'github',
    description:
      'GitHub API access: issues, pull requests, and repository contents. Archived by the MCP project and no longer actively maintained; prefer a current integration if one exists.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    envHint: 'GITHUB_PERSONAL_ACCESS_TOKEN',
    archived: true,
    tags: ['github', 'issues', 'pull-request', 'repository', 'code-review'],
    source: 'https://modelcontextprotocol.io/examples'
  }
];

/**
 * Seed plugin suggestions used when the profile's live bundle inventory has no
 * keyword match. Live `ctx.pluginManager.listBundles()` remains the authority;
 * this list only helps the model discover opt-in layers it might not think to
 * look for. `spec` is a package name the profile can select.
 */
export const PLUGIN_SEEDS = [
  {
    spec: '@deepseek-ai/dsh-experimental-schedule-bundle',
    description: 'Scheduled and recurring task automation for a session.',
    tags: ['schedule', 'scheduled', 'recurring', 'cron', 'timer', 'automation', 'periodic']
  },
  {
    spec: '@deepseek-ai/dsh-experimental-voice-input-bundle',
    description: 'Voice input for the composer.',
    tags: ['voice', 'speech', 'audio', 'dictation', 'microphone', 'transcribe']
  }
];
