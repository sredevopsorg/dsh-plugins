// A scripted stand-in for `opencode acp`, used by the runner tests.
//
// Emits newline-delimited JSON-RPC on stdout and exits when stdin closes,
// matching `opencode acp`'s documented lifecycle: "it exits when the client
// closes stdin". The process never arms a self-timer for hold scenarios, so a
// leaked child would keep `node --test` alive and fail the suite loudly.
const scenario = JSON.parse(process.argv[2] ?? '{}')
const sessionId = scenario.sessionId ?? 'ses_fake'

const write = (message) => process.stdout.write(JSON.stringify(message) + '\n')
const reply = (id, result) => write({ jsonrpc: '2.0', id, result })
const update = (body) => write({
  jsonrpc: '2.0',
  method: 'session/update',
  params: { sessionId, update: body },
})
const chunk = (text) => update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })

let buffer = ''
/** Client capabilities announced by `initialize`, when a scenario asks for them. */
let capabilities = 'none'
process.stdin.on('data', (data) => {
  buffer += data
  let newline
  while ((newline = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newline)
    buffer = buffer.slice(newline + 1)
    if (line.trim() !== '') handle(JSON.parse(line))
  }
})
process.stdin.on('end', () => process.exit(0))
process.stdin.on('close', () => process.exit(0))

function handle(message) {
  const { id, method, params } = message
  // A response to one of our own requests (the permission reply) has no method.
  if (method === undefined) return

  switch (method) {
    case 'initialize':
      if (scenario.failInitialize === true) {
        return write({ jsonrpc: '2.0', id, error: { code: -32603, message: 'Internal error' } })
      }
      // `echoClientCapabilities` copies what the client advertised into a value
      // the test can read back from the assistant's final text.
      if (scenario.echoClientCapabilities === true) {
        capabilities = JSON.stringify(params?.clientCapabilities ?? null)
      }
      return reply(id, { protocolVersion: 1, agentCapabilities: {} })

    case 'session/new':
      if (scenario.failSessionNew !== undefined) {
        return write({ jsonrpc: '2.0', id, error: scenario.failSessionNew })
      }
      return reply(id, { sessionId, configOptions: [] })

    case 'session/set_config_option':
      if (scenario.rejectConfigOption === true) {
        return write({ jsonrpc: '2.0', id, error: { code: -32602, message: `unknown config option: ${params.configId}` } })
      }
      return reply(id, {})

    case 'session/prompt': {
      requestPermission(id)
      chunk('Hello from ')
      update({ sessionUpdate: 'tool_call', toolCallId: 'call-1', title: 'Read src/index.js', kind: 'read' })
      chunk('fake OpenCode.')
      if (scenario.echoClientCapabilities === true) chunk(` capabilities=${capabilities}`)
      if (scenario.exitDuringPrompt === true) {
        setTimeout(() => process.exit(3), 10)
        return
      }
      // `holdPrompt` never answers: the client must cancel, then close stdin.
      if (scenario.holdPrompt === true) return
      return reply(id, { stopReason: scenario.stopReason ?? 'end_turn' })
    }

    case 'session/cancel':
      // Cancelling a held prompt answers it once with the cancelled reason.
      if (heldPromptId !== undefined) {
        const held = heldPromptId
        heldPromptId = undefined
        reply(held, { stopReason: 'cancelled' })
      }
      return

    default:
      if (id !== undefined) reply(id, {})
  }
}

let heldPromptId
function requestPermission(promptId) {
  if (scenario.askPermission !== true) return
  if (scenario.holdPrompt === true) heldPromptId = promptId
  write({
    jsonrpc: '2.0',
    id: `perm-${promptId}`,
    method: 'session/request_permission',
    params: {
      sessionId,
      toolCall: { toolCallId: 'call-1' },
      options: [
        { optionId: 'once', kind: 'allow_once', name: 'Allow once' },
        { optionId: 'always', kind: 'allow_always', name: 'Always allow' },
        { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
      ],
    },
  })
}
