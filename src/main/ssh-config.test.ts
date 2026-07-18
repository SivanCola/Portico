import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import {
  parseSshConfig,
  resolveAlias,
  listHostAliases,
  loadSshConfig
} from './ssh-config.js'

describe('parseSshConfig', () => {
  it('parses a full host block with all supported directives', () => {
    const cfg = parseSshConfig(`
      Host noban-vm
        HostName relay.example.com
        Port 10049
        User root
        IdentityFile ~/.ssh/noban.pem
    `)
    expect(cfg).toHaveLength(1)
    expect(cfg[0].patterns).toEqual(['noban-vm'])
    expect(cfg[0].hostName).toBe('relay.example.com')
    expect(cfg[0].port).toBe(10049)
    expect(cfg[0].user).toBe('root')
    expect(cfg[0].identityFile).toBe(join(homedir(), '.ssh', 'noban.pem'))
  })

  it('ignores directives that appear before any Host line', () => {
    const cfg = parseSshConfig(`User ignored\nHost real\n  User kept\n`)
    expect(cfg[0].user).toBe('kept')
  })

  it('strips inline comments', () => {
    const cfg = parseSshConfig(`Host foo # this is a comment\n  HostName bar # inline\n`)
    expect(cfg[0].patterns).toEqual(['foo'])
    expect(cfg[0].hostName).toBe('bar')
  })

  it('skips blank and comment-only lines', () => {
    const cfg = parseSshConfig(`\n# just a comment\nHost foo\n  HostName bar\n`)
    expect(cfg).toHaveLength(1)
    expect(cfg[0].patterns).toEqual(['foo'])
  })

  it('allows multiple Host tokens sharing one block', () => {
    const cfg = parseSshConfig(`Host alpha bravo\n  HostName shared\n`)
    expect(cfg[0].patterns).toEqual(['alpha', 'bravo'])
  })

  it('ignores invalid Port values', () => {
    const cfg = parseSshConfig(`Host foo\n  Port notanumber\n`)
    expect(cfg[0].port).toBeUndefined()
  })
})

describe('resolveAlias', () => {
  it('expands a fully-specified alias', async () => {
    const cfg = parseSshConfig(`
      Host noban-vm
        HostName relay.example.com
        Port 10049
        User root
        IdentityFile ~/.ssh/noban.pem
    `)
    const r = await resolveAlias('noban-vm', cfg)
    expect(r).toMatchObject({
      matched: true,
      host: 'relay.example.com',
      port: 10049,
      user: 'root'
    })
  })

  it('defaults host to the alias when HostName is absent', async () => {
    const cfg = parseSshConfig(`Host mybox\n  User ubuntu\n`)
    const r = await resolveAlias('mybox', cfg)
    expect(r.host).toBe('mybox')
    expect(r.user).toBe('ubuntu')
    expect(r.port).toBe(22) // default
  })

  it('reports matched=false for an unknown alias', async () => {
    const cfg = parseSshConfig(`Host foo\n  HostName bar\n`)
    const r = await resolveAlias('nope', cfg)
    expect(r.matched).toBe(false)
    // host falls back to the verbatim alias so a manual entry still works
    expect(r.host).toBe('nope')
  })

  it('honors glob patterns as a fallback match', async () => {
    const cfg = parseSshConfig(`
      Host *.internal
        User deploy
        Port 2222
    `)
    const r = await resolveAlias('db.internal', cfg)
    expect(r.matched).toBe(true)
    expect(r.user).toBe('deploy')
    expect(r.port).toBe(2222)
    // HostName absent → alias verbatim
    expect(r.host).toBe('db.internal')
  })

  it('applies first-match-wins per key across multiple blocks', async () => {
    // OpenSSH walks every matching block; each key takes its first value.
    const cfg = parseSshConfig(`
      Host prod-*
        User produser
        Port 2200
      Host prod-db
        HostName db.prod.example.com
        Port 22
    `)
    const r = await resolveAlias('prod-db', cfg)
    // First block wins for User and Port (its values come first).
    expect(r.user).toBe('produser')
    expect(r.port).toBe(2200)
    // HostName only set in the second block.
    expect(r.host).toBe('db.prod.example.com')
  })

  it('takes the first IdentityFile among matching blocks', async () => {
    const cfg = parseSshConfig(`
      Host shared
        IdentityFile ~/.ssh/a
      Host shared
        IdentityFile ~/.ssh/b
    `)
    const r = await resolveAlias('shared', cfg)
    expect(r.identityFile).toBe(join(homedir(), '.ssh', 'a'))
  })
})

