import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { InvalidStateTransitionError } from '../../applications/domain/application-state-machine';

export interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

/** Errors from body-parser/raw-body (413, 415, …) carry an HTTP status and a safe message. */
interface ClientError {
  status: number;
  expose?: boolean;
  message: string;
}

function isClientError(e: unknown): e is ClientError {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

/**
 * Single place that shapes — and logs — every error response. Guards run before interceptors,
 * so rejected requests (401/403) are logged here, not in LoggingInterceptor. Unknown errors become
 * a generic 500 so stack traces, SQL fragments or request data never reach the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { user?: { id: string } }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      const details = typeof body === 'object' && body !== null ? (body as { message?: string | string[]; error?: string }) : {};
      message = details.message ?? exception.message;
      error = details.error ?? exception.name;
    } else if (exception instanceof InvalidStateTransitionError) {
      // Domain rule violation: the request is valid but conflicts with the application's current state.
      status = HttpStatus.CONFLICT;
      error = 'Conflict';
      message = exception.message;
    } else if (isClientError(exception)) {
      status = exception.status;
      error = HttpStatus[status] ?? 'Bad Request';
      message = exception.expose ? exception.message : error;
    }

    const route = (request.route as { path?: string } | undefined)?.path ?? request.path;
    const logLine = { method: request.method, route, statusCode: status, userId: request.user?.id };
    if (status >= 500) {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error({ ...logLine, err: { name: err.name, message: err.message, stack: err.stack } }, 'Unhandled exception');
    } else {
      this.logger.warn(logLine);
    }

    const payload: ErrorResponseBody = {
      statusCode: status,
      error,
      message,
      path: request.path,
      timestamp: new Date().toISOString(),
    };
    response.status(status).json(payload);
  }
}
