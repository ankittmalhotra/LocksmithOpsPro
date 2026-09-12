import { deserializeSession, type AuthSession } from '@/lib/session';

type RouteHandler = (...args: any[]) => Response | Promise<Response>;

interface RequestLog {
  request: Request;
  route: string;
  requestId: string;
  status: number;
  durationMs: number;
  error?: string;
  stack?: string;
}

function getSessionFromRequest(request: Request): AuthSession | null {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const sessionCookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('locksmith_user_session='));

  if (!sessionCookie) return null;

  return deserializeSession(sessionCookie.slice('locksmith_user_session='.length));
}

function getErrorDetails(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: error.message, stack: error.stack };
  if (typeof error === 'string') return { message: error };

  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: 'Unknown error' };
  }
}

async function getResponseError(response: Response): Promise<string | undefined> {
  if (response.status < 400) return undefined;

  try {
    const body = await response.clone().json() as { error?: unknown };
    return typeof body.error === 'string' ? body.error : undefined;
  } catch {
    return undefined;
  }
}

function logRequestOutcome({ request, route, requestId, status, durationMs, error, stack }: RequestLog) {
  const actor = getSessionFromRequest(request);
  const event = {
    event: 'portal_api_request',
    requestId,
    method: request.method,
    path: new URL(request.url).pathname,
    route,
    status,
    durationMs,
    actor: actor ? { userId: actor.id, role: actor.role } : { userId: null, role: 'anonymous' },
    ...(error ? { error } : {}),
    ...(stack ? { stack } : {}),
  };
  const serialized = JSON.stringify(event);

  if (status >= 500) {
    console.error(serialized);
  } else if (status >= 400) {
    console.warn(serialized);
  } else {
    console.info(serialized);
  }
}

export function getRequestId(request: Request): string {
  return request.headers.get('x-request-id') || crypto.randomUUID();
}

export function logCaughtRequestError(request: Request, route: string, error: unknown) {
  const details = getErrorDetails(error);
  logRequestOutcome({
    request,
    route,
    requestId: getRequestId(request),
    status: 500,
    durationMs: 0,
    error: details.message,
    stack: details.stack,
  });
}

export function addRequestId(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Request-Id', requestId);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function logFailedRequest(
  request: Request,
  route: string,
  status: number,
  requestId: string,
  error?: string,
) {
  logRequestOutcome({
    request,
    route,
    requestId,
    status,
    durationMs: 0,
    error,
  });
}

export function withRequestLogging<THandler extends RouteHandler>(route: string, handler: THandler): THandler {
  const wrapped = async (...args: Parameters<THandler>): Promise<Response> => {
    const request = args[0] as Request;
    const requestId = getRequestId(request);
    const startedAt = Date.now();

    // Make the same ID available to route-level catch blocks as well as the
    // wrapper, allowing one failure to be traced to a single log record.
    try {
      request.headers.set('x-request-id', requestId);
    } catch {
      // Some runtimes expose immutable request headers; the wrapper ID is
      // still returned to the client and included in the wrapper log.
    }

    try {
      const response = await handler(...args);
      const error = await getResponseError(response);
      logRequestOutcome({
        request,
        route,
        requestId,
        status: response.status,
        durationMs: Date.now() - startedAt,
        error,
      });
      return addRequestId(response, requestId);
    } catch (error) {
      const details = getErrorDetails(error);
      logRequestOutcome({
        request,
        route,
        requestId,
        status: 500,
        durationMs: Date.now() - startedAt,
        error: details.message,
        stack: details.stack,
      });
      throw error;
    }
  };

  return wrapped as THandler;
}
