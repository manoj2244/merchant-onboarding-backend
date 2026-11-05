import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

/**
 * Logs one line per successful request: method, route pattern, status, duration and the caller's
 * user id. Error responses are logged by AllExceptionsFilter (which also sees requests rejected by
 * guards, before any interceptor runs). Bodies, query strings and headers are deliberately not
 * logged, so passwords, tokens and merchant PII cannot reach the logs through this path.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request & { user?: { id: string } }>();
    const started = Date.now();
    const route = (req.route as { path?: string } | undefined)?.path ?? req.path;

    return next.handle().pipe(
      tap(() =>
        this.logger.log({
          method: req.method,
          route,
          statusCode: http.getResponse<Response>().statusCode,
          durationMs: Date.now() - started,
          userId: req.user?.id,
        }),
      ),
    );
  }
}
