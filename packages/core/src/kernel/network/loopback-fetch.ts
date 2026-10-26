/**
 * loopback-fetch.ts — the `fetch` a script inside the VM sees, made to reach the
 * VM's own servers.
 *
 * A node script's `fetch` is the browser's. `http://localhost:54321/...` from it
 * goes to the real machine's localhost, never to the tinbase (or any other
 * server) listening on port 54321 inside the VM, so an Express API that reads
 * its database with `fetch(`${SUPABASE_URL}/rest/v1/...`)` could not reach it.
 * Requests to a loopback host whose port is bound in the VM are dispatched to
 * that server instead; everything else (other hosts, unbound ports) goes to the
 * wrapped fetch unchanged.
 */

import type { VirtualRequestHandler } from '../index.js';
import { dispatchFetch } from './dispatch.js';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The in-VM port a loopback URL addresses, or null for any other host. */
export function loopbackPort(url: URL): number | null {
	if (!LOOPBACK_HOSTS.has(url.hostname)) return null;
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	return url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
}

function abortError(signal: AbortSignal): unknown {
	return signal.reason ?? new DOMException('This operation was aborted', 'AbortError');
}

/**
 * Wrap `fallback` so loopback requests to a port bound in `portRegistry` are
 * answered by that in-VM server. The registry is read per request, so a server
 * that starts after the wrapper was made is still found.
 */
export function makeLoopbackFetch(
	portRegistry: Map<number, VirtualRequestHandler> | undefined,
	fallback: typeof fetch,
): typeof fetch {
	if (!portRegistry) return fallback;

	return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
		let url: URL;
		try {
			url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url);
		} catch {
			return fallback(input, init);
		}
		const port = loopbackPort(url);
		if (port == null || !portRegistry.has(port)) return fallback(input, init);

		// Request normalises every body type fetch accepts (string, bytes, Blob,
		// FormData, URLSearchParams, streams) and the headers they imply.
		const req = new Request(input as RequestInfo, init);
		const signal = req.signal;
		if (signal.aborted) throw abortError(signal);

		const headers: Record<string, string> = {};
		req.headers.forEach((value, key) => { headers[key] = value; });
		const bytes = req.method === 'GET' || req.method === 'HEAD'
			? undefined
			: new Uint8Array(await req.arrayBuffer());

		const response = dispatchFetch(portRegistry, port, {
			method: req.method,
			url: url.pathname + url.search,
			headers,
			body: bytes && bytes.length ? bytes : undefined,
		});
		return new Promise<Response>((resolve, reject) => {
			const onAbort = () => reject(abortError(signal));
			signal.addEventListener('abort', onAbort, { once: true });
			response.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
		});
	}) as typeof fetch;
}
