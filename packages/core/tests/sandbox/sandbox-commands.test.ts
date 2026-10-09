import { describe, it, expect, afterEach } from 'vitest';
import { Sandbox } from '../../src/sandbox/index.js';

describe('SandboxCommands', () => {
  let sandbox: Sandbox;

  afterEach(() => {
    sandbox?.destroy();
  });

  describe('streaming callbacks', () => {
    it('calls onStdout for each write', async () => {
      sandbox = await Sandbox.create();
      const chunks: string[] = [];
      const result = await sandbox.commands.run('echo hello', {
        onStdout: (data) => chunks.push(data),
      });
      expect(result.stdout).toBe('hello\n');
      expect(chunks.join('')).toBe('hello\n');
    });

    it('calls onStderr for errors', async () => {
      sandbox = await Sandbox.create();
      const stderrChunks: string[] = [];
      const result = await sandbox.commands.run('nonexistent_xyz', {
        onStderr: (data) => stderrChunks.push(data),
      });
      expect(result.exitCode).toBe(127);
      expect(stderrChunks.join('')).toContain('command not found');
    });
  });

  describe('stdin', () => {
    it('provides stdin to cat', async () => {
      sandbox = await Sandbox.create();
      const result = await sandbox.commands.run('cat', {
        stdin: 'hello from stdin\n',
      });
      expect(result.stdout).toContain('hello from stdin');
    });

    it('provides stdin to cat > file', async () => {
      sandbox = await Sandbox.create();
      await sandbox.commands.run('cat > /tmp/stdin-test.txt', {
        stdin: 'written via stdin\n',
      });
      const content = await sandbox.fs.readFile('/tmp/stdin-test.txt');
      expect(content).toContain('written via stdin');
    });
  });

  describe('per-call env', () => {
    it('merges env for the call', async () => {
      sandbox = await Sandbox.create();
      const result = await sandbox.commands.run('echo $MY_VAR', {
        env: { MY_VAR: 'hello' },
      });
      expect(result.stdout).toContain('hello');
    });
  });

  describe('register', () => {
    it('registers a custom command', async () => {
      sandbox = await Sandbox.create();
      sandbox.commands.register('greet', async (ctx) => {
        ctx.stdout.write(`Hello, ${ctx.args[0] ?? 'world'}!\n`);
        return 0;
      });
      const result = await sandbox.commands.run('greet Alice');
      expect(result.stdout).toBe('Hello, Alice!\n');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('abort signal and timeout', () => {
    /** Runs until its signal aborts — the shape of a long-lived server command (browser-metro). */
    const registerServe = (sb: Sandbox) =>
      sb.commands.register('serve-forever', async (ctx) => {
        ctx.stdout.write('serving\n');
        await new Promise<void>((resolve) => {
          if (ctx.signal.aborted) return resolve();
          ctx.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        ctx.stdout.write('stopped\n');
        return 130;
      });

    it('aborting the signal stops the running command', async () => {
      sandbox = await Sandbox.create();
      registerServe(sandbox);
      const ac = new AbortController();
      const run = sandbox.commands.run('serve-forever', { signal: ac.signal });
      await new Promise((r) => setTimeout(r, 20));
      ac.abort();
      const result = await Promise.race([
        run,
        new Promise<'hung'>((r) => setTimeout(() => r('hung'), 2000)),
      ]);
      expect(result).not.toBe('hung');
      expect((result as { stdout: string }).stdout).toContain('stopped');
    });

    it('a command queued behind an aborted one runs', async () => {
      sandbox = await Sandbox.create();
      registerServe(sandbox);
      const ac = new AbortController();
      void sandbox.commands.run('serve-forever', { signal: ac.signal });
      await new Promise((r) => setTimeout(r, 20));
      const next = sandbox.commands.run('echo next');
      ac.abort();
      const result = await Promise.race([
        next,
        new Promise<'hung'>((r) => setTimeout(() => r('hung'), 2000)),
      ]);
      expect(result).not.toBe('hung');
      expect((result as { stdout: string }).stdout).toBe('next\n');
    });

    it('timeout stops the running command', async () => {
      sandbox = await Sandbox.create();
      registerServe(sandbox);
      const result = await Promise.race([
        sandbox.commands.run('serve-forever', { timeout: 50 }),
        new Promise<'hung'>((r) => setTimeout(() => r('hung'), 2000)),
      ]);
      expect(result).not.toBe('hung');
    });
  });

  describe('complex commands', () => {
    it('variable expansion', async () => {
      sandbox = await Sandbox.create();
      const result = await sandbox.commands.run('echo $HOME');
      expect(result.stdout).toBe('/home/user\n');
    });

    it('command substitution with default values', async () => {
      sandbox = await Sandbox.create();
      const result = await sandbox.commands.run('echo ${MISSING:-fallback}');
      expect(result.stdout).toBe('fallback\n');
    });

    it('semicolon chaining', async () => {
      sandbox = await Sandbox.create();
      const result = await sandbox.commands.run('echo a ; echo b');
      expect(result.stdout).toContain('a');
      expect(result.stdout).toContain('b');
    });

    it('|| operator runs on failure', async () => {
      sandbox = await Sandbox.create();
      const result = await sandbox.commands.run('false || echo fallback');
      expect(result.stdout).toContain('fallback');
    });

    it('&& stops on failure', async () => {
      sandbox = await Sandbox.create();
      const result = await sandbox.commands.run('false && echo nope');
      expect(result.stdout).not.toContain('nope');
    });
  });
});
