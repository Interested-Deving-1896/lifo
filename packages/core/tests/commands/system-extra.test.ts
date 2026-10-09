import { describe, it, expect } from 'vitest';
import { VFS } from '../../src/kernel/vfs/index.js';
import { ProcessRegistry } from '../../src/shell/ProcessRegistry.js';
import { CommandRegistry } from '../../src/commands/registry.js';
import type { CommandContext, CommandOutputStream, CommandInputStream } from '../../src/commands/types.js';

function createContext(
  vfs: VFS,
  args: string[],
  cwd = '/',
  stdin?: CommandInputStream,
): CommandContext & { stdout: CommandOutputStream & { text: string }; stderr: CommandOutputStream & { text: string } } {
  const stdout = { text: '', write(t: string) { this.text += t; } };
  const stderr = { text: '', write(t: string) { this.text += t; } };
  return {
    args,
    env: { HOME: '/home/user', USER: 'user', HOSTNAME: 'lifo' },
    cwd,
    vfs,
    stdout,
    stderr,
    signal: new AbortController().signal,
    stdin,
  };
}

/** A registry holding a shell, the way Shell.start() registers itself. */
function createProcessRegistry(): ProcessRegistry {
  const registry = new ProcessRegistry();
  registry.spawn({
    command: 'shell', args: ['shell'], cwd: '/home/user', env: {},
    isForeground: true, promise: new Promise(() => {}), abortController: new AbortController(),
  });
  return registry;
}

/** Spawn a never-ending background job; returns its pid and abort controller. */
function spawnSleep(registry: ProcessRegistry): { pid: number; ac: AbortController } {
  const ac = new AbortController();
  const pid = registry.spawn({
    command: 'sleep', args: ['sleep', '100'], cwd: '/home/user', env: {},
    isForeground: false, promise: new Promise(() => {}), abortController: ac,
  });
  return { pid, ac };
}

describe('ps', () => {
  it('shows the shell with no jobs', async () => {
    const { createPsCommand } = await import('../../src/commands/system/ps.js');
    const ps = createPsCommand(createProcessRegistry());
    const ctx = createContext(new VFS(), []);
    const code = await ps(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('PID');
    expect(ctx.stdout.text).toContain('shell');
  });

  it('shows background jobs', async () => {
    const registry = createProcessRegistry();
    spawnSleep(registry);
    const { createPsCommand } = await import('../../src/commands/system/ps.js');
    const ps = createPsCommand(registry);
    const ctx = createContext(new VFS(), []);
    const code = await ps(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('sleep');
  });
});

describe('top', () => {
  it('shows system snapshot', async () => {
    const { createTopCommand } = await import('../../src/commands/system/top.js');
    const top = createTopCommand(createProcessRegistry());
    const ctx = createContext(new VFS(), []);
    const code = await top(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('top');
    expect(ctx.stdout.text).toContain('Tasks');
    expect(ctx.stdout.text).toContain('shell');
    expect(ctx.stdout.text).toContain('PID');
  });
});

describe('kill', () => {
  it('kills a job by %N', async () => {
    const registry = createProcessRegistry();
    const { ac } = spawnSleep(registry);
    const { createKillCommand } = await import('../../src/commands/system/kill.js');
    const kill = createKillCommand(registry);
    const ctx = createContext(new VFS(), ['%1']);
    const code = await kill(ctx);
    expect(code).toBe(0);
    expect(ac.signal.aborted).toBe(true);
  });

  it('kills a job by PID', async () => {
    const registry = createProcessRegistry();
    const { pid, ac } = spawnSleep(registry);
    const { createKillCommand } = await import('../../src/commands/system/kill.js');
    const kill = createKillCommand(registry);
    const ctx = createContext(new VFS(), [String(pid)]);
    const code = await kill(ctx);
    expect(code).toBe(0);
    expect(ac.signal.aborted).toBe(true);
  });

  it('refuses to kill the shell', async () => {
    const registry = createProcessRegistry();
    const shellPid = registry.getAll().find((p) => p.command === 'shell')!.pid;
    const { createKillCommand } = await import('../../src/commands/system/kill.js');
    const kill = createKillCommand(registry);
    const ctx = createContext(new VFS(), [String(shellPid)]);
    const code = await kill(ctx);
    expect(code).toBe(1);
    expect(ctx.stderr.text).toContain('not permitted');
  });

  it('lists signals with -l', async () => {
    const { createKillCommand } = await import('../../src/commands/system/kill.js');
    const kill = createKillCommand(createProcessRegistry());
    const ctx = createContext(new VFS(), ['-l']);
    const code = await kill(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('TERM');
    expect(ctx.stdout.text).toContain('KILL');
  });

  it('errors on non-existent job', async () => {
    const { createKillCommand } = await import('../../src/commands/system/kill.js');
    const kill = createKillCommand(createProcessRegistry());
    const ctx = createContext(new VFS(), ['%99']);
    const code = await kill(ctx);
    expect(code).toBe(1);
    expect(ctx.stderr.text).toContain('no such job');
  });

  it('errors on non-existent pid', async () => {
    const { createKillCommand } = await import('../../src/commands/system/kill.js');
    const kill = createKillCommand(createProcessRegistry());
    const ctx = createContext(new VFS(), ['999']);
    const code = await kill(ctx);
    expect(code).toBe(1);
    expect(ctx.stderr.text).toContain('No such process');
  });
});

describe('help', () => {
  it('lists commands grouped by category', async () => {
    const registry = new CommandRegistry();
    registry.register('ls', async () => 0);
    registry.register('cat', async () => 0);
    const { createHelpCommand } = await import('../../src/commands/system/help.js');
    const help = createHelpCommand(registry);
    const vfs = new VFS();
    const ctx = createContext(vfs, []);
    const code = await help(ctx);
    expect(code).toBe(0);
    expect(ctx.stdout.text).toContain('Lifo Commands');
    expect(ctx.stdout.text).toContain('File system');
    expect(ctx.stdout.text).toContain('Shell builtins');
    expect(ctx.stdout.text).toContain('ls');
  });
});

describe('watch', () => {
  it('errors with no command', async () => {
    const registry = new CommandRegistry();
    const { createWatchCommand } = await import('../../src/commands/system/watch.js');
    const watch = createWatchCommand(registry);
    const vfs = new VFS();
    const ctx = createContext(vfs, []);
    const code = await watch(ctx);
    expect(code).toBe(1);
    expect(ctx.stderr.text).toContain('missing command');
  });

  it('errors on unknown command', async () => {
    const registry = new CommandRegistry();
    const { createWatchCommand } = await import('../../src/commands/system/watch.js');
    const watch = createWatchCommand(registry);
    const vfs = new VFS();
    const ctx = createContext(vfs, ['nonexistent']);
    const code = await watch(ctx);
    expect(code).toBe(1);
    expect(ctx.stderr.text).toContain('command not found');
  });
});
