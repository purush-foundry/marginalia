import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createRunner, hashSkill, type AgentOptions } from './agent'
import { loadToken } from './papers'
import { HOST_VERSION } from './protocol'
import { createServer } from './server'

const DEV_APP = 'http://localhost:5173'
const EFFORTS = ['low', 'medium', 'high'] as const

// Expands a leading `~` to the home directory.
const expandHome = (p: string) => (p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p)

// Copies KEY=value lines from the env file into process.env for keys not already set.
function loadEnvFile(file: string): void {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (process.env[key] === undefined) process.env[key] = line.slice(eq + 1).trim()
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: '7700' },
      token: { type: 'string' },
      'new-token': { type: 'boolean', default: false },
      app: { type: 'string', default: 'https://purush-foundry.github.io' },
      'allow-bash': { type: 'boolean', default: false },
      model: { type: 'string', default: 'claude-opus-5-5' },
      effort: { type: 'string', default: 'medium' },
      root: { type: 'string', default: '~/.marginalia' },
      repo: { type: 'string', default: fileURLToPath(new URL('../../', import.meta.url)) },
    },
  })
  const port = Number(values.port)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`invalid --port ${values.port}`)
  const effort = EFFORTS.find((e) => e === values.effort)
  if (!effort) throw new Error(`--effort must be one of ${EFFORTS.join(', ')}`)
  const app = values.app.replace(/\/+$/, '')
  const root = path.resolve(expandHome(values.root))
  const repoDir = path.resolve(expandHome(values.repo))

  loadEnvFile(path.join(os.homedir(), '.config', 'marginalia', 'host.env'))
  const auth: AgentOptions['auth'] = process.env.ANTHROPIC_API_KEY ? 'api-key' : process.env.CLAUDE_CODE_OAUTH_TOKEN ? 'oauth-token' : 'none'
  const token = values.token ?? (await loadToken(root, values['new-token']))

  const runner = createRunner({ root, repoDir, model: values.model, effort, allowBash: values['allow-bash'], skillHash: hashSkill(repoDir) ?? 'missing', auth })
  const origins = [...new Set([new URL(app).origin, DEV_APP])]
  const server = createServer({ runner, token, origins, root })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })

  const bound = (server.address() as AddressInfo).port
  console.log(`marginalia-host ${HOST_VERSION} on http://127.0.0.1:${bound}`)
  console.log(`auth: ${auth}`)
  if (auth === 'none') console.log('warning: no ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN found; agent runs will fail')
  console.log(app === DEV_APP ? `Pair: ${DEV_APP}/#/pair/${token}` : `Pair: ${app}/marginalia/#/pair/${token}`)

  const shutdown = () => {
    server.closeAllConnections()
    server.close(() => process.exit(0))
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
