/**
 * Best-effort foreground AI process detection for local PTYs.
 * Walks the process tree under the shell PID looking for claude / codex.
 *
 * All calls are async (execFile) so they never block the Electron main event loop.
 */
import { execFile } from 'node:child_process'
import { getLogger } from './logger.js'

const log = getLogger()

export type AiProcessName = 'claude' | 'codex'

function execAsync(
  cmd: string,
  args: string[],
  opts: { timeout: number; maxBuffer: number }
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: 'utf8', ...opts }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

/**
 * Return 'claude' | 'codex' if a matching descendant is running under `rootPid`,
 * otherwise undefined (plain shell / unknown).
 */
export async function findAiChildProcess(rootPid: number): Promise<AiProcessName | undefined> {
  if (!rootPid || rootPid < 2) return undefined
  if (process.platform === 'win32') return findAiChildProcessWin(rootPid)
  return findAiChildProcessUnix(rootPid, 0)
}

async function findAiChildProcessUnix(rootPid: number, depth: number): Promise<AiProcessName | undefined> {
  if (depth > 8) return undefined
  let childPids: number[] = []
  try {
    const out = await execAsync('pgrep', ['-P', String(rootPid)], {
      timeout: 400,
      maxBuffer: 64 * 1024
    })
    childPids = out
      .trim()
      .split(/\s+/)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n > 1)
  } catch {
    return undefined
  }

  for (const pid of childPids) {
    const hit = await classifyPid(pid)
    if (hit) return hit
    const nested = await findAiChildProcessUnix(pid, depth + 1)
    if (nested) return nested
  }
  return undefined
}

async function classifyPid(pid: number): Promise<AiProcessName | undefined> {
  try {
    const out = await execAsync('ps', ['-o', 'comm=,args=', '-p', String(pid)], {
      timeout: 400,
      maxBuffer: 32 * 1024
    })
    return classifyCommandLine(out.trim())
  } catch {
    return undefined
  }
}

async function findAiChildProcessWin(rootPid: number): Promise<AiProcessName | undefined> {
  try {
    const script = [
      `$p = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${rootPid} };`,
      `while ($p) {`,
      `  foreach ($x in $p) { Write-Output $x.Name; Write-Output $x.CommandLine };`,
      `  $ids = $p | ForEach-Object { $_.ProcessId };`,
      `  $p = Get-CimInstance Win32_Process | Where-Object { $ids -contains $_.ParentProcessId };`,
      `}`
    ].join(' ')
    const out = await execAsync(
      'powershell.exe',
      ['-NoProfile', '-Command', script],
      { timeout: 1500, maxBuffer: 256 * 1024 }
    )
    return classifyCommandLine(out)
  } catch (e) {
    log.warn('provider-process', 'windows probe failed', { err: e as Error })
    return undefined
  }
}

/** Exported for unit tests. */
export function classifyCommandLine(text: string): AiProcessName | undefined {
  const s = text.toLowerCase()
  if (/(^|\/|\\|\s)claude(\s|$|\.exe)/.test(s) || s.includes('claude-code') || s.includes('@anthropic')) {
    return 'claude'
  }
  if (/(^|\/|\\|\s)codex(\s|$|\.exe)/.test(s) || s.includes('openai-codex')) {
    return 'codex'
  }
  return undefined
}
