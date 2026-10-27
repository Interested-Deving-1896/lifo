import { describe, it, expect, vi } from 'vitest';
import { makeLoopbackFetch, loopbackPort } from '../../src/kernel/network/loopback-fetch.js';
import type { VirtualRequestHandler } from '../../src/kernel/index.js';

/** An async server, like Express or tinbase: it finishes writing after the handler returns. */
function echoServer(): VirtualRequestHandler {
  return (req, res) => {
    res._donePromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        res.statusCode = 201;
        res.headers['content-type'] = 'application/json';
        res.body = JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body: req.body });
        resolve();
      }, 5);
    });
  };
}

const fallbackResponse = () => new Response('from the network', { status: 299 });

describe('loopbackPort', () => {
  it('reads the port of a loopback URL, with the scheme default', () => {
    expect(loopbackPort(new URL('http://localhost:54321/rest/v1'))).toBe(54321);
    expect(loopbackPort(new URL('http://127.0.0.1:3001/'))).toBe(3001);
    expect(loopbackPort(new URL('http://[::1]:8080/'))).toBe(8080);
    expect(loopbackPort(new URL('http://localhost/'))).toBe(80);
    expect(loopbackPort(new URL('https://localhost/'))).toBe(443);
  });

  it('is null for any other host', () => {
    expect(loopbackPort(new URL('https://example.com:54321/'))).toBeNull();
    expect(loopbackPort(new URL('http://www.rapidnative.com/_sw/box/54321/'))).toBeNull();
  });
});

describe('makeLoopbackFetch', () => {
  it('sends a loopback request to the in-VM server bound on its port', async () => {
    const registry = new Map<number, VirtualRequestHandler>([[54321, echoServer()]]);
    const fallback = vi.fn(async () => fallbackResponse());
    const vmFetch = makeLoopbackFetch(registry, fallback);

    const res = await vmFetch('http://localhost:54321/auth/v1/user?x=1', {
      method: 'POST',
      headers: { apikey: 'k', 'Content-Type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });

    expect(fallback).not.toHaveBeenCalled();
    expect(res.status).toBe(201);
    const seen = await res.json();
    expect(seen.method).toBe('POST');
    expect(seen.url).toBe('/auth/v1/user?x=1');
    expect(seen.headers.apikey).toBe('k');
    expect(seen.headers['content-type']).toBe('application/json');
    // fetch omits content-length; express.json's hasBody() needs it
    expect(seen.headers['content-length']).toBe('17');
    expect(seen.body).toBe('{"hello":"world"}');
  });

  it('accepts a Request object and a URL', async () => {
    const registry = new Map<number, VirtualRequestHandler>([[3001, echoServer()]]);
    const vmFetch = makeLoopbackFetch(registry, async () => fallbackResponse());

    const fromRequest = await (await vmFetch(new Request('http://127.0.0.1:3001/a', { method: 'DELETE' }))).json();
    expect(fromRequest).toMatchObject({ method: 'DELETE', url: '/a' });

    const fromUrl = await (await vmFetch(new URL('http://localhost:3001/b'))).json();
    expect(fromUrl).toMatchObject({ method: 'GET', url: '/b', body: '' });
  });

  it('finds a server that started after the wrapper was made', async () => {
    const registry = new Map<number, VirtualRequestHandler>();
    const vmFetch = makeLoopbackFetch(registry, async () => fallbackResponse());
    registry.set(4000, echoServer());
    expect((await vmFetch('http://localhost:4000/late')).status).toBe(201);
  });

  it('leaves other hosts and unbound loopback ports to the wrapped fetch', async () => {
    const registry = new Map<number, VirtualRequestHandler>([[54321, echoServer()]]);
    const fallback = vi.fn(async () => fallbackResponse());
    const vmFetch = makeLoopbackFetch(registry, fallback);

    expect((await vmFetch('https://api.example.com/v1')).status).toBe(299);
    expect((await vmFetch('http://localhost:9999/')).status).toBe(299);
    expect(fallback).toHaveBeenCalledTimes(2);
  });

  it('gives a 204 a null body', async () => {
    const registry = new Map<number, VirtualRequestHandler>([[3002, (_req, res) => { res.statusCode = 204; }]]);
    const res = await makeLoopbackFetch(registry, async () => fallbackResponse())('http://localhost:3002/');
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  it('rejects when the signal aborts before the server answers', async () => {
    const registry = new Map<number, VirtualRequestHandler>([[3003, (_req, res) => {
      res._donePromise = new Promise<void>(() => {});
    }]]);
    const controller = new AbortController();
    const pending = makeLoopbackFetch(registry, async () => fallbackResponse())('http://localhost:3003/', {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('is the wrapped fetch itself when there is no port registry', () => {
    const fallback = async () => fallbackResponse();
    expect(makeLoopbackFetch(undefined, fallback)).toBe(fallback);
  });
});
