/**
 * Best-effort foreground AI process detection for local PTYs.
 * Walks the process tree under the shell PID looking for claude / codex.
 */
import { execFileSync } from 'node:child_process'
import { getLogger } from './logger.js'

const log = getLogger()

export type AiProcessName = 'claude' | 'codex'

/**
 * Return 'claude' | 'codex' if a matching descendant is running under `rootPid`,
 * otherwise undefined (plain shell / unknown).
 */
export function findAiChildProcess(rootPid: number): AiProcessName | undefined {
  if (!rootPid || rootPid < 2) return undefined
  if (process.platform === 'win32') return findAiChildProcessWin(rootPid)
  return findAiChildProcessUnix(rootPid, 0)
}

function findAiChildProcessUnix(rootPid: number, depth: number): AiProcessName | undefined {
  if (depth > 8) return undefined
  let childPids: number[] = []
  try {
    const out = execFileSync('pgrep', ['-P', String(rootPid)], {
      encoding: 'utf8',
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
    const hit = classifyPid(pid)
    if (hit) return hit
    const nested = findAiChildProcessUnix(pid, depth + 1)
    if (nested) return nested
  }
  return undefined
}

function classifyPid(pid: number): AiProcessName | undefined {
  try {
    // comm + args so "node …/claude" still matches
    const out = execFileSync('ps', ['-o', 'comm=,args=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 400,
      maxBuffer: 32 * 1024
    }).trim()
    return classifyCommandLine(out)
  } catch {
    return undefined
  }
}

function findAiChildProcessWin(rootPid: number): AiProcessName | undefined {
  try {
    // PowerShell one-liner: list child process names under root
    const script = [
      `$p = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${rootPid} };`,
      `while ($p) {`,
      `  foreach ($x in $p) { Write-Output $x.Name; Write-Output $x.CommandLine };`,
      `  $ids = $p | ForEach-Object { $_.ProcessId };`,
      `  $p = Get-CimInstance Win32_Process | Where-Object { $ids -contains $_.ParentProcessId };`,
      `}`
    ].join(' ')
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', script],
      { encoding: 'utf8', timeout: 1500, maxBuffer: 256 * 1024 }
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
  // Prefer claude if both appear (rare).
  if (/(^|\/|\\|\s)claude(\s|$|\.exe)/.test(s) || s.includes('claude-code') || s.includes('@anthropic')) {
    return 'claude'
  }
  if (/(^|\/|\\|\s)codex(\s|$|\.exe)/.test(s) || s.includes('openai-codex')) {
    return 'codex'
  }
  return undefined
}
