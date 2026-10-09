import { describe, it, expect, beforeEach } from 'vitest';
import { ProcessRegistry } from './ProcessRegistry.js';

/** Register a shell the way Shell.start() does; returns its PID. */
function spawnShell(registry: ProcessRegistry, cwd = '/home/user', env: Record<string, string> = {}): number {
  return registry.spawn({
    command: 'shell',
    args: ['shell'],
    cwd,
    env,
    isForeground: true,
    promise: new Promise(() => {}),
    abortController: new AbortController(),
  });
}

describe('ProcessRegistry', () => {
  let registry: ProcessRegistry;
  let shellPid: number;

  beforeEach(() => {
    registry = new ProcessRegistry();
  });

  describe('shell registration', () => {
    it('registerShell is a deprecated no-op', () => {
      registry.registerShell('/home/user', { HOME: '/home/user' });
      expect(registry.count()).toBe(0);
    });

    it('a shell registers itself via spawn with its cwd and env', () => {
      const env = { HOME: '/home/user', PATH: '/bin' };
      const pid = spawnShell(registry, '/home/user', env);

      const shell = registry.get(pid);
      expect(shell?.command).toBe('shell');
      expect(shell?.status).toBe('running');
      expect(shell?.isForeground).toBe(true);
      expect(shell?.cwd).toBe('/home/user');
      expect(shell?.env).toEqual(env);
    });
  });

  describe('spawn', () => {
    beforeEach(() => {
      shellPid = spawnShell(registry);
    });

    it('should assign sequential PIDs after the shell', () => {
      const pid1 = registry.spawn({
        command: 'ls',
        args: ['ls'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      const pid2 = registry.spawn({
        command: 'pwd',
        args: ['pwd'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      expect(pid1).toBe(shellPid + 1);
      expect(pid2).toBe(shellPid + 2);
    });

    it('should assign job IDs only to background processes', () => {
      const fgPid = registry.spawn({
        command: 'fg-cmd',
        args: ['fg-cmd'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      const bgPid = registry.spawn({
        command: 'bg-cmd',
        args: ['bg-cmd'],
        cwd: '/home',
        env: {},
        isForeground: false,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      const fgProc = registry.get(fgPid);
      const bgProc = registry.get(bgPid);

      expect(fgProc?.jobId).toBeUndefined();
      expect(bgProc?.jobId).toBe(1);
    });

    it('should set initial status to running', () => {
      const pid = registry.spawn({
        command: 'test',
        args: ['test'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      const proc = registry.get(pid);
      expect(proc?.status).toBe('running');
      expect(proc?.exitCode).toBeNull();
    });

    it('should update to zombie status when promise resolves', async () => {
      const pid = registry.spawn({
        command: 'test',
        args: ['test'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: Promise.resolve(42),
        abortController: new AbortController(),
      });

      // Wait for promise to resolve
      await new Promise(resolve => setTimeout(resolve, 10));

      const proc = registry.get(pid);
      expect(proc?.status).toBe('zombie');
      expect(proc?.exitCode).toBe(42);
    });

    it('should set ppid to 1 by default', () => {
      const pid = registry.spawn({
        command: 'test',
        args: ['test'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      const proc = registry.get(pid);
      expect(proc?.ppid).toBe(1);
    });

    it('should allow custom ppid', () => {
      const pid = registry.spawn({
        command: 'test',
        args: ['test'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
        ppid: 5,
      });

      const proc = registry.get(pid);
      expect(proc?.ppid).toBe(5);
    });
  });

  describe('get and has', () => {
    beforeEach(() => {
      shellPid = spawnShell(registry);
    });

    it('should retrieve process by PID', () => {
      const pid = registry.spawn({
        command: 'test',
        args: ['test'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      const proc = registry.get(pid);
      expect(proc).toBeDefined();
      expect(proc?.pid).toBe(pid);
      expect(proc?.command).toBe('test');
    });

    it('should return undefined for non-existent PID', () => {
      const proc = registry.get(999);
      expect(proc).toBeUndefined();
    });

    it('should check if process exists', () => {
      const pid = registry.spawn({
        command: 'test',
        args: ['test'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      expect(registry.has(pid)).toBe(true);
      expect(registry.has(999)).toBe(false);
    });
  });

  describe('getByJobId', () => {
    beforeEach(() => {
      shellPid = spawnShell(registry);
    });

    it('should retrieve background process by job ID', () => {
      const pid = registry.spawn({
        command: 'bg-cmd',
        args: ['bg-cmd'],
        cwd: '/home',
        env: {},
        isForeground: false,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      const proc = registry.getByJobId(1);
      expect(proc).toBeDefined();
      expect(proc?.pid).toBe(pid);
      expect(proc?.jobId).toBe(1);
    });

    it('should return undefined for non-existent job ID', () => {
      const proc = registry.getByJobId(999);
      expect(proc).toBeUndefined();
    });

    it('should not find foreground processes by job ID', () => {
      registry.spawn({
        command: 'fg-cmd',
        args: ['fg-cmd'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      const proc = registry.getByJobId(1);
      expect(proc).toBeUndefined();
    });
  });

  describe('getAllPIDs and getAll', () => {
    beforeEach(() => {
      shellPid = spawnShell(registry);
    });

    it('should return all PIDs in sorted order', () => {
      registry.spawn({
        command: 'cmd1',
        args: ['cmd1'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      registry.spawn({
        command: 'cmd2',
        args: ['cmd2'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      const pids = registry.getAllPIDs();
      expect(pids).toEqual([shellPid, shellPid + 1, shellPid + 2]);
    });

    it('should return all processes', () => {
      registry.spawn({
        command: 'cmd1',
        args: ['cmd1'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      const all = registry.getAll();
      expect(all).toHaveLength(2); // shell + cmd1
      expect(all.map(p => p.command)).toContain('shell');
      expect(all.map(p => p.command)).toContain('cmd1');
    });
  });

  describe('getRunning', () => {
    beforeEach(() => {
      shellPid = spawnShell(registry);
    });

    it('should return only running and sleeping processes', async () => {
      const pid1 = registry.spawn({
        command: 'running',
        args: ['running'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: new Promise(() => {}), // Never resolves
        abortController: new AbortController(),
      });

      const pid2 = registry.spawn({
        command: 'zombie',
        args: ['zombie'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      registry.updateStatus(pid1, 'sleeping');

      const running = registry.getRunning();
      expect(running.map(p => p.pid)).toContain(shellPid);
      expect(running.map(p => p.pid)).toContain(pid1); // sleeping
      expect(running.map(p => p.pid)).not.toContain(pid2); // zombie
    });
  });

  describe('getBackgroundJobs', () => {
    beforeEach(() => {
      shellPid = spawnShell(registry);
    });

    it('should return only background processes', () => {
      registry.spawn({
        command: 'fg',
        args: ['fg'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      const bgPid = registry.spawn({
        command: 'bg',
        args: ['bg'],
        cwd: '/home',
        env: {},
        isForeground: false,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      const jobs = registry.getBackgroundJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].pid).toBe(bgPid);
      expect(jobs[0].isForeground).toBe(false);
    });

    it('should not include shell', () => {
      const jobs = registry.getBackgroundJobs();
      expect(jobs.map(p => p.pid)).not.toContain(1);
    });
  });

  describe('getZombies', () => {
    beforeEach(() => {
      shellPid = spawnShell(registry);
    });

    it('should return only zombie processes', async () => {
      registry.spawn({
        command: 'running',
        args: ['running'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: new Promise(() => {}),
        abortController: new AbortController(),
      });

      const zombiePid = registry.spawn({
        command: 'zombie',
        args: ['zombie'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const zombies = registry.getZombies();
      expect(zombies).toHaveLength(1);
      expect(zombies[0].pid).toBe(zombiePid);
      expect(zombies[0].status).toBe('zombie');
    });
  });

  describe('kill', () => {
    beforeEach(() => {
      shellPid = spawnShell(registry);
    });

    it('should abort the process', () => {
      const abortController = new AbortController();
      const pid = registry.spawn({
        command: 'test',
        args: ['test'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: Promise.resolve(0),
        abortController,
      });

      expect(abortController.signal.aborted).toBe(false);

      const killed = registry.kill(pid);
      expect(killed).toBe(true);
      expect(abortController.signal.aborted).toBe(true);
    });

    it('should not kill shell', () => {
      const shell = registry.get(shellPid);
      const shellAbort = shell?.abortController;

      const killed = registry.kill(shellPid);
      expect(killed).toBe(false);
      expect(shellAbort?.signal.aborted).toBe(false);
    });

    it('should return false for non-existent PID', () => {
      const killed = registry.kill(999);
      expect(killed).toBe(false);
    });

    it('should return true for already-dead process', async () => {
      const pid = registry.spawn({
        command: 'test',
        args: ['test'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const killed = registry.kill(pid);
      expect(killed).toBe(true);
    });

    it('should update status to stopped for STOP signals', () => {
      const pid = registry.spawn({
        command: 'test',
        args: ['test'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: new Promise(() => {}),
        abortController: new AbortController(),
      });

      registry.kill(pid, 'STOP');

      const proc = registry.get(pid);
      expect(proc?.status).toBe('stopped');
    });
  });

  describe('reap', () => {
    beforeEach(() => {
      shellPid = spawnShell(registry);
    });

    it('should remove zombie process', async () => {
      const pid = registry.spawn({
        command: 'test',
        args: ['test'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(registry.has(pid)).toBe(true);

      const reaped = registry.reap(pid);
      expect(reaped).toBe(true);
      expect(registry.has(pid)).toBe(false);
    });

    it('should not reap running process', () => {
      const pid = registry.spawn({
        command: 'test',
        args: ['test'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: new Promise(() => {}),
        abortController: new AbortController(),
      });

      const reaped = registry.reap(pid);
      expect(reaped).toBe(false);
      expect(registry.has(pid)).toBe(true);
    });

    it('should not reap shell', () => {
      const reaped = registry.reap(shellPid);
      expect(reaped).toBe(false);
      expect(registry.has(shellPid)).toBe(true);
    });

    it('should return false for non-existent PID', () => {
      const reaped = registry.reap(999);
      expect(reaped).toBe(false);
    });
  });

  describe('collectZombies', () => {
    beforeEach(() => {
      shellPid = spawnShell(registry);
    });

    it('should collect and reap all zombies', async () => {
      const pid1 = registry.spawn({
        command: 'zombie1',
        args: ['zombie1'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      const pid2 = registry.spawn({
        command: 'zombie2',
        args: ['zombie2'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: Promise.resolve(1),
        abortController: new AbortController(),
      });

      const pid3 = registry.spawn({
        command: 'running',
        args: ['running'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: new Promise(() => {}),
        abortController: new AbortController(),
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const zombies = registry.collectZombies();
      expect(zombies).toHaveLength(2);
      expect(zombies.map(z => z.pid)).toContain(pid1);
      expect(zombies.map(z => z.pid)).toContain(pid2);

      expect(registry.has(pid1)).toBe(false);
      expect(registry.has(pid2)).toBe(false);
      expect(registry.has(pid3)).toBe(true);
    });
  });

  describe('updateStatus', () => {
    beforeEach(() => {
      shellPid = spawnShell(registry);
    });

    it('should update process status', () => {
      const pid = registry.spawn({
        command: 'test',
        args: ['test'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: new Promise(() => {}),
        abortController: new AbortController(),
      });

      expect(registry.get(pid)?.status).toBe('running');

      registry.updateStatus(pid, 'sleeping');
      expect(registry.get(pid)?.status).toBe('sleeping');

      registry.updateStatus(pid, 'stopped');
      expect(registry.get(pid)?.status).toBe('stopped');
    });

    it('should return false for non-existent PID', () => {
      const updated = registry.updateStatus(999, 'stopped');
      expect(updated).toBe(false);
    });
  });

  describe('getUptime', () => {
    beforeEach(() => {
      shellPid = spawnShell(registry);
    });

    it('should return process uptime', async () => {
      const pid = registry.spawn({
        command: 'test',
        args: ['test'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: new Promise(() => {}),
        abortController: new AbortController(),
      });

      const uptime1 = registry.getUptime(pid);
      expect(uptime1).toBeGreaterThanOrEqual(0);

      await new Promise(resolve => setTimeout(resolve, 100));

      const uptime2 = registry.getUptime(pid);
      expect(uptime2).toBeGreaterThan(uptime1!);
      expect(uptime2! - uptime1!).toBeGreaterThanOrEqual(95);
    });

    it('should return null for non-existent PID', () => {
      const uptime = registry.getUptime(999);
      expect(uptime).toBeNull();
    });
  });

  describe('getFormattedInfo', () => {
    beforeEach(() => {
      shellPid = spawnShell(registry);
    });

    it('should format process info', () => {
      const pid = registry.spawn({
        command: 'test-cmd',
        args: ['test-cmd'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: new Promise(() => {}),
        abortController: new AbortController(),
      });

      const info = registry.getFormattedInfo(pid);
      expect(info).toBeDefined();
      expect(info).toContain(pid.toString());
      expect(info).toContain('pts/0');
      expect(info).toContain('test-cmd');
    });

    it('should show defunct marker for zombies', async () => {
      const pid = registry.spawn({
        command: 'zombie',
        args: ['zombie'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const info = registry.getFormattedInfo(pid);
      expect(info).toContain('<defunct>');
    });

    it('should show stopped marker for stopped processes', () => {
      const pid = registry.spawn({
        command: 'stopped',
        args: ['stopped'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: new Promise(() => {}),
        abortController: new AbortController(),
      });

      registry.updateStatus(pid, 'stopped');

      const info = registry.getFormattedInfo(pid);
      expect(info).toContain('<stopped>');
    });

    it('should return null for non-existent PID', () => {
      const info = registry.getFormattedInfo(999);
      expect(info).toBeNull();
    });
  });

  describe('count and reset', () => {
    beforeEach(() => {
      shellPid = spawnShell(registry);
    });

    it('should count processes', () => {
      expect(registry.count()).toBe(1); // shell

      registry.spawn({
        command: 'test1',
        args: ['test1'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      expect(registry.count()).toBe(2);

      registry.spawn({
        command: 'test2',
        args: ['test2'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      expect(registry.count()).toBe(3);
    });

    it('should reset registry except shell', () => {
      const pid1 = registry.spawn({
        command: 'test1',
        args: ['test1'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      const pid2 = registry.spawn({
        command: 'test2',
        args: ['test2'],
        cwd: '/home',
        env: {},
        isForeground: true,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      expect(registry.count()).toBe(3);

      registry.reset();

      expect(registry.count()).toBe(1);
      expect(registry.has(shellPid)).toBe(true); // shell preserved
      expect(registry.has(pid1)).toBe(false);
      expect(registry.has(pid2)).toBe(false);
    });

    it('should reset PID and job ID counters', () => {
      registry.spawn({
        command: 'test',
        args: ['test'],
        cwd: '/home',
        env: {},
        isForeground: false,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      registry.reset();

      const pid = registry.spawn({
        command: 'after-reset',
        args: ['after-reset'],
        cwd: '/home',
        env: {},
        isForeground: false,
        promise: Promise.resolve(0),
        abortController: new AbortController(),
      });

      const proc = registry.get(pid);
      expect(pid).toBe(shellPid + 1); // Numbering restarts after the shell
      expect(registry.get(shellPid)?.command).toBe('shell'); // not overwritten
      expect(proc?.jobId).toBe(1); // Reset to 1
    });
  });
});
