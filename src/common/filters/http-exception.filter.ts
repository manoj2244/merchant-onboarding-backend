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

/**
 * Single place that shapes every error response. Unknown errors become a generic 500 so
 * stack traces, SQL fragments or request data never leak to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

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
    } else {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error({ err: { name: err.name, message: err.message, stack: err.stack } }, 'Unhandled exception');
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