describe('listHostAliases', () => {
  it('returns literal host tokens only, dropping globs', async () => {
    const cfg = parseSshConfig(`
      Host noban-vm
        HostName relay.example.com
      Host *.internal
        User deploy
      Host gitlab
        HostName git.company.com
    `)
    const aliases = await listHostAliases(cfg)
    expect(aliases.map((a) => a.alias)).toEqual(['noban-vm', 'gitlab'])
    expect(aliases[0]).toMatchObject({
      alias: 'noban-vm',
      hostName: 'relay.example.com'
    })
  })

  it('dedupes repeated aliases', async () => {
    const cfg = parseSshConfig(`Host foo\nHost foo\n  HostName bar\n`)
    const aliases = await listHostAliases(cfg)
    expect(aliases).toHaveLength(1)
    expect(aliases[0].alias).toBe('foo')
  })
})

describe('loadSshConfig (filesystem + Include)', () => {
  let dir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'portico-ssh-'))
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('expands Include with a glob and merges the included blocks', async () => {
    writeFileSync(
      join(dir, 'config'),
      ['Include config.d/*', 'Host top-level', '  HostName top.example.com'].join('\n')
    )
    mkdirSync(join(dir, 'config.d'), { recursive: true })
    writeFileSync(
      join(dir, 'config.d', 'noban'),
      ['Host noban-vm', '  HostName relay.example.com', '  Port 10049', '  User root'].join('\n')
    )

    const cfg = await loadSshConfig(dir)
    const r = await resolveAlias('noban-vm', cfg)
    expect(r).toMatchObject({
      matched: true,
      host: 'relay.example.com',
      port: 10049,
      user: 'root'
    })
    // The top-level block from the main file is still present.
    expect((await resolveAlias('top-level', cfg)).host).toBe('top.example.com')
  })

  it('expands Include inline so trailing Host * does not steal earlier values', async () => {
    // Classic OpenSSH layout: specific hosts via Include, then Host * defaults.
    // If Include were appended after the whole file, Host * would win User.
    const orderDir = join(dir, 'include-order')
    mkdirSync(join(orderDir, 'config.d'), { recursive: true })
    writeFileSync(
      join(orderDir, 'config'),
      ['Include config.d/*', 'Host *', '  User wrong', '  Port 22'].join('\n')
    )
    writeFileSync(
      join(orderDir, 'config.d', 'myserver'),
      ['Host myserver', '  HostName 10.0.0.4', '  User correct', '  Port 2222'].join('\n')
    )

    const cfg = await loadSshConfig(orderDir)
    // Included block must appear before Host * in the merged list.
    const patterns = cfg.map((b) => b.patterns.join(','))
    expect(patterns.indexOf('myserver')).toBeLessThan(patterns.indexOf('*'))

    const r = await resolveAlias('myserver', cfg)
    expect(r).toMatchObject({
      matched: true,
      host: '10.0.0.4',
      user: 'correct',
      port: 2222
    })
  })

  it('returns an empty config when the config file is missing', async () => {
    const empty = await loadSshConfig(join(dir, 'does-not-exist'))
    expect(empty).toEqual([])
    expect(await listHostAliases(empty)).toEqual([])
  })

  it('stops on include cycles without hanging', async () => {
    const cyclicDir = join(dir, 'cyclic-root')
    mkdirSync(cyclicDir, { recursive: true })
    // config includes b, b includes config — must terminate via seen-set / cap.
    writeFileSync(join(cyclicDir, 'config'), 'Include sub/b\nHost a-host\n  HostName a\n')
    mkdirSync(join(cyclicDir, 'sub'), { recursive: true })
    writeFileSync(join(cyclicDir, 'sub', 'b'), 'Include ../config\nHost b-host\n  HostName b\n')

    const cfg = await loadSshConfig(cyclicDir)
    // Should not throw or hang; at least one host resolves.
    expect((await resolveAlias('a-host', cfg)).host).toBe('a')
    expect((await resolveAlias('b-host', cfg)).host).toBe('b')
  })
})
